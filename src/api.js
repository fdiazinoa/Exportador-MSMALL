const express = require('express');
const fs = require('fs');
const configLoader = require('./configLoader');
const dbFactory = require('./dbFactory');
const logger = require('./logger');
const { createAuthModule, HttpError } = require('./auth');

function sendApiError(res, error) {
    if (error instanceof HttpError) {
        return res.status(error.statusCode).json({
            error: error.message,
            code: error.code,
            details: error.details || undefined
        });
    }
    logger.error(`API error: ${error.message}`);
    return res.status(500).json({ error: error.message || 'Internal Server Error', code: 'internal_error' });
}

function createApiRouter(options = {}) {
    const router = express.Router();
    const authModule = createAuthModule({
        logger,
        configLoader,
        settings: options.authSettings,
        store: options.authStore
    });

    const requireAuth = authModule.middleware.authenticate();
    const requireTokenManager = [
        requireAuth,
        authModule.middleware.requireScopes('tokens:manage')
    ];

    const maybeProtectAdminRoutes = (req, res, next) => {
        if (!authModule.authService.getSettings().protectConfigRoutes) {
            return next();
        }
        let index = 0;
        const run = (error) => {
            if (error) return next(error);
            const handler = requireTokenManager[index++];
            if (!handler) return next();
            return handler(req, res, run);
        };
        return run();
    };

    // Auth / token management routes
    router.use(authModule.router);

    // Get Config
    router.get('/config', maybeProtectAdminRoutes, (req, res) => {
        try {
            const config = configLoader.load();
            res.json(config);
        } catch (error) {
            sendApiError(res, error);
        }
    });

    // Save Config
    router.post('/config', maybeProtectAdminRoutes, (req, res) => {
        try {
            const newConfig = req.body;
            fs.writeFileSync(configLoader.configPath, JSON.stringify(newConfig, null, 2));
            configLoader.load();
            logger.info('Configuration updated via API.');
            res.json({ message: 'Configuration saved.' });
        } catch (error) {
            logger.error(`Error saving config: ${error.message}`);
            sendApiError(res, error);
        }
    });

    // Test DB Connection
    router.post('/test/db', maybeProtectAdminRoutes, async (req, res) => {
        const { connectionName } = req.body;
        const config = configLoader.load();
        const dbConfig = config.databases?.[connectionName];

        if (!dbConfig) {
            return res.status(404).json({ error: 'Database config not found' });
        }

        try {
            const connection = await dbFactory.getConnection(dbConfig);
            await connection.close();
            res.json({ message: 'Connection successful' });
        } catch (error) {
            sendApiError(res, error);
        }
    });

    // Test FTP Connection
    router.post('/test/ftp', maybeProtectAdminRoutes, async (req, res) => {
        const { serverName } = req.body;
        const config = configLoader.load();
        const ftpConfig = config.ftpServers?.[serverName];

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
            sendApiError(res, error);
        }
    });

    // Fetch Schema (Columns)
    router.post('/schema', maybeProtectAdminRoutes, async (req, res) => {
        const { connectionName, query } = req.body;
        const config = configLoader.load();
        const dbConfig = config.databases?.[connectionName];

        if (!dbConfig) {
            return res.status(404).json({ error: 'Database config not found' });
        }

        try {
            const connection = await dbFactory.getConnection(dbConfig);
            const data = await connection.query(query);
            await connection.close();

            if (data && data.length > 0) {
                const columns = Object.keys(data[0]);
                res.json({ columns });
            } else {
                res.json({ columns: [] });
            }
        } catch (error) {
            sendApiError(res, error);
        }
    });

    // Manual Run Job
    router.post('/jobs/:name/run', async (req, res) => {
        const jobName = req.params.name;

        try {
            const { runJob } = require('./jobRunner');
            const result = await runJob(jobName);
            res.json(result);
        } catch (error) {
            sendApiError(res, error);
        }
    });

    // Example ingestion endpoint protected by exporter token + mall/local/mapping validation.
    router.post(
        '/ingest/payload',
        requireAuth,
        authModule.middleware.requireScopes('export:write'),
        authModule.middleware.requireExporterIngestion(),
        (req, res) => {
            try {
                const records = Array.isArray(req.body.records) ? req.body.records : [];
                res.json({
                    accepted: true,
                    mall_id: req.body.mall_id,
                    local_id: req.body.local_id,
                    mapping_key: req.body.mapping_key || req.body.mappingKey || null,
                    received_records: records.length,
                    token_id: req.auth.token_id
                });
            } catch (error) {
                sendApiError(res, error);
            }
        }
    );

    router.use((error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }
        return sendApiError(res, error);
    });

    return router;
}

const defaultRouter = createApiRouter();
module.exports = defaultRouter;
module.exports.createApiRouter = createApiRouter;
