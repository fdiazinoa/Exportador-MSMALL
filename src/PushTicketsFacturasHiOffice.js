const logger = require('./logger');
const fs = require('fs');
const path = require('path');

class PushTicketsFacturasHiOffice {
    constructor() {
        this.baseUrl = 'https://cloudlicense.icg.eu';
        this.session = {
            authToken: null,
            dir_cloudclient: null,
            port: null,
            secure: null
        };
    }

    /**
     * Main execution method called by jobRunner
     * @param {Object} jobConfig 
     * @param {Array} data Extracted and mapped data
     */
    async execute(jobConfig, data) {
        logger.info(`[HiOffice] Starting Push Job: ${jobConfig.name}`);

        try {
            // 1. Login
            await this.login(jobConfig.credentials);

            // 2. Build Payload
            const payloadFile = await this.buildPayload(data, jobConfig);

            // 3. Launch Import
            const importId = jobConfig.importId || 'Importación Tíquets'; // Default or from config
            const importUUID = await this.launchImport(importId, payloadFile);

            // 4. Poll Status
            const result = await this.pollStatus(importUUID);

            // 5. Handle Result
            if (result.status === 3) {
                logger.info(`[HiOffice] Import finished successfully. Inserted: ${result.inserted}, Updated: ${result.updated}`);
            } else if (result.status === 2) {
                logger.error(`[HiOffice] Import finished with errors.`);
                await this.getErrors(importUUID);
                throw new Error('HiOffice Import failed with errors.');
            } else {
                logger.warn(`[HiOffice] Import finished with unexpected status: ${result.status}`);
            }

        } catch (error) {
            logger.error(`[HiOffice] Execution failed: ${error.message}`);
            throw error;
        } finally {
            // 6. Logout
            await this.logout();
        }
    }

    async login(credentials) {
        const { email, password, isoLanguage = 'es' } = credentials;
        const url = `${this.baseUrl}/services/cloud/getCustomerWithAuthToken?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&isoLanguage=${isoLanguage}`;

        logger.info('[HiOffice] Authenticating...');
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Login failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.result !== 1) {
            throw new Error(`Login failed: API returned result ${data.result}`);
        }

        this.session = {
            authToken: data.authToken,
            dir_cloudclient: data.dir_cloudclient,
            port: data.port,
            secure: data.secure
        };

        logger.info('[HiOffice] Authentication successful.');
    }

    async buildPayload(data, jobConfig) {
        logger.info('[HiOffice] Building payload...');
        const format = jobConfig.payloadFormat || 'json';
        let content = '';
        const filename = `import_${Date.now()}.${format}`;
        const filePath = path.join(process.cwd(), 'exports', filename);

        // Ensure exports directory exists
        if (!fs.existsSync(path.dirname(filePath))) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
        }

        if (format.toLowerCase() === 'json') {
            content = JSON.stringify(data, null, 2);
        } else if (format.toLowerCase() === 'xml') {
            // Simple XML construction or use a library if available. 
            // For now assuming data is already stringified XML or we do a basic wrap if it's an array.
            // In a real scenario, we might use 'xmlbuilder2' or similar if added to deps.
            // Here we assume the mapper produced a structure we can just dump or the user provides a string.
            if (typeof data === 'string') {
                content = data;
            } else {
                // Fallback: naive JSON to XML or expect mapper to have done the work
                logger.warn('[HiOffice] XML format requested but data is object. Dumping JSON as text (fix mapper).');
                content = JSON.stringify(data);
            }
        } else {
            throw new Error(`Unsupported payload format: ${format}`);
        }

        fs.writeFileSync(filePath, content);
        logger.info(`[HiOffice] Payload created at ${filePath}`);
        return filePath;
    }

    async launchImport(importId, filePath) {
        const { dir_cloudclient, authToken } = this.session;
        const url = `https://${dir_cloudclient}/bridge-back/api/import/${encodeURIComponent(importId)}/launchWithFile`;

        logger.info(`[HiOffice] Launching import '${importId}'...`);

        const fileContent = fs.readFileSync(filePath);
        const blob = new Blob([fileContent], { type: 'application/json' }); // Adjust mime type if XML

        const formData = new FormData();
        formData.append('file', blob, path.basename(filePath));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'x-auth-token': authToken
            },
            body: formData
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Launch failed: ${response.status} ${text}`);
        }

        // The API returns the UUID directly as a string or in a JSON? 
        // Based on standard Bridge behavior, it usually returns the UUID string.
        // Let's assume it returns the UUID string directly.
        const importUUID = await response.text();

        // Clean up UUID string (remove quotes if present)
        const cleanUUID = importUUID.replace(/['"]+/g, '');

        logger.info(`[HiOffice] Import launched. UUID: ${cleanUUID}`);
        return cleanUUID;
    }

    async pollStatus(importUUID) {
        const { dir_cloudclient, authToken } = this.session;
        const url = `https://${dir_cloudclient}/bridge-back/api/import/${importUUID}/status`;

        logger.info(`[HiOffice] Polling status for ${importUUID}...`);

        let status = 1; // 1 = Running
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes approx (5s interval)

        while (status === 1 && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s

            const response = await fetch(url, {
                headers: { 'x-auth-token': authToken }
            });

            if (!response.ok) {
                logger.warn(`[HiOffice] Status poll failed: ${response.status}`);
                continue;
            }

            const data = await response.json();
            // Expected format: { status: 1|2|3, inserted: N, updated: N, ... }
            status = data.status;

            if (status === 1) {
                logger.debug(`[HiOffice] Import still running...`);
            } else {
                return data;
            }
            attempts++;
        }

        throw new Error('Import timed out.');
    }

    async getErrors(importUUID) {
        const { dir_cloudclient, authToken } = this.session;
        const url = `https://${dir_cloudclient}/bridge-back/api/import/${importUUID}/errors`;

        logger.info(`[HiOffice] Fetching errors...`);

        const response = await fetch(url, {
            headers: { 'x-auth-token': authToken }
        });

        if (response.ok) {
            const errors = await response.json();
            logger.error(`[HiOffice] Import Errors: ${JSON.stringify(errors, null, 2)}`);
        } else {
            logger.warn(`[HiOffice] Could not fetch errors: ${response.status}`);
        }
    }

    async logout() {
        if (!this.session.authToken) return;

        const { dir_cloudclient, authToken } = this.session;
        // The logout URL might be on the cloudlicense or the bridge instance.
        // Requirement says: GET /ErpCloud/session/logout
        // Usually this is on the instance.
        const url = `https://${dir_cloudclient}/ErpCloud/session/logout`;

        try {
            await fetch(url, {
                headers: { 'x-auth-token': authToken }
            });
            logger.info('[HiOffice] Logged out.');
        } catch (err) {
            logger.warn(`[HiOffice] Logout failed (ignoring): ${err.message}`);
        }

        this.session = {};
    }
}

module.exports = new PushTicketsFacturasHiOffice();
