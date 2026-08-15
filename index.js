// Polyfill only when AbortSignal exists. Legacy-2008 uses an older runtime.
if (typeof AbortSignal !== 'undefined' && !AbortSignal.any) {
    AbortSignal.any = function (signals) {
        const controller = new AbortController();
        for (const signal of signals) {
            if (signal.aborted) {
                controller.abort(signal.reason);
                return controller.signal;
            }
            signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
        }
        return controller.signal;
    };
}

const configLoader = require('./src/configLoader');
const jobExecutor = require('./src/jobExecutor');
const logger = require('./src/logger');

const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const apiRouter = require('./src/api');
const { resolveRuntimePath } = require('./src/runtimePaths');
const packageInfo = require('./package.json');
const buildInfo = require('./src/buildInfo');
const webSecurity = require('./src/webSecurity');

async function startServer() {
    const app = express();
    const port = process.env.PORT || 3000;
    const bindAddress = process.env.EXPORTADOR_BIND_ADDRESS || '127.0.0.1';

    app.disable('x-powered-by');
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'"],
                imgSrc: ["'self'", 'data:'],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
            },
        },
    }));
    app.use(express.json({ limit: '2mb' }));
    app.use(webSecurity.createSessionMiddleware());

    // API Routes
    app.use('/api/auth', webSecurity.authRouter);
    app.use('/api', webSecurity.requireAuthenticated, webSecurity.requireCsrf);
    app.use('/api', apiRouter);

    // Serve Frontend
    const frontendPath = resolveRuntimePath('frontend', 'dist');
    if (fs.existsSync(frontendPath)) {
        app.use(express.static(frontendPath));
        app.get(/.*/, (req, res) => {
            res.sendFile(path.join(frontendPath, 'index.html'));
        });
    } else {
        logger.warn('Frontend build not found. Run "npm run build" in frontend directory.');
    }

    return new Promise((resolve, reject) => {
        let started = false;
        const server = app.listen(port, bindAddress);
        server.once('listening', () => {
            started = true;
            logger.info(`Configuration Dashboard running at http://${bindAddress}:${port}`);
            resolve(server);
        });
        server.on('error', error => {
            logger.error(`Dashboard API could not listen on port ${port}: ${error.code || error.message}. runtimeMode=${process.env.EXPORTADOR_RUN_MODE || 'interactive'}`);
            if (!started) reject(error);
        });
    });
}

const cron = require('node-cron');

async function main() {
    logger.info(`Exportador MSMall V${packageInfo.version} started. edition=${buildInfo.edition}`);

    // Start the Web Server
    await startServer();

    const args = process.argv.slice(2);
    const runOnce = args.includes('--run-once');

    const config = configLoader.load();

    if (!config.jobs || config.jobs.length === 0) {
        logger.warn('No jobs defined in configuration.');
    }

    if (runOnce) {
        logger.info('Running in CLI mode (Run Once).');
        if (config.jobs) {
            for (const job of config.jobs) {
                await jobExecutor.execute(job.name);
            }
        }
        logger.info('All jobs finished. Exiting.');
        process.exit(0);
    } else {
        logger.info('Running in Service mode (Cron).');

        // Schedule jobs
        if (config.jobs) {
            for (const job of config.jobs) {
                if (job.schedule) {
                    logger.info(`Scheduling job '${job.name}' with cron: ${job.schedule}`);
                    cron.schedule(job.schedule, async () => {
                        // Reload config to get latest updates (e.g. query changes)
                        // Note: If schedule changes, we'd need to restart the cron task. 
                        // For simplicity, we assume schedule changes require service restart or we could implement a dynamic re-scheduler.
                        // Here we just reload config to get latest query/mapping.
                        const currentConfig = configLoader.load();
                        const currentJob = currentConfig.jobs.find(j => j.name === job.name);
                        if (currentJob) {
                            try {
                                await jobExecutor.execute(currentJob.name);
                            } catch (error) {
                                if (error.code === 'JOB_ALREADY_RUNNING') {
                                    logger.warn(`Skipping overlapping schedule for '${currentJob.name}'.`);
                                } else {
                                    logger.error(`Scheduled job '${currentJob.name}' failed: ${error.message}`);
                                }
                            }
                        }
                    });
                } else {
                    logger.warn(`Job '${job.name}' has no schedule defined. Skipping.`);
                }
            }
        }
    }
}

main().catch(err => {
    logger.error(`Fatal error: ${err.message}`);
    process.exit(1);
});
