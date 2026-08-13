const path = require('path');
const configLoader = require('./configLoader');
const logger = require('./logger');
const webServiceAuth = require('./webServiceAuth');

function getConfig(serverName) {
    const config = configLoader.load();
    const wsConfig = config.webServices && config.webServices[serverName];
    if (!wsConfig) throw new Error(`Webservice configuration '${serverName}' not found.`);
    return wsConfig;
}

function chunks(rows, chunkSize) {
    if (!Array.isArray(rows) || rows.length === 0) return [[]];
    const size = Math.max(1, Number(chunkSize || 100));
    const result = [];
    for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
    return result;
}

async function postAuthenticated(serverName, url, payload, label) {
    return webServiceAuth.withAuthenticatedRequest(serverName, token => {
        const liveConfig = getConfig(serverName);
        return webServiceAuth.requestJson(url, {
            body: payload,
            headers: { Authorization: `Bearer ${token}` },
            timeoutMs: liveConfig.timeoutMs,
            label,
        });
    });
}

async function uploadRows(serverName, context, localFilePath) {
    const wsConfig = getConfig(serverName);
    const mallId = wsConfig.mallId || (wsConfig.authState && wsConfig.authState.mallId);
    const localId = wsConfig.localId || (wsConfig.authState && wsConfig.authState.localId);
    if (!mallId || !localId) throw new Error(`Webservice '${serverName}' identity not resolved. Use Probar conexión first.`);
    const rows = context.mappedData;
    if (!Array.isArray(rows)) throw new Error(`Webservice '${serverName}' requires mappedData array.`);
    const rowChunks = chunks(rows, wsConfig.chunkSize);
    const batchId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const url = webServiceAuth.buildUrl(wsConfig.baseUrl, wsConfig.syncPath, '/api/v1/exporter/sync/ingest');

    for (let index = 0; index < rowChunks.length; index += 1) {
        const payload = {
            mall_id: mallId,
            local_id: localId,
            rows: rowChunks[index],
            meta: Object.assign({}, context.meta || {}, {
                job_name: context.job && context.job.name,
                source_connection: context.job && context.job.sourceConnection,
                file_name: path.basename(localFilePath),
                exported_at: new Date().toISOString(),
                batch_id: batchId,
                chunk_index: index + 1,
                chunk_total: rowChunks.length,
                row_count: rowChunks[index].length,
            }),
        };
        await postAuthenticated(serverName, url, payload, `webservice sync (${serverName})`);
        logger.info(`Webservice sync '${serverName}' chunk ${index + 1}/${rowChunks.length} rows=${rowChunks[index].length}`);
    }
    return { ok: true, chunks: rowChunks.length };
}

async function upload(localFilePath, serverName, context) {
    const wsConfig = getConfig(serverName);
    const mode = String(wsConfig.mode || 'sync_rows').toLowerCase();
    if (mode === 'manual_execute') {
        if (!wsConfig.configId) throw new Error(`Webservice '${serverName}' missing configId.`);
        const url = webServiceAuth.buildUrl(wsConfig.baseUrl, wsConfig.manualExecutePath, '/api/v1/remote/execute-manual/exporter');
        const result = await postAuthenticated(serverName, url, {
            config_id: wsConfig.configId,
            filename: path.basename(localFilePath),
        }, `webservice manual execute (${serverName})`);
        logger.info(`Webservice manual execute successful for '${serverName}'`);
        return result.body;
    }
    return uploadRows(serverName, context || {}, localFilePath);
}

async function testConnection(serverName) {
    const token = await webServiceAuth.testConnection(serverName);
    return { ok: true, token };
}

module.exports = { testConnection, upload };
