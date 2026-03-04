const path = require('path');
const fs = require('fs');
const configLoader = require('./configLoader');
const logger = require('./logger');
const webServiceAuth = require('./webServiceAuth');

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function buildUrl(baseUrl, endpointPath, fallbackPath) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const p = String(endpointPath || fallbackPath || '').trim();
  if (!p.startsWith('/')) return `${root}/${p}`;
  return `${root}${p}`;
}

function maskError(error) {
  if (!error) return 'unknown';
  const msg = String(error.message || error);
  return msg
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/"(access_token|refresh_token|client_secret)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"');
}

class WebServiceUploader {
  _getConfig(serverName) {
    const config = configLoader.load();
    const wsConfig = config.webServices?.[serverName];
    if (!wsConfig) {
      throw new Error(`Webservice configuration '${serverName}' not found.`);
    }
    if (!wsConfig.baseUrl) {
      throw new Error(`Webservice '${serverName}' missing baseUrl.`);
    }
    return wsConfig;
  }

  _buildSyncPayload({ wsConfig, job, mappedData, filePath, extraMeta }) {
    const fileName = filePath ? path.basename(filePath) : undefined;
    const mallId = wsConfig.authState?.mallId || wsConfig.mallId;
    const localId = wsConfig.authState?.localId || wsConfig.localId;
    if (!mallId || !localId) {
      throw new Error(
        "Webservice identity not resolved yet. Run 'Test Connection' so MsMall can return mallId/localId from the exporter token.",
      );
    }
    return {
      mall_id: mallId,
      local_id: localId,
      rows: mappedData,
      meta: {
        job_name: job.name,
        format: (job.format || '').toUpperCase(),
        source_connection: job.sourceConnection,
        file_name: fileName,
        exported_at: new Date().toISOString(),
        ...(extraMeta || {}),
      },
    };
  }

  _chunkRows(rows, chunkSize) {
    if (!Array.isArray(rows) || rows.length === 0) return [[]];
    const size = Math.max(1, Number(chunkSize || 500));
    const chunks = [];
    for (let i = 0; i < rows.length; i += size) {
      chunks.push(rows.slice(i, i + size));
    }
    return chunks;
  }

  async _postJson(url, body, accessToken, wsConfig, label) {
    const timeoutMs = Math.max(1000, Number(wsConfig.timeoutMs || 30000));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = parseJsonSafe(text);
      if (!response.ok) {
        const err = new Error(`${label} failed with status ${response.status}`);
        err.status = response.status;
        err.body = parsed ?? text;
        throw err;
      }
      return parsed ?? { raw: text };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async uploadRows({ mappedData, job, serverName, filePath, meta }) {
    const wsConfig = this._getConfig(serverName);
    const syncUrl = buildUrl(wsConfig.baseUrl, wsConfig.syncPath, '/api/v1/exporter/sync/ingest');
    const chunks = this._chunkRows(mappedData, wsConfig.chunkSize || 500);
    const batchId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const results = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const rowsChunk = chunks[i];
      const result = await webServiceAuth.withAuthenticatedRequest(serverName, async (accessToken) => {
        try {
          const liveConfig = this._getConfig(serverName);
          const payload = this._buildSyncPayload({
            wsConfig: liveConfig,
            job,
            mappedData: rowsChunk,
            filePath,
            extraMeta: meta,
          });
          payload.meta = {
            ...(payload.meta || {}),
            batch_id: batchId,
            chunk_index: i + 1,
            chunk_total: chunks.length,
            row_count: rowsChunk.length,
          };
          return await this._postJson(
            syncUrl,
            payload,
            accessToken,
            liveConfig,
            `webservice sync (${serverName})`,
          );
        } catch (error) {
          logger.error(`Webservice sync failed for '${serverName}' chunk=${i + 1}/${chunks.length}: ${maskError(error)}`);
          throw error;
        }
      });
      results.push(result);
    }

    logger.info(`Webservice sync successful for '${serverName}' rows=${Array.isArray(mappedData) ? mappedData.length : 0} chunks=${chunks.length}`);
    return { ok: true, chunks: results.length, results };
  }

  async triggerManualExecute({ job, serverName, fileName }) {
    const wsConfig = this._getConfig(serverName);
    if (!wsConfig.configId) {
      throw new Error(`Webservice '${serverName}' missing configId for manual execute mode.`);
    }
    const manualUrl = buildUrl(wsConfig.baseUrl, wsConfig.manualExecutePath, '/api/v1/remote/execute-manual/exporter');
    const payload = { config_id: wsConfig.configId, filename: fileName };

    return webServiceAuth.withAuthenticatedRequest(serverName, async (accessToken) => {
      try {
        const result = await this._postJson(manualUrl, payload, accessToken, wsConfig, `webservice manual execute (${serverName})`);
        logger.info(`Webservice manual execute successful for '${serverName}' file=${fileName}`);
        return result;
      } catch (error) {
        logger.error(`Webservice manual execute failed for '${serverName}': ${maskError(error)}`);
        throw error;
      }
    });
  }

  async upload(localFilePath, serverName, context = {}) {
    const wsConfig = this._getConfig(serverName);
    const mode = String(wsConfig.mode || 'sync_rows').toLowerCase();
    if (mode === 'manual_execute') {
      return this.triggerManualExecute({
        job: context.job || {},
        serverName,
        fileName: path.basename(localFilePath),
      });
    }

    if (!Array.isArray(context.mappedData)) {
      throw new Error(`Webservice '${serverName}' sync_rows mode requires mappedData array.`);
    }

    return this.uploadRows({
      mappedData: context.mappedData,
      job: context.job || {},
      serverName,
      filePath: localFilePath,
      meta: context.meta || {},
    });
  }

  async testConnection(serverName) {
    const wsConfig = this._getConfig(serverName);
    const tokenResult = await webServiceAuth.testConnection(serverName);
    let syncProbe = null;
    if (wsConfig.testSyncOnConnect) {
      const syncUrl = buildUrl(wsConfig.baseUrl, wsConfig.syncPath, '/api/v1/exporter/sync/ingest');
      syncProbe = await webServiceAuth.withAuthenticatedRequest(serverName, async (accessToken) => {
        const liveConfig = this._getConfig(serverName);
        const mallId = liveConfig.authState?.mallId || liveConfig.mallId;
        const localId = liveConfig.authState?.localId || liveConfig.localId;
        return this._postJson(syncUrl, {
          mall_id: mallId,
          local_id: localId,
          rows: [],
          meta: { probe: true, at: new Date().toISOString() },
        }, accessToken, liveConfig, `webservice sync probe (${serverName})`);
      });
    }
    return { ok: true, token: tokenResult, syncProbe };
  }
}

module.exports = new WebServiceUploader();
