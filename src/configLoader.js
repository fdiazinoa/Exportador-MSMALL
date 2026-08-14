const fs = require('fs');
const logger = require('./logger');
const { resolveRuntimePath } = require('./runtimePaths');

class ConfigLoader {
    constructor() {
        this.configPath = resolveRuntimePath('config', 'default.json');
        this.config = {};
    }

    load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const rawData = fs.readFileSync(this.configPath);
                this.config = JSON.parse(rawData);
                logger.info('Configuration loaded successfully.');
            } else {
                logger.warn(`Configuration file not found at ${this.configPath}. Using empty config.`);
            }
        } catch (error) {
            logger.error(`Error loading configuration: ${error.message}`);
            throw error;
        }
        return this.config;
    }
}

module.exports = new ConfigLoader();
