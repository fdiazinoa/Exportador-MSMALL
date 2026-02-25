const path = require('path');
const { DEFAULT_SCOPES } = require('./constants');

function parseIntegerEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeScopeList(input) {
    if (!input) return [];
    if (Array.isArray(input)) {
        return [...new Set(input.map(String).map(s => s.trim()).filter(Boolean))];
    }
    if (typeof input === 'string') {
        return [...new Set(input.split(/[\s,]+/).map(s => s.trim()).filter(Boolean))];
    }
    return [];
}

function parseAppUsersFromEnv() {
    const raw = process.env.MSMALL_AUTH_APP_USERS_JSON;
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed
                    .filter(Boolean)
                    .map((user) => ({
                        username: String(user.username || '').trim(),
                        password: String(user.password || ''),
                        scopes: normalizeScopeList(user.scopes),
                        allowed_malls: Array.isArray(user.allowed_malls)
                            ? user.allowed_malls.map(String)
                            : null,
                        display_name: user.display_name ? String(user.display_name) : undefined
                    }))
                    .filter((user) => user.username && user.password);
            }
        } catch (error) {
            throw new Error(`Invalid MSMALL_AUTH_APP_USERS_JSON: ${error.message}`);
        }
    }

    const username = process.env.MSMALL_AUTH_BOOTSTRAP_USER;
    const password = process.env.MSMALL_AUTH_BOOTSTRAP_PASSWORD;
    if (username && password) {
        const bootstrapScopes = normalizeScopeList(process.env.MSMALL_AUTH_BOOTSTRAP_SCOPES);
        return [{
            username,
            password,
            scopes: bootstrapScopes.length > 0 ? bootstrapScopes : DEFAULT_SCOPES,
            allowed_malls: null,
            display_name: 'Bootstrap Admin'
        }];
    }

    if (process.env.NODE_ENV !== 'production') {
        return [{
            username: 'admin',
            password: 'admin123',
            scopes: [...DEFAULT_SCOPES],
            allowed_malls: null,
            display_name: 'Dev Admin'
        }];
    }

    return [];
}

function getAuthSettings() {
    const jwtSecret = process.env.MSMALL_AUTH_JWT_SECRET || (process.env.NODE_ENV !== 'production' ? 'dev-only-change-me' : '');
    return {
        enabled: process.env.MSMALL_AUTH_ENABLED !== 'false',
        issuer: process.env.MSMALL_AUTH_ISSUER || 'exportador-msmall-node',
        audience: process.env.MSMALL_AUTH_AUDIENCE || 'msmall-services',
        jwtSecret,
        accessTtlAppSeconds: parseIntegerEnv('MSMALL_AUTH_ACCESS_TTL_APP_SECONDS', 30 * 60),
        refreshTtlAppSeconds: parseIntegerEnv('MSMALL_AUTH_REFRESH_TTL_APP_SECONDS', 14 * 24 * 60 * 60),
        accessTtlExporterSeconds: parseIntegerEnv('MSMALL_AUTH_ACCESS_TTL_EXPORTER_SECONDS', 12 * 60 * 60),
        refreshTtlExporterSeconds: parseIntegerEnv('MSMALL_AUTH_REFRESH_TTL_EXPORTER_SECONDS', 90 * 24 * 60 * 60),
        storePath: process.env.MSMALL_AUTH_STORE_PATH || path.join(process.cwd(), 'data', 'auth-store.json'),
        rateLimitWindowMs: parseIntegerEnv('MSMALL_AUTH_RATE_LIMIT_WINDOW_MS', 60 * 1000),
        rateLimitMax: parseIntegerEnv('MSMALL_AUTH_RATE_LIMIT_MAX', 30),
        protectConfigRoutes: process.env.MSMALL_AUTH_PROTECT_CONFIG_ROUTES === 'true',
        appUsers: parseAppUsersFromEnv(),
        allowedScopes: [...DEFAULT_SCOPES]
    };
}

module.exports = {
    getAuthSettings,
    normalizeScopeList
};
