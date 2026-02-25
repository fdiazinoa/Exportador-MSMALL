const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class ConfigLoader {
    constructor() {
        this.configPath = this.resolveConfigPath();
        this.config = {};
    }

    resolveConfigPath() {
        return process.env.MSMALL_CONFIG_PATH || path.join(process.cwd(), 'config', 'default.json');
    }

    load() {
        try {
            this.configPath = this.resolveConfigPath();
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
