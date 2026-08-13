const configLoader = require('./configLoader');
const dataExtractor = require('./dataExtractor');
const dataMapper = require('./dataMapper');
const fileExporter = require('./fileExporter');
const ftpUploader = require('./ftpUploader');
const webServiceUploader = require('./webServiceUploader');
const { normalizeRowsForWebservice } = require('./webServiceRowNormalizer');
const { resolveDestinationTarget } = require('./destinationResolver');
const logger = require('./logger');
const fs = require('fs');
const pushTicketsFacturasHiOffice = require('./PushTicketsFacturasHiOffice');

async function runJob(jobName) {
    // Reload config to get latest state
    const config = configLoader.load();
    const job = config.jobs.find(j => j.name === jobName);

    if (!job) {
        throw new Error(`Job '${jobName}' not found.`);
    }

    logger.info(`Starting job: ${jobName}`);

    try {
        // 1. Extract
        const data = await dataExtractor.extract(job.sourceConnection, job.query);

        // Check for Special Job Types
        if (job.type === 'hioffice_push') {
            await pushTicketsFacturasHiOffice.execute(job, data);

            // Update Last Run
            job.lastRun = new Date().toISOString();
            const jobIndex = config.jobs.findIndex(j => j.name === jobName);
            if (jobIndex !== -1) {
                config.jobs[jobIndex].lastRun = job.lastRun;
                fs.writeFileSync(configLoader.configPath, JSON.stringify(config, null, 2));
            }

            return { success: true, message: `HiOffice Push Job '${jobName}' executed successfully.` };
        }

        // 2. Map
        const mappedData = dataMapper.map(data, job.mapping || job.mappingFile);

        // 3. Resolve destination and normalize the MsMall contract when enabled.
        const destination = resolveDestinationTarget(config, job.destinationType, job.destination);
        let deliveryData = mappedData;
        let webserviceMeta = {};
        if (destination.type === 'webservice') {
            const normalized = normalizeRowsForWebservice(mappedData, job);
            deliveryData = normalized.rows;
            webserviceMeta = normalized.meta || {};
        }

        // 4. Always create the local export before secondary delivery.
        const exportPath = destination.type === 'local' ? destination.path : null;
        const filePath = await fileExporter.export(deliveryData, job.format, job.name, exportPath);

        // 5. Deliver through the selected connection.
        if (destination.type === 'ftp' && destination.key) {
            await ftpUploader.upload(filePath, destination.key);
        } else if (destination.type === 'webservice' && destination.key) {
            await webServiceUploader.upload(filePath, destination.key, {
                job,
                mappedData: deliveryData,
                meta: webserviceMeta,
            });
        }

        // 6. Update Last Run
        job.lastRun = new Date().toISOString();

        // Persist config update
        // We need to find the job index in the original config object to update it
        const jobIndex = config.jobs.findIndex(j => j.name === jobName);
        if (jobIndex !== -1) {
            config.jobs[jobIndex].lastRun = job.lastRun;
            fs.writeFileSync(configLoader.configPath, JSON.stringify(config, null, 2));
        }

        logger.info(`Job ${jobName} completed successfully.`);
        return { success: true, message: `Job '${jobName}' executed successfully.`, destination: destination.type };

    } catch (error) {
        logger.error(`Job ${jobName} failed: ${error.message}`);
        throw error;
    }
}

module.exports = { runJob };
