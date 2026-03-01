const configLoader = require('./configLoader');
const dataExtractor = require('./dataExtractor');
const dataMapper = require('./dataMapper');
const fileExporter = require('./fileExporter');
const ftpUploader = require('./ftpUploader');
const webServiceUploader = require('./webServiceUploader');
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

        // 3. Resolve destination (backward compatible: infer by configured FTP/webservice names)
        const destinationTarget = resolveDestinationTarget(config, job.destinationType, job.destination);

        // 4. Export (always export file locally or custom path first)
        let exportPath = null;
        if (destinationTarget.type === 'local') {
            exportPath = destinationTarget.path || null;
        }

        const filePath = await fileExporter.export(mappedData, job.format, job.name, exportPath);

        // 5. Secondary delivery (FTP/SFTP/Webservice)
        if (destinationTarget.type === 'ftp' && destinationTarget.key) {
            await ftpUploader.upload(filePath, destinationTarget.key);
        } else if (destinationTarget.type === 'webservice' && destinationTarget.key) {
            await webServiceUploader.upload(filePath, destinationTarget.key, {
                job,
                mappedData,
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
        return {
            success: true,
            message: `Job '${jobName}' executed successfully.`,
            destination: destinationTarget.type,
        };

    } catch (error) {
        logger.error(`Job ${jobName} failed: ${error.message}`);
        throw error;
    }
}

module.exports = { runJob };
