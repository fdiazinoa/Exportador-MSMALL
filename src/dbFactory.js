const mysql = require('mysql2/promise');
const { Client } = require('pg');
const logger = require('./logger');
const { normalizeSqlServerConfig } = require('./sqlServerConfig');
const tediousClient = require('./tediousClient');

class DbFactory {
    async getConnection(dbConfig) {
        const { provider, config } = dbConfig;

        logger.info(`Creating connection for provider: ${provider}`);

        try {
            switch (provider.toLowerCase()) {
                case 'sqlserver': {
                    const normalized = normalizeSqlServerConfig(config);
                    logger.info(`SQL Server profile=${normalized.metadata.profile} tds=${normalized.metadata.tdsVersion} security=${normalized.metadata.securityMode}`);
                    // Each extraction owns a direct TDS connection. No process-global pool can
                    // be closed by another concurrent job.
                    const connection = await tediousClient.openConnection(normalized);
                    return {
                        query: async sqlQuery => tediousClient.query(connection, sqlQuery),
                        close: async () => tediousClient.close(connection)
                    };
                }

                case 'mysql':
                    const connection = await mysql.createConnection(config);
                    return {
                        query: async (sqlQuery) => {
                            const [rows] = await connection.execute(sqlQuery);
                            return rows;
                        },
                        close: async () => await connection.end()
                    };

                case 'postgres':
                    const client = new Client(config);
                    await client.connect();
                    return {
                        query: async (sqlQuery) => {
                            const res = await client.query(sqlQuery);
                            return res.rows;
                        },
                        close: async () => await client.end()
                    };

                default:
                    throw new Error(`Unsupported provider: ${provider}`);
            }
        } catch (error) {
            logger.error(`Failed to connect to database: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new DbFactory();
