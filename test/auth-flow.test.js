const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function jsonRequest(baseUrl, pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method || 'GET',
        headers: {
            'content-type': 'application/json',
            ...(options.headers || {})
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    let payload;
    const text = await response.text();
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = { raw: text };
    }

    return { response, payload };
}

test('auth token module flow (issue/use/refresh/revoke)', async (t) => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'msmall-auth-test-'));
    const configPath = path.join(tmpRoot, 'config', 'default.json');
    const authStorePath = path.join(tmpRoot, 'data', 'auth-store.json');

    writeJson(configPath, {
        logging: { level: 'info' },
        databases: {},
        ftpServers: {},
        jobs: [],
        ingestion: {
            authorizedMappings: [
                { mall_id: 'MALL-1', local_id: 'LOCAL-1', mapping_key: 'sales' },
                { mall_id: 'MALL-1', local_id: 'LOCAL-2', mapping_key: 'sales' },
                { mall_id: 'MALL-2', local_id: 'LOCAL-9', mapping_key: 'sales' }
            ]
        }
    });

    process.env.MSMALL_CONFIG_PATH = configPath;
    process.env.MSMALL_AUTH_STORE_PATH = authStorePath;
    process.env.MSMALL_AUTH_JWT_SECRET = 'test-secret-123';
    process.env.MSMALL_AUTH_RATE_LIMIT_MAX = '500';
    process.env.MSMALL_AUTH_APP_USERS_JSON = JSON.stringify([
        {
            username: 'admin',
            password: 'secret',
            scopes: ['tokens:manage', 'app:read', 'app:write', 'export:write', 'mapping:read'],
            allowed_malls: ['MALL-1', 'MALL-2']
        }
    ]);

    const apiModulePath = path.resolve(__dirname, '..', 'src', 'api.js');
    delete require.cache[apiModulePath];
    const { createApiRouter } = require('../src/api');

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter());

    const server = await new Promise((resolve) => {
        const instance = app.listen(0, () => resolve(instance));
    });
    t.after(() => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const appTokenRes = await jsonRequest(baseUrl, '/api/auth/token', {
        method: 'POST',
        body: {
            grant_type: 'password',
            token_type: 'app',
            username: 'admin',
            password: 'secret',
            mall_id: 'MALL-1',
            scope: ['tokens:manage', 'app:read', 'export:write', 'mapping:read']
        }
    });
    assert.equal(appTokenRes.response.status, 201, JSON.stringify(appTokenRes.payload));
    assert.ok(appTokenRes.payload.access_token);
    assert.ok(appTokenRes.payload.refresh_token);
    const adminAccessToken = appTokenRes.payload.access_token;

    const meRes = await jsonRequest(baseUrl, '/api/auth/me', {
        headers: { authorization: `Bearer ${adminAccessToken}` }
    });
    assert.equal(meRes.response.status, 200, JSON.stringify(meRes.payload));
    assert.equal(meRes.payload.token_type, 'app');
    assert.ok(Array.isArray(meRes.payload.scopes));

    const manualExporterRes = await jsonRequest(baseUrl, '/api/tokens', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminAccessToken}` },
        body: {
            mall_id: 'MALL-1',
            local_id: 'LOCAL-1',
            token_type: 'exporter',
            scopes: ['export:write', 'mapping:read']
        }
    });
    assert.equal(manualExporterRes.response.status, 201, JSON.stringify(manualExporterRes.payload));
    assert.ok(manualExporterRes.payload.access_token);
    assert.ok(manualExporterRes.payload.refresh_token);
    assert.ok(manualExporterRes.payload.client_credentials);
    const exporter1 = manualExporterRes.payload;

    const exporterClientGrantRes = await jsonRequest(baseUrl, '/api/auth/token', {
        method: 'POST',
        body: {
            grant_type: 'client_credentials',
            token_type: 'exporter',
            client_id: exporter1.client_credentials.client_id,
            client_secret: exporter1.client_credentials.client_secret,
            scope: ['export:write']
        }
    });
    assert.equal(exporterClientGrantRes.response.status, 201, JSON.stringify(exporterClientGrantRes.payload));
    const exporterClientAccess = exporterClientGrantRes.payload.access_token;

    const ingestOkRes = await jsonRequest(baseUrl, '/api/ingest/payload', {
        method: 'POST',
        headers: { authorization: `Bearer ${exporterClientAccess}` },
        body: {
            mall_id: 'MALL-1',
            local_id: 'LOCAL-1',
            mapping_key: 'sales',
            records: [{ id: 1 }, { id: 2 }]
        }
    });
    assert.equal(ingestOkRes.response.status, 200, JSON.stringify(ingestOkRes.payload));
    assert.equal(ingestOkRes.payload.received_records, 2);

    const ingestMismatchRes = await jsonRequest(baseUrl, '/api/ingest/payload', {
        method: 'POST',
        headers: { authorization: `Bearer ${exporterClientAccess}` },
        body: {
            mall_id: 'MALL-1',
            local_id: 'LOCAL-2',
            mapping_key: 'sales',
            records: []
        }
    });
    assert.equal(ingestMismatchRes.response.status, 403, JSON.stringify(ingestMismatchRes.payload));
    assert.equal(ingestMismatchRes.payload.code, 'local_id_mismatch');

    const refreshRes = await jsonRequest(baseUrl, '/api/auth/refresh', {
        method: 'POST',
        body: { refresh_token: exporter1.refresh_token }
    });
    assert.equal(refreshRes.response.status, 200, JSON.stringify(refreshRes.payload));
    assert.ok(refreshRes.payload.access_token);
    assert.ok(refreshRes.payload.refresh_token);
    assert.notEqual(refreshRes.payload.refresh_token, exporter1.refresh_token);

    const oldRefreshReplayRes = await jsonRequest(baseUrl, '/api/auth/refresh', {
        method: 'POST',
        body: { refresh_token: exporter1.refresh_token }
    });
    assert.equal(oldRefreshReplayRes.response.status, 401, JSON.stringify(oldRefreshReplayRes.payload));

    const listTokensRes = await jsonRequest(baseUrl, '/api/tokens?mall_id=MALL-1', {
        headers: { authorization: `Bearer ${adminAccessToken}` }
    });
    assert.equal(listTokensRes.response.status, 200, JSON.stringify(listTokensRes.payload));
    assert.ok(Array.isArray(listTokensRes.payload.items));
    assert.ok(listTokensRes.payload.items.length >= 1);
    assert.equal(listTokensRes.payload.items.some((item) => item.refresh_token), false, 'refresh_token must not be exposed in list');

    const localBulkTokenRes = await jsonRequest(baseUrl, '/api/tokens', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminAccessToken}` },
        body: {
            mall_id: 'MALL-1',
            local_id: 'LOCAL-1',
            token_type: 'exporter',
            scopes: ['export:write']
        }
    });
    assert.equal(localBulkTokenRes.response.status, 201, JSON.stringify(localBulkTokenRes.payload));
    const localBulkAccess = localBulkTokenRes.payload.access_token;

    const revokeLocalRes = await jsonRequest(baseUrl, '/api/auth/revoke/local', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminAccessToken}` },
        body: { mall_id: 'MALL-1', local_id: 'LOCAL-1', reason: 'security-incident' }
    });
    assert.equal(revokeLocalRes.response.status, 200, JSON.stringify(revokeLocalRes.payload));
    assert.ok(revokeLocalRes.payload.revoked_count >= 1);

    const localRevokedUseRes = await jsonRequest(baseUrl, '/api/ingest/payload', {
        method: 'POST',
        headers: { authorization: `Bearer ${localBulkAccess}` },
        body: {
            mall_id: 'MALL-1',
            local_id: 'LOCAL-1',
            mapping_key: 'sales',
            records: []
        }
    });
    assert.equal(localRevokedUseRes.response.status, 401, JSON.stringify(localRevokedUseRes.payload));

    const mallRevokedTargetRes = await jsonRequest(baseUrl, '/api/tokens', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminAccessToken}` },
        body: {
            mall_id: 'MALL-1',
            local_id: 'LOCAL-2',
            token_type: 'exporter',
            scopes: ['export:write']
        }
    });
    const otherMallRes = await jsonRequest(baseUrl, '/api/tokens', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminAccessToken}` },
        body: {
            mall_id: 'MALL-2',
            local_id: 'LOCAL-9',
            token_type: 'exporter',
            scopes: ['export:write']
        }
    });
    assert.equal(mallRevokedTargetRes.response.status, 201, JSON.stringify(mallRevokedTargetRes.payload));
    assert.equal(otherMallRes.response.status, 201, JSON.stringify(otherMallRes.payload));

    const revokeMallRes = await jsonRequest(baseUrl, '/api/auth/revoke/mall', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminAccessToken}` },
        body: { mall_id: 'MALL-1', reason: 'tenant-wide-lockdown' }
    });
    assert.equal(revokeMallRes.response.status, 200, JSON.stringify(revokeMallRes.payload));
    assert.ok(revokeMallRes.payload.revoked_count >= 1);

    const mallRevokedUseRes = await jsonRequest(baseUrl, '/api/ingest/payload', {
        method: 'POST',
        headers: { authorization: `Bearer ${mallRevokedTargetRes.payload.access_token}` },
        body: {
            mall_id: 'MALL-1',
            local_id: 'LOCAL-2',
            mapping_key: 'sales',
            records: []
        }
    });
    assert.equal(mallRevokedUseRes.response.status, 401, JSON.stringify(mallRevokedUseRes.payload));

    const otherMallStillWorksRes = await jsonRequest(baseUrl, '/api/ingest/payload', {
        method: 'POST',
        headers: { authorization: `Bearer ${otherMallRes.payload.access_token}` },
        body: {
            mall_id: 'MALL-2',
            local_id: 'LOCAL-9',
            mapping_key: 'sales',
            records: [{ id: 99 }]
        }
    });
    assert.equal(otherMallStillWorksRes.response.status, 200, JSON.stringify(otherMallStillWorksRes.payload));

    const appTokenMall2Res = await jsonRequest(baseUrl, '/api/auth/token', {
        method: 'POST',
        body: {
            grant_type: 'password',
            token_type: 'app',
            username: 'admin',
            password: 'secret',
            mall_id: 'MALL-2',
            scope: ['tokens:manage', 'app:read']
        }
    });
    assert.equal(appTokenMall2Res.response.status, 201, JSON.stringify(appTokenMall2Res.payload));
    const adminAccessTokenMall2 = appTokenMall2Res.payload.access_token;

    const regenerateSourceRes = await jsonRequest(baseUrl, '/api/tokens', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminAccessTokenMall2}` },
        body: {
            mall_id: 'MALL-2',
            local_id: 'LOCAL-9',
            token_type: 'exporter',
            scopes: ['export:write', 'mapping:read']
        }
    });
    assert.equal(regenerateSourceRes.response.status, 201, JSON.stringify(regenerateSourceRes.payload));

    const regenerateRes = await jsonRequest(baseUrl, `/api/tokens/${regenerateSourceRes.payload.issued_token.id}/regenerate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminAccessTokenMall2}` },
        body: { rotate_client_secret: true }
    });
    assert.equal(regenerateRes.response.status, 200, JSON.stringify(regenerateRes.payload));
    assert.ok(regenerateRes.payload.access_token);

    const auditRes = await jsonRequest(baseUrl, '/api/tokens/audit?mall_id=MALL-1', {
        headers: { authorization: `Bearer ${adminAccessTokenMall2}` }
    });
    assert.equal(auditRes.response.status, 200, JSON.stringify(auditRes.payload));
    assert.ok(auditRes.payload.items.some((item) => item.event_type === 'issued'));
});
