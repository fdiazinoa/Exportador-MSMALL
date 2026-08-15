const fs = require('fs');
const http = require('http');
const https = require('https');
const configLoader = require('./configLoader');
const logger = require('./logger');

function parseJwtClaims(token) {
    if (!token || typeof token !== 'string') return {};
    const parts = token.split('.');
    if (parts.length < 2) return {};
    try {
        const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch (_) {
        return {};
    }
}

function errorDetail(body) {
    if (!body) return '';
    if (typeof body === 'string') return body.slice(0, 240);
    return String(body.detail || body.error || body.message || JSON.stringify(body)).slice(0, 240);
}

function requestJson(urlValue, options) {
    const target = new URL(urlValue);
    const bodyText = options.body ? JSON.stringify(options.body) : '';
    const transport = target.protocol === 'https:' ? https : http;
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30000));

    return new Promise((resolve, reject) => {
        const request = transport.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || undefined,
            path: target.pathname + target.search,
            method: options.method || 'POST',
            headers: Object.assign({
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyText),
            }, options.headers || {}),
        }, response => {
            let responseText = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { responseText += chunk; });
            response.on('end', () => {
                let responseBody = responseText;
                try { responseBody = responseText ? JSON.parse(responseText) : {}; } catch (_) {}
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve({ status: response.statusCode, body: responseBody, headers: response.headers });
                    return;
                }
                const error = new Error(`${options.label || 'Webservice'} failed with status ${response.statusCode}${errorDetail(responseBody) ? ` detail=${errorDetail(responseBody)}` : ''}`);
                error.status = response.statusCode;
                error.body = responseBody;
                reject(error);
            });
        });
        request.setTimeout(timeoutMs, () => request.destroy(new Error(`${options.label || 'Webservice'} timeout after ${timeoutMs}ms`)));
        request.on('error', reject);
        if (bodyText) request.write(bodyText);
        request.end();
    });
}

function buildUrl(baseUrl, endpointPath, fallbackPath) {
    const root = String(baseUrl || '').replace(/\/$/, '');
    const path = String(endpointPath || fallbackPath || '');
    return root + (path.startsWith('/') ? path : `/${path}`);
}

function getWebService(serverName) {
    const config = configLoader.load();
    const wsConfig = config.webServices && config.webServices[serverName];
    if (!wsConfig) throw new Error(`Webservice configuration '${serverName}' not found.`);
    if (!wsConfig.baseUrl) throw new Error(`Webservice '${serverName}' missing baseUrl.`);
    if (!wsConfig.clientId || !wsConfig.clientSecret) {
        throw new Error(`Webservice '${serverName}' missing clientId/clientSecret.`);
    }
    return { config, wsConfig };
}

function persistToken(serverName, wsConfig, tokenBody) {
    const config = configLoader.load();
    const target = config.webServices[serverName];
    const claims = parseJwtClaims(tokenBody.access_token);
    const issuedAtMs = Date.now();
    const mallId = claims.mall_id || wsConfig.mallId || (wsConfig.authState && wsConfig.authState.mallId);
    const localId = claims.local_id || wsConfig.localId || (wsConfig.authState && wsConfig.authState.localId);
    target.mallId = mallId || '';
    target.localId = localId || '';
    target.authState = Object.assign({}, target.authState || {}, {
        accessToken: tokenBody.access_token,
        refreshToken: tokenBody.refresh_token,
        accessTokenExpMs: claims.exp ? Number(claims.exp) * 1000 : issuedAtMs + Number(tokenBody.expires_in || 0) * 1000,
        refreshTokenExpMs: issuedAtMs + Number(tokenBody.refresh_expires_in || 0) * 1000,
        mallId: mallId || undefined,
        localId: localId || undefined,
        updatedAt: new Date().toISOString(),
    });
    fs.writeFileSync(configLoader.configPath, JSON.stringify(config, null, 2));
    return { mallId: mallId || null, localId: localId || null };
}

async function issueToken(serverName) {
    const current = getWebService(serverName);
    const wsConfig = current.wsConfig;
    const result = await requestJson(buildUrl(wsConfig.baseUrl, wsConfig.auth && wsConfig.auth.tokenPath, '/auth/token'), {
        body: { token_type: 'exporter', client_id: wsConfig.clientId, client_secret: wsConfig.clientSecret },
        timeoutMs: wsConfig.timeoutMs,
        label: `webservice auth/token (${serverName})`,
    });
    if (!result.body || !result.body.access_token) {
        throw new Error(`webservice auth/token (${serverName}) returned invalid response`);
    }
    const identity = persistToken(serverName, wsConfig, result.body);
    logger.info(`Webservice token issued for '${serverName}'`);
    return { accessToken: result.body.access_token, identity };
}

async function getAccessToken(serverName, forceFresh) {
    const current = getWebService(serverName);
    const state = current.wsConfig.authState || {};
    if (!forceFresh && state.accessToken && Number(state.accessTokenExpMs || 0) - Date.now() > 45000) {
        return state.accessToken;
    }
    return (await issueToken(serverName)).accessToken;
}

async function withAuthenticatedRequest(serverName, requestFn) {
    let token = await getAccessToken(serverName, false);
    try {
        return await requestFn(token);
    } catch (error) {
        if (Number(error.status || 0) !== 401) throw error;
        token = await getAccessToken(serverName, true);
        return requestFn(token);
    }
}

async function testConnection(serverName) {
    const result = await issueToken(serverName);
    return { ok: true, tokenAcquired: Boolean(result.accessToken), resolvedIdentity: result.identity };
}

module.exports = { buildUrl, getAccessToken, requestJson, testConnection, withAuthenticatedRequest };
