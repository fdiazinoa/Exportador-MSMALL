const sql = require('mssql');
const mysql = require('mysql2/promise');
const { Client } = require('pg');
const logger = require('./logger');

class DbFactory {
    async getConnection(dbConfig) {
        const { provider, config } = dbConfig;

        logger.info(`Creating connection for provider: ${provider}`);

        try {
            switch (provider.toLowerCase()) {
                case 'sqlserver':
                    const pool = await sql.connect(config);
                    return {
                        query: async (sqlQuery) => {
                            const result = await pool.request().query(sqlQuery);
                            return result.recordset;
                        },
                        close: async () => await pool.close()
                    };

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
