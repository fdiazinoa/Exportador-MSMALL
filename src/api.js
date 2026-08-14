const express = require('express');
const cors = require('cors');
const fs = require('fs');
const configLoader = require('./configLoader');
const dbFactory = require('./dbFactory');
const ftpUploader = require('./ftpUploader'); // We might need to adjust ftpUploader to support a test method
const webServiceUploader = require('./webServiceUploader');
const logger = require('./logger');
const jobExecutor = require('./jobExecutor');
const packageInfo = require('../package.json');
const buildInfo = require('./buildInfo');
const { readLog, resolveLogFile } = require('./logReader');

const router = express.Router();

function sanitizeConfigForClient(config) {
    const cloned = JSON.parse(JSON.stringify(config || {}));
    const webServices = cloned.webServices || {};
    Object.keys(webServices).forEach(key => {
        const state = webServices[key].authState;
        if (!state) return;
        if (state.accessToken) state.accessToken = '[REDACTED]';
        if (state.refreshToken) state.refreshToken = '[REDACTED]';
    });
    return cloned;
}

function preserveAuthState(incomingConfig, currentConfig) {
    const nextConfig = JSON.parse(JSON.stringify(incomingConfig || {}));
    nextConfig.webServices = nextConfig.webServices || {};
    const currentWebServices = currentConfig.webServices || {};
    Object.keys(nextConfig.webServices).forEach(key => {
        const next = nextConfig.webServices[key];
        const current = currentWebServices[key];
        if (!current || !current.authState) return;
        const changed = ['baseUrl', 'clientId', 'clientSecret'].some(field => String(next[field] || '') !== String(current[field] || ''));
        if (!changed) next.authState = current.authState;
    });
    return nextConfig;
}

// Get Config
router.get('/config', (req, res) => {
    try {
        const config = configLoader.load();
        res.json(sanitizeConfigForClient(config));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/health', (req, res) => {
    res.json({
        ok: true,
        version: packageInfo.version,
        edition: buildInfo.edition,
        jobs: jobExecutor.status(),
    });
});

router.get('/logs/:type', (req, res) => {
    try {
        const result = readLog(req.params.type, req.query);
        res.json({
            type: result.type,
            fileName: result.fileName,
            exists: result.exists,
            lines: result.lines,
            entries: result.entries,
        });
    } catch (error) {
        res.status(error.code === 'INVALID_LOG_TYPE' ? 400 : 500).json({ error: error.message });
    }
});

router.get('/logs/:type/download', (req, res) => {
    try {
        const target = resolveLogFile(req.params.type);
        if (!fs.existsSync(target.filePath)) return res.status(404).json({ error: 'El archivo de log todavía no existe.' });
        return res.download(target.filePath, target.fileName);
    } catch (error) {
        return res.status(error.code === 'INVALID_LOG_TYPE' ? 400 : 500).json({ error: error.message });
    }
});

// Save Config
router.post('/config', (req, res) => {
    try {
        const currentConfig = configLoader.load();
        const newConfig = preserveAuthState(req.body, currentConfig);
        // Basic validation could go here

        // Write to file
        fs.writeFileSync(configLoader.configPath, JSON.stringify(newConfig, null, 2));

        // Reload config in loader
        configLoader.load();

        logger.info('Configuration updated via API.');
        res.json({ message: 'Configuration saved.' });
    } catch (error) {
        logger.error(`Error saving config: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Test DB Connection
router.post('/test/db', async (req, res) => {
    const { connectionName } = req.body;
    const config = configLoader.load();
    const dbConfig = config.databases[connectionName];

    if (!dbConfig) {
        return res.status(404).json({ error: 'Database config not found' });
    }

    try {
        const connection = await dbFactory.getConnection(dbConfig);
        await connection.close();
        res.json({ message: 'Connection successful' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test FTP Connection
router.post('/test/ftp', async (req, res) => {
    const { serverName } = req.body;
    const config = configLoader.load();
    const ftpConfig = config.ftpServers[serverName];

    if (!ftpConfig) {
        return res.status(404).json({ error: 'FTP config not found' });
    }

    try {
        if (ftpConfig.protocol === 'sftp') {
            const SftpClient = require('ssh2-sftp-client');
            const sftp = new SftpClient();
            await sftp.connect({
                host: ftpConfig.host,
                port: ftpConfig.port || 22,
                username: ftpConfig.user,
                password: ftpConfig.password
            });
            await sftp.end();
        } else {
            const ftp = require('basic-ftp');
            const client = new ftp.Client();
            await client.access({
                host: ftpConfig.host,
                port: ftpConfig.port || 21,
                user: ftpConfig.user,
                password: ftpConfig.password,
                secure: ftpConfig.secure || false
            });
            client.close();
        }
        res.json({ message: 'Connection successful' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test MsMall Service Account authentication and resolve Mall/Local identity.
router.post('/test/webservice', async (req, res) => {
    const { serverName } = req.body;
    const config = configLoader.load();
    if (!config.webServices || !config.webServices[serverName]) {
        return res.status(404).json({ error: 'Webservice config not found' });
    }
    try {
        const result = await webServiceUploader.testConnection(serverName);
        return res.json({ message: 'Conexión con MsMall validada.', ...result });
    } catch (error) {
        logger.error(`Error testing webservice '${serverName}': ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
});

// Fetch Schema (Columns)
router.post('/schema', async (req, res) => {
    const { connectionName, query } = req.body;
    const config = configLoader.load();
    const dbConfig = config.databases[connectionName];

    if (!dbConfig) {
        return res.status(404).json({ error: 'Database config not found' });
    }

    try {
        const connection = await dbFactory.getConnection(dbConfig);
        // Try to get 1 row to see columns
        // We wrap in a subquery or just limit 1 depending on DB, but for generic SQL:
        // "SELECT TOP 1 *" (SQL Server), "LIMIT 1" (MySQL/Postgres)
        // A safer generic way is just running the query and taking the first row if it exists, 
        // or using schema metadata. For simplicity/speed, let's try running the query with a limit if possible, 
        // or just run it (assuming user provides a SELECT). 

        // Let's try to modify the query to limit 1 for performance if it's a simple SELECT
        let schemaQuery = query;
        if (!query.toLowerCase().includes('limit') && !query.toLowerCase().includes('top')) {
            // Very naive check, but helpful. 
            // Better approach: User writes the query, we execute it. 
            // If it returns data, we get keys.
        }

        const data = await connection.query(schemaQuery);
        await connection.close();

        if (data && data.length > 0) {
            const columns = Object.keys(data[0]);
            res.json({ columns });
        } else {
            res.json({ columns: [] });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual Run Job
router.post('/jobs/:name/run', async (req, res) => {
    const jobName = req.params.name;

    try {
        const result = await jobExecutor.execute(jobName);
        res.json(result);
    } catch (error) {
        res.status(error.code === 'JOB_ALREADY_RUNNING' ? 409 : 500).json({ error: error.message, code: error.code });
    }
});

module.exports = router;
