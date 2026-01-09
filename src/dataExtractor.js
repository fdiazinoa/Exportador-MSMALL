const dbFactory = require('./dbFactory');
const configLoader = require('./configLoader');
const logger = require('./logger');

class DataExtractor {
    async extract(connectionName, query) {
        const config = configLoader.load();
        const dbConfig = config.databases[connectionName];

        if (!dbConfig) {
            throw new Error(`Database configuration '${connectionName}' not found.`);
        }

        let connection = null;
        try {
            connection = await dbFactory.getConnection(dbConfig);
            logger.info(`Executing query on ${connectionName}`);
            const data = await connection.query(query);
            logger.info(`Extracted ${data.length} rows.`);
            return data;
        } catch (error) {
            logger.error(`Error extracting data from ${connectionName}: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
}

module.exports = new DataExtractor();
