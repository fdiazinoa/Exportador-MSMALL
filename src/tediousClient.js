const tedious = require('tedious');
const tediousVersion = require('tedious/package.json').version;

function buildTediousConfig(normalizedConfig) {
    const config = normalizedConfig.config;
    const options = { ...(config.options || {}) };
    options.database = config.database;
    options.connectTimeout = config.connectionTimeout;
    options.requestTimeout = config.requestTimeout;
    if (config.port) options.port = config.port;

    const major = Number(String(tediousVersion).split('.')[0]);
    const result = { server: config.server, options };
    if (major >= 9) {
        result.authentication = {
            type: 'default',
            options: { userName: config.user, password: config.password },
        };
    } else {
        result.userName = config.user;
        result.password = config.password;
    }
    return result;
}

function openConnection(normalizedConfig) {
    return new Promise((resolve, reject) => {
        const connection = new tedious.Connection(buildTediousConfig(normalizedConfig));
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            connection.removeListener('error', finish);
            if (error) reject(error);
            else resolve(connection);
        };
        connection.once('connect', finish);
        connection.once('error', finish);
        // Tedious 9+ requires an explicit connect(). Tedious 3 starts from the constructor.
        if (typeof connection.connect === 'function') connection.connect();
    });
}

function query(connection, sqlQuery) {
    return new Promise((resolve, reject) => {
        const rows = [];
        const request = new tedious.Request(sqlQuery, error => {
            if (error) reject(error);
            else resolve(rows);
        });
        request.on('row', columns => {
            const row = {};
            for (const column of columns) {
                row[column.metadata.colName] = column.value;
            }
            rows.push(row);
        });
        connection.execSql(request);
    });
}

function close(connection) {
    return new Promise(resolve => {
        if (!connection) return resolve();
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        connection.once('end', finish);
        connection.close();
        setTimeout(finish, 2000);
    });
}

module.exports = { buildTediousConfig, openConnection, query, close, tediousVersion };
