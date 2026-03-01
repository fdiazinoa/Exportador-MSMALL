const fs = require('fs');
const configLoader = require('./configLoader');
const logger = require('./logger');

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function parseJwtClaims(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch (_) {
    return null;
  }
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function getRetryConfig(wsConfig) {
  return {
    maxAttempts: Math.max(1, Number(wsConfig?.retry?.maxAttempts || 3)),
    baseDelayMs: Math.max(100, Number(wsConfig?.retry?.baseDelayMs || 1000)),
    maxDelayMs: Math.max(500, Number(wsConfig?.retry?.maxDelayMs || 30000)),
  };
}

function redactErrorMessage(message) {
  if (!message) return message;
  return String(message)
    .replace(/(client_secret\s*[:=]\s*)([^,\s]+)/ig, '$1[REDACTED]')
    .replace(/(refresh_token\s*[:=]\s*)([^,\s]+)/ig, '$1[REDACTED]')
    .replace(/(access_token\s*[:=]\s*)([^,\s]+)/ig, '$1[REDACTED]');
}

class WebServiceAuth {
  constructor() {
    this._inflight = new Map();
  }

  _loadConfig() {
    return configLoader.load();
  }

  _getWsConfig(serverName) {
    const config = this._loadConfig();
    const wsConfig = config.webServices?.[serverName];
    if (!wsConfig) {
      throw new Error(`Webservice configuration '${serverName}' not found.`);
    }
    if (!wsConfig.baseUrl) {
      throw new Error(`Webservice '${serverName}' missing baseUrl.`);
    }
    if (!wsConfig.clientId || !wsConfig.clientSecret) {
      throw new Error(`Webservice '${serverName}' missing clientId/clientSecret.`);
    }
    if (!wsConfig.mallId || !wsConfig.localId) {
      throw new Error(`Webservice '${serverName}' missing mallId/localId.`);
    }
    return { config, wsConfig };
  }

  _buildUrl(baseUrl, endpointPath, fallbackPath) {
    const root = String(baseUrl || '').replace(/\/$/, '');
    const p = String(endpointPath || fallbackPath || '').trim();
    if (!p.startsWith('/')) return `${root}/${p}`;
    return `${root}${p}`;
  }

  _persistAuthState(serverName, patch) {
    const config = this._loadConfig();
    if (!config.webServices || !config.webServices[serverName]) {
      return;
    }
    const current = config.webServices[serverName];
    current.authState = {
      ...(current.authState || {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(configLoader.configPath, JSON.stringify(config, null, 2));
  }

  _getAuthState(wsConfig) {
    return wsConfig.authState || {};
  }

  _isAccessTokenUsable(wsConfig, skewSeconds = 45) {
    const state = this._getAuthState(wsConfig);
    if (!state.accessToken) return false;
    const accessExpMs = Number(state.accessTokenExpMs || 0);
    if (!accessExpMs) return false;
    return accessExpMs - nowMs() > skewSeconds * 1000;
  }

  _shouldRefresh(wsConfig) {
    const state = this._getAuthState(wsConfig);
    const accessExpMs = Number(state.accessTokenExpMs || 0);
    const accessIatMs = Number(state.accessTokenIatMs || 0);
    if (!state.accessToken || !state.refreshToken || !accessExpMs || !accessIatMs) {
      return false;
    }
    const totalLifetime = Math.max(1, accessExpMs - accessIatMs);
    const remaining = accessExpMs - nowMs();
    return remaining > 0 && (remaining / totalLifetime) <= 0.20;
  }

  _refreshTokenUsable(wsConfig, skewSeconds = 60) {
    const state = this._getAuthState(wsConfig);
    if (!state.refreshToken) return false;
    const exp = Number(state.refreshTokenExpMs || 0);
    if (!exp) return true; // backward compatibility if not stored yet
    return exp - nowMs() > skewSeconds * 1000;
  }

  async _fetchJson(url, options, wsConfig, opLabel) {
    const retryCfg = getRetryConfig(wsConfig);
    let lastErr = null;

    for (let attempt = 1; attempt <= retryCfg.maxAttempts; attempt += 1) {
      const timeoutMs = Math.max(1000, Number(wsConfig.timeoutMs || 15000));
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const text = await response.text();
        const body = parseJsonSafely(text) ?? text;
        if (response.ok) {
          return { response, body };
        }

        const retryable = response.status === 429 || response.status >= 500;
        const err = new Error(`${opLabel} failed with status ${response.status}`);
        err.status = response.status;
        err.body = body;

        if (!retryable || attempt >= retryCfg.maxAttempts) {
          throw err;
        }

        const delayMs = Math.min(retryCfg.maxDelayMs, retryCfg.baseDelayMs * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * delayMs);
        logger.warn(`${opLabel} retry ${attempt}/${retryCfg.maxAttempts} status=${response.status} delayMs=${jitter}`);
        await sleep(jitter);
      } catch (error) {
        lastErr = error;
        const status = Number(error?.status || 0);
        const retryable = status === 429 || status >= 500 || error?.name === 'AbortError' || /timeout/i.test(String(error?.message || ''));
        if (!retryable || attempt >= retryCfg.maxAttempts) {
          throw error;
        }
        const delayMs = Math.min(retryCfg.maxDelayMs, retryCfg.baseDelayMs * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * delayMs);
        logger.warn(`${opLabel} retry ${attempt}/${retryCfg.maxAttempts} err=${redactErrorMessage(error.message)} delayMs=${jitter}`);
        await sleep(jitter);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastErr || new Error(`${opLabel} failed`);
  }

  _buildAuthPayload(wsConfig) {
    return {
      token_type: 'exporter',
      client_id: wsConfig.clientId,
      client_secret: wsConfig.clientSecret,
    };
  }

  _persistTokenPair(serverName, wsConfig, tokenBody) {
    const issuedAtMs = nowMs();
    const claims = parseJwtClaims(tokenBody.access_token) || {};
    const iatMs = claims.iat ? Number(claims.iat) * 1000 : issuedAtMs;
    const expMs = claims.exp ? Number(claims.exp) * 1000 : issuedAtMs + (Number(tokenBody.expires_in || 0) * 1000);
    const refreshExpMs = issuedAtMs + (Number(tokenBody.refresh_expires_in || 0) * 1000);

    this._persistAuthState(serverName, {
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token,
      accessTokenIatMs: iatMs || issuedAtMs,
      accessTokenExpMs: expMs || issuedAtMs,
      refreshTokenExpMs: refreshExpMs || undefined,
      tokenId: tokenBody.token_id,
      tokenKind: tokenBody.token_kind,
      lastAuthAt: new Date().toISOString(),
    });
  }

  async issueToken(serverName) {
    const { wsConfig } = this._getWsConfig(serverName);
    const url = this._buildUrl(wsConfig.baseUrl, wsConfig.auth?.tokenPath, '/auth/token');
    const { body } = await this._fetchJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this._buildAuthPayload(wsConfig)),
      },
      wsConfig,
      `webservice auth/token (${serverName})`
    );

    if (!body || typeof body !== 'object' || !body.access_token || !body.refresh_token) {
      throw new Error(`webservice auth/token (${serverName}) returned invalid response`);
    }

    this._persistTokenPair(serverName, wsConfig, body);
    logger.info(`Webservice token issued for '${serverName}' (token_type=exporter)`);
    return { accessToken: body.access_token, response: body };
  }

  async refreshToken(serverName) {
    const { wsConfig } = this._getWsConfig(serverName);
    const state = this._getAuthState(wsConfig);
    if (!state.refreshToken) {
      throw new Error(`webservice '${serverName}' has no refreshToken stored`);
    }
    const url = this._buildUrl(wsConfig.baseUrl, wsConfig.auth?.refreshPath, '/auth/refresh');
    const { body } = await this._fetchJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: state.refreshToken }),
      },
      wsConfig,
      `webservice auth/refresh (${serverName})`
    );

    if (!body || typeof body !== 'object' || !body.access_token || !body.refresh_token) {
      throw new Error(`webservice auth/refresh (${serverName}) returned invalid response`);
    }

    this._persistTokenPair(serverName, wsConfig, body);
    logger.info(`Webservice token refreshed for '${serverName}'`);
    return { accessToken: body.access_token, response: body };
  }

  async getAccessToken(serverName, opts = {}) {
    const forceFresh = !!opts.forceRefresh;
    const inflightKey = `${serverName}:${forceFresh ? 'force' : 'normal'}`;
    if (this._inflight.has(inflightKey)) {
      return this._inflight.get(inflightKey);
    }

    const task = (async () => {
      const { wsConfig } = this._getWsConfig(serverName);
      if (!forceFresh && this._isAccessTokenUsable(wsConfig) && !this._shouldRefresh(wsConfig)) {
        return this._getAuthState(wsConfig).accessToken;
      }

      try {
        if (!forceFresh && this._refreshTokenUsable(wsConfig)) {
          const refreshed = await this.refreshToken(serverName);
          return refreshed.accessToken;
        }
      } catch (error) {
        logger.warn(`Webservice refresh fallback to issue for '${serverName}': ${redactErrorMessage(error.message)}`);
      }

      const issued = await this.issueToken(serverName);
      return issued.accessToken;
    })();

    this._inflight.set(inflightKey, task);
    try {
      return await task;
    } finally {
      this._inflight.delete(inflightKey);
    }
  }

  async withAuthenticatedRequest(serverName, requestFn) {
    const token = await this.getAccessToken(serverName);
    try {
      return await requestFn(token);
    } catch (error) {
      const status = Number(error?.status || 0);
      if (status !== 401) throw error;
      const freshToken = await this.getAccessToken(serverName, { forceRefresh: true });
      return await requestFn(freshToken);
    }
  }

  async testConnection(serverName) {
    const token = await this.getAccessToken(serverName, { forceRefresh: true });
    return { ok: true, tokenAcquired: !!token };
  }
}

module.exports = new WebServiceAuth();
