const fs = require('fs');
const logger = require('./logger');

class DataMapper {
    map(data, mappingConfig) {
        let mappings = {};

        if (typeof mappingConfig === 'object' && mappingConfig !== null) {
            mappings = mappingConfig;
        } else if (typeof mappingConfig === 'string' && fs.existsSync(mappingConfig)) {
            try {
                const mappingJson = fs.readFileSync(mappingConfig, 'utf8');
                mappings = JSON.parse(mappingJson);
            } catch (error) {
                logger.error(`Error reading mapping file: ${error.message}`);
                return data;
            }
        } else {
            logger.warn(`No valid mapping configuration found. Returning raw data.`);
            return data;
        }

        try {
            return data.map(row => {
                const newRow = {};
                for (const [sourceField, targetField] of Object.entries(mappings)) {
                    if (row.hasOwnProperty(sourceField)) {
                        newRow[targetField] = row[sourceField];
                    }
                }
                return newRow;
            });
        } catch (error) {
            logger.error(`Error mapping data: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new DataMapper();
