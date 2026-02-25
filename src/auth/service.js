const crypto = require('crypto');
const AuthStore = require('./store');
const {
    TOKEN_TYPES,
    TOKEN_STATUS,
    AUDIT_EVENTS
} = require('./constants');
const { getAuthSettings, normalizeScopeList } = require('./settings');
const {
    hashSecret,
    verifySecretHash,
    createRefreshToken,
    parseRefreshToken,
    signJwtHS256,
    verifyJwtHS256,
    randomToken
} = require('./crypto');

class HttpError extends Error {
    constructor(statusCode, message, code, details) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode;
        this.code = code || 'error';
        this.details = details;
    }
}

function nowIso() {
    return new Date().toISOString();
}

function toUnixSeconds(date) {
    return Math.floor(new Date(date).getTime() / 1000);
}

function asStringOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    return String(value);
}

function maskClientId(clientId) {
    if (!clientId) return null;
    const value = String(clientId);
    if (value.length <= 6) return `${value.slice(0, 2)}***`;
    return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function sanitizeTokenRecord(record) {
    if (!record) return null;
    return {
        id: record.id,
        mall_id: record.mall_id,
        local_id: record.local_id,
        token_type: record.token_type,
        scopes: Array.isArray(record.scopes) ? [...record.scopes] : [],
        jti: record.jti,
        access_expires_at: record.access_expires_at,
        refresh_expires_at: record.refresh_expires_at,
        status: record.status,
        created_by: record.created_by,
        service_account_id: record.service_account_id || null,
        last_used_at: record.last_used_at || null,
        last_used_ip: record.last_used_ip || null,
        last_used_ua: record.last_used_ua || null,
        revoked_at: record.revoked_at || null,
        revoked_by: record.revoked_by || null,
        revoke_reason: record.revoke_reason || null,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

function sanitizeServiceAccount(record) {
    if (!record) return null;
    return {
        id: record.id,
        name: record.name || null,
        client_id: record.client_id,
        client_id_masked: maskClientId(record.client_id),
        mall_id: record.mall_id,
        local_id: record.local_id,
        token_type: record.token_type,
        scopes: Array.isArray(record.scopes) ? [...record.scopes] : [],
        status: record.status,
        created_by: record.created_by,
        last_used_at: record.last_used_at || null,
        last_used_ip: record.last_used_ip || null,
        last_used_ua: record.last_used_ua || null,
        created_at: record.created_at,
        updated_at: record.updated_at
    };
}

function buildActorString(actor) {
    if (!actor) return 'system';
    if (typeof actor === 'string') return actor;
    if (actor.subject) return String(actor.subject);
    if (actor.username) return `user:${actor.username}`;
    if (actor.client_id) return `client:${actor.client_id}`;
    return 'system';
}

function normalizeTokenType(value) {
    if (!value) return null;
    const normalized = String(value).toLowerCase();
    if (normalized === TOKEN_TYPES.APP || normalized === TOKEN_TYPES.EXPORTER) return normalized;
    return null;
}

function ensureMallId(mallId) {
    if (!mallId) {
        throw new HttpError(400, 'mall_id is required', 'missing_mall_id');
    }
}

function ensureExporterLocalId(localId) {
    if (!localId) {
        throw new HttpError(400, 'local_id is required for exporter tokens', 'missing_local_id');
    }
}

class AuthService {
    constructor({ logger, configLoader, settings, store } = {}) {
        this.logger = logger;
        this.configLoader = configLoader;
        this.settings = settings || getAuthSettings();
        if (!this.settings.jwtSecret) {
            throw new Error('MSMALL_AUTH_JWT_SECRET is required when auth is enabled');
        }
        this.store = store || new AuthStore({
            storePath: this.settings.storePath,
            logger: this.logger
        });
        this.store.runMigrations();
    }

    getSettings() {
        return this.settings;
    }

    runMigrations() {
        return this.store.runMigrations();
    }

    getTtlsForType(tokenType) {
        if (tokenType === TOKEN_TYPES.EXPORTER) {
            return {
                accessTtlSeconds: this.settings.accessTtlExporterSeconds,
                refreshTtlSeconds: this.settings.refreshTtlExporterSeconds
            };
        }
        return {
            accessTtlSeconds: this.settings.accessTtlAppSeconds,
            refreshTtlSeconds: this.settings.refreshTtlAppSeconds
        };
    }

    normalizeScopes(requestedScopes, allowedScopes) {
        const allowed = new Set(normalizeScopeList(allowedScopes));
        const requested = normalizeScopeList(requestedScopes);
        const effectiveRequested = requested.length > 0 ? requested : [...allowed];
        for (const scope of effectiveRequested) {
            if (!allowed.has(scope)) {
                throw new HttpError(400, `Scope not allowed: ${scope}`, 'invalid_scope');
            }
        }
        return effectiveRequested;
    }

    resolveAppUser(username, password, mallId, requestedScopes) {
        const user = this.settings.appUsers.find((entry) => entry.username === username);
        if (!user || user.password !== password) {
            throw new HttpError(401, 'Invalid app credentials', 'invalid_credentials');
        }

        ensureMallId(mallId);
        if (Array.isArray(user.allowed_malls) && user.allowed_malls.length > 0 && !user.allowed_malls.includes(String(mallId))) {
            throw new HttpError(403, 'mall_id not allowed for this user', 'mall_not_allowed');
        }

        const allowedScopes = user.scopes?.length ? user.scopes : this.settings.allowedScopes;
        const scopes = this.normalizeScopes(requestedScopes, allowedScopes);
        return {
            username: user.username,
            subject: `user:${user.username}`,
            mall_id: String(mallId),
            local_id: null,
            token_type: TOKEN_TYPES.APP,
            scopes,
            display_name: user.display_name || user.username
        };
    }

    issueAppTokenWithPassword({ username, password, mall_id, scope }, context = {}) {
        const principalSeed = this.resolveAppUser(String(username || '').trim(), String(password || ''), mall_id, scope);
        return this.issueTokenSession({
            mall_id: principalSeed.mall_id,
            local_id: null,
            token_type: TOKEN_TYPES.APP,
            scopes: principalSeed.scopes,
            created_by: principalSeed.subject,
            subject: principalSeed.subject,
            metadata: { grant_type: 'password' }
        }, context);
    }

    issueExporterTokenWithClientCredentials({ client_id, client_secret, scope }, context = {}) {
        const now = new Date();
        const clientId = String(client_id || '').trim();
        const clientSecret = String(client_secret || '');
        if (!clientId || !clientSecret) {
            throw new HttpError(400, 'client_id and client_secret are required', 'missing_client_credentials');
        }

        const remoteMeta = this.getRequestMeta(context.req);
        return this.store.transaction((store) => {
            this.pruneRevokedJtis(store, now);
            const account = store.service_accounts.find((item) => item.client_id === clientId);
            if (!account || account.status !== TOKEN_STATUS.ACTIVE) {
                this.appendAudit(store, {
                    token_id: null,
                    event_type: AUDIT_EVENTS.FAILED,
                    mall_id: account?.mall_id || null,
                    local_id: account?.local_id || null,
                    ip: remoteMeta.ip,
                    ua: remoteMeta.ua,
                    metadata: { stage: 'auth_token', grant_type: 'client_credentials', reason: 'invalid_client', client_id_masked: maskClientId(clientId) }
                });
                throw new HttpError(401, 'Invalid exporter credentials', 'invalid_client_credentials');
            }
            if (!verifySecretHash(clientSecret, account.client_secret_hash)) {
                this.appendAudit(store, {
                    token_id: null,
                    event_type: AUDIT_EVENTS.FAILED,
                    mall_id: account.mall_id,
                    local_id: account.local_id,
                    ip: remoteMeta.ip,
                    ua: remoteMeta.ua,
                    metadata: { stage: 'auth_token', grant_type: 'client_credentials', reason: 'invalid_client_secret', client_id_masked: maskClientId(clientId) }
                });
                throw new HttpError(401, 'Invalid exporter credentials', 'invalid_client_credentials');
            }

            ensureMallId(account.mall_id);
            ensureExporterLocalId(account.local_id);

            const scopes = this.normalizeScopes(scope, account.scopes?.length ? account.scopes : ['export:write']);
            account.last_used_at = now.toISOString();
            account.last_used_ip = remoteMeta.ip;
            account.last_used_ua = remoteMeta.ua;
            account.updated_at = now.toISOString();

            return this.issueTokenSessionInStore(store, {
                mall_id: account.mall_id,
                local_id: account.local_id,
                token_type: TOKEN_TYPES.EXPORTER,
                scopes,
                created_by: `client:${account.id}`,
                subject: `service_account:${account.id}`,
                service_account_id: account.id,
                metadata: { grant_type: 'client_credentials', client_id_masked: maskClientId(account.client_id) }
            }, context, now);
        });
    }

    issueTokenSession(params, context = {}) {
        return this.store.transaction((store) => {
            return this.issueTokenSessionInStore(store, params, context, new Date());
        });
    }

    issueTokenSessionInStore(store, params, context = {}, now = new Date()) {
        const tokenType = normalizeTokenType(params.token_type);
        if (!tokenType) {
            throw new HttpError(400, 'Invalid token_type', 'invalid_token_type');
        }

        const mallId = asStringOrNull(params.mall_id);
        const localId = asStringOrNull(params.local_id);
        ensureMallId(mallId);
        if (tokenType === TOKEN_TYPES.EXPORTER) {
            ensureExporterLocalId(localId);
        }

        const requestedScopes = normalizeScopeList(params.scopes);
        const allowedScopes = this.settings.allowedScopes;
        const scopes = requestedScopes.length ? this.normalizeScopes(requestedScopes, allowedScopes) : [];
        if (scopes.length === 0) {
            if (tokenType === TOKEN_TYPES.EXPORTER) {
                scopes.push('export:write');
            } else {
                scopes.push('app:read');
            }
        }

        const defaults = this.getTtlsForType(tokenType);
        const accessTtlSeconds = Number.isFinite(params.access_ttl_seconds) && params.access_ttl_seconds > 0
            ? params.access_ttl_seconds
            : defaults.accessTtlSeconds;
        const refreshTtlSeconds = Number.isFinite(params.refresh_ttl_seconds) && params.refresh_ttl_seconds > 0
            ? params.refresh_ttl_seconds
            : defaults.refreshTtlSeconds;

        const issuedAt = now;
        const accessExpiresAt = new Date(issuedAt.getTime() + accessTtlSeconds * 1000);
        const refreshExpiresAt = new Date(issuedAt.getTime() + refreshTtlSeconds * 1000);
        const tokenId = crypto.randomUUID();
        const jti = crypto.randomUUID();
        const refreshToken = createRefreshToken(tokenId);
        const refreshParsed = parseRefreshToken(refreshToken);
        const refreshTokenHash = hashSecret(refreshParsed.secret);

        const payload = {
            iss: this.settings.issuer,
            aud: this.settings.audience,
            sub: params.subject || params.created_by || 'system',
            mall_id: mallId,
            token_type: tokenType,
            scope: scopes,
            jti,
            iat: Math.floor(issuedAt.getTime() / 1000),
            exp: Math.floor(accessExpiresAt.getTime() / 1000),
            token_id: tokenId
        };
        if (tokenType === TOKEN_TYPES.EXPORTER) {
            payload.local_id = localId;
        }

        const accessToken = signJwtHS256(payload, this.settings.jwtSecret);
        const record = {
            id: tokenId,
            mall_id: mallId,
            local_id: tokenType === TOKEN_TYPES.EXPORTER ? localId : null,
            token_type: tokenType,
            scopes,
            jti,
            access_expires_at: accessExpiresAt.toISOString(),
            refresh_token_hash: refreshTokenHash,
            refresh_expires_at: refreshExpiresAt.toISOString(),
            status: TOKEN_STATUS.ACTIVE,
            created_by: params.created_by || 'system',
            subject: params.subject || params.created_by || 'system',
            service_account_id: params.service_account_id || null,
            last_used_at: null,
            last_used_ip: null,
            last_used_ua: null,
            revoked_at: null,
            revoked_by: null,
            revoke_reason: null,
            created_at: issuedAt.toISOString(),
            updated_at: issuedAt.toISOString()
        };

        store.api_tokens.push(record);

        const remoteMeta = this.getRequestMeta(context.req);
        this.appendAudit(store, {
            token_id: record.id,
            event_type: AUDIT_EVENTS.ISSUED,
            mall_id: record.mall_id,
            local_id: record.local_id,
            ip: remoteMeta.ip,
            ua: remoteMeta.ua,
            metadata: params.metadata || { stage: 'issue' }
        });

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: 'Bearer',
            expires_in: accessTtlSeconds,
            refresh_expires_in: refreshTtlSeconds,
            scope: scopes,
            scope_string: scopes.join(' '),
            issued_token: sanitizeTokenRecord(record)
        };
    }

    createServiceAccount({ mall_id, local_id, scopes, name, created_by }) {
        const mallId = asStringOrNull(mall_id);
        const localId = asStringOrNull(local_id);
        ensureMallId(mallId);
        ensureExporterLocalId(localId);
        const normalizedScopes = this.normalizeScopes(scopes && normalizeScopeList(scopes).length ? scopes : ['export:write'], this.settings.allowedScopes);

        return this.store.transaction((store) => {
            const now = nowIso();
            const clientId = `exp_${randomToken(12)}`;
            const clientSecret = randomToken(24);
            const account = {
                id: crypto.randomUUID(),
                name: name ? String(name) : `exporter-${mallId}-${localId}`,
                client_id: clientId,
                client_secret_hash: hashSecret(clientSecret),
                mall_id: mallId,
                local_id: localId,
                token_type: TOKEN_TYPES.EXPORTER,
                scopes: normalizedScopes,
                status: TOKEN_STATUS.ACTIVE,
                created_by: created_by || 'system',
                last_used_at: null,
                last_used_ip: null,
                last_used_ua: null,
                created_at: now,
                updated_at: now
            };
            store.service_accounts.push(account);
            return {
                service_account: sanitizeServiceAccount(account),
                client_secret: clientSecret
            };
        });
    }

    createManualToken(payload, actor, context = {}) {
        const tokenType = normalizeTokenType(payload.token_type);
        if (!tokenType) {
            throw new HttpError(400, 'token_type must be app or exporter', 'invalid_token_type');
        }

        const mallId = asStringOrNull(payload.mall_id);
        const localId = asStringOrNull(payload.local_id);
        ensureMallId(mallId);
        if (tokenType === TOKEN_TYPES.EXPORTER) {
            ensureExporterLocalId(localId);
        }

        let serviceCredentials = null;
        let serviceAccountId = null;
        const shouldProvisionServiceAccount = tokenType === TOKEN_TYPES.EXPORTER && payload.provision_service_account !== false;
        if (shouldProvisionServiceAccount) {
            const provisioned = this.createServiceAccount({
                mall_id: mallId,
                local_id: localId,
                scopes: payload.scopes,
                name: payload.service_account_name,
                created_by: buildActorString(actor)
            });
            serviceCredentials = provisioned;
            serviceAccountId = provisioned.service_account.id;
        }

        const tokenResponse = this.issueTokenSession({
            mall_id: mallId,
            local_id: tokenType === TOKEN_TYPES.EXPORTER ? localId : null,
            token_type: tokenType,
            scopes: payload.scopes,
            created_by: buildActorString(actor),
            subject: payload.subject || buildActorString(actor),
            service_account_id: serviceAccountId,
            access_ttl_seconds: Number.isFinite(Number(payload.expires_in)) ? Number(payload.expires_in) : undefined,
            refresh_ttl_seconds: Number.isFinite(Number(payload.refresh_expires_in)) ? Number(payload.refresh_expires_in) : undefined,
            metadata: { stage: 'manual_create' }
        }, context);

        if (serviceCredentials) {
            tokenResponse.service_account = serviceCredentials.service_account;
            tokenResponse.client_credentials = {
                client_id: serviceCredentials.service_account.client_id,
                client_secret: serviceCredentials.client_secret
            };
        }
        return tokenResponse;
    }

    refreshToken({ refresh_token }, context = {}) {
        const parsed = parseRefreshToken(refresh_token);
        const remoteMeta = this.getRequestMeta(context.req);
        if (!parsed) {
            throw new HttpError(400, 'Invalid refresh token format', 'invalid_refresh_token');
        }

        return this.store.transaction((store) => {
            const now = new Date();
            this.pruneRevokedJtis(store, now);
            const record = store.api_tokens.find((item) => item.id === parsed.tokenId);
            if (!record) {
                this.appendAudit(store, {
                    token_id: null,
                    event_type: AUDIT_EVENTS.FAILED,
                    mall_id: null,
                    local_id: null,
                    ip: remoteMeta.ip,
                    ua: remoteMeta.ua,
                    metadata: { stage: 'refresh', reason: 'token_not_found' }
                });
                throw new HttpError(401, 'Refresh token is invalid', 'invalid_refresh_token');
            }

            if (record.status !== TOKEN_STATUS.ACTIVE || record.revoked_at) {
                this.appendAudit(store, {
                    token_id: record.id,
                    event_type: AUDIT_EVENTS.FAILED,
                    mall_id: record.mall_id,
                    local_id: record.local_id,
                    ip: remoteMeta.ip,
                    ua: remoteMeta.ua,
                    metadata: { stage: 'refresh', reason: 'token_revoked_or_inactive' }
                });
                throw new HttpError(401, 'Refresh token is revoked', 'refresh_token_revoked');
            }

            if (new Date(record.refresh_expires_at).getTime() <= now.getTime()) {
                this.revokeRecordInStore(store, record, {
                    actor: 'system',
                    reason: 'refresh_expired',
                    now,
                    addAudit: true,
                    requestMeta: remoteMeta
                });
                throw new HttpError(401, 'Refresh token expired', 'refresh_token_expired');
            }

            if (!verifySecretHash(parsed.secret, record.refresh_token_hash)) {
                // Rotation replay / stolen token attempt: revoke session immediately.
                this.revokeRecordInStore(store, record, {
                    actor: 'system',
                    reason: 'refresh_reuse_detected',
                    now,
                    addAudit: true,
                    requestMeta: remoteMeta
                });
                this.appendAudit(store, {
                    token_id: record.id,
                    event_type: AUDIT_EVENTS.FAILED,
                    mall_id: record.mall_id,
                    local_id: record.local_id,
                    ip: remoteMeta.ip,
                    ua: remoteMeta.ua,
                    metadata: { stage: 'refresh', reason: 'refresh_reuse_detected' }
                });
                throw new HttpError(401, 'Refresh token is invalid', 'invalid_refresh_token');
            }

            this.addRevokedAccessJti(store, {
                jti: record.jti,
                token_id: record.id,
                expires_at: record.access_expires_at,
                reason: 'rotated',
                created_by: 'system'
            });

            const defaults = this.getTtlsForType(record.token_type);
            const accessExpiresAt = new Date(now.getTime() + defaults.accessTtlSeconds * 1000);
            const refreshExpiresAt = new Date(now.getTime() + defaults.refreshTtlSeconds * 1000);
            const newJti = crypto.randomUUID();
            const newRefreshToken = createRefreshToken(record.id);
            const newRefreshParsed = parseRefreshToken(newRefreshToken);

            record.jti = newJti;
            record.access_expires_at = accessExpiresAt.toISOString();
            record.refresh_expires_at = refreshExpiresAt.toISOString();
            record.refresh_token_hash = hashSecret(newRefreshParsed.secret);
            record.updated_at = now.toISOString();

            const payload = {
                iss: this.settings.issuer,
                aud: this.settings.audience,
                sub: record.subject || record.created_by || `token:${record.id}`,
                mall_id: record.mall_id,
                token_type: record.token_type,
                scope: Array.isArray(record.scopes) ? [...record.scopes] : [],
                jti: newJti,
                iat: Math.floor(now.getTime() / 1000),
                exp: Math.floor(accessExpiresAt.getTime() / 1000),
                token_id: record.id
            };
            if (record.token_type === TOKEN_TYPES.EXPORTER) {
                payload.local_id = record.local_id;
            }
            const accessToken = signJwtHS256(payload, this.settings.jwtSecret);

            this.appendAudit(store, {
                token_id: record.id,
                event_type: AUDIT_EVENTS.REFRESHED,
                mall_id: record.mall_id,
                local_id: record.local_id,
                ip: remoteMeta.ip,
                ua: remoteMeta.ua,
                metadata: { stage: 'refresh' }
            });

            return {
                access_token: accessToken,
                refresh_token: newRefreshToken,
                token_type: 'Bearer',
                expires_in: defaults.accessTtlSeconds,
                refresh_expires_in: defaults.refreshTtlSeconds,
                scope: Array.isArray(record.scopes) ? [...record.scopes] : [],
                scope_string: Array.isArray(record.scopes) ? record.scopes.join(' ') : '',
                issued_token: sanitizeTokenRecord(record)
            };
        });
    }

    listTokens(filters = {}) {
        return this.store.transaction((store, tx) => {
            tx.save = false;
            return store.api_tokens
                .filter((record) => {
                    if (filters.mall_id && record.mall_id !== String(filters.mall_id)) return false;
                    if (filters.local_id && record.local_id !== String(filters.local_id)) return false;
                    if (filters.token_type && record.token_type !== String(filters.token_type)) return false;
                    if (filters.status && record.status !== String(filters.status)) return false;
                    return true;
                })
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map(sanitizeTokenRecord);
        });
    }

    listAuditLogs(filters = {}) {
        return this.store.transaction((store, tx) => {
            tx.save = false;
            return store.token_audit_log
                .filter((entry) => {
                    if (filters.mall_id && entry.mall_id !== String(filters.mall_id)) return false;
                    if (filters.local_id && entry.local_id !== String(filters.local_id)) return false;
                    if (filters.token_id && entry.token_id !== String(filters.token_id)) return false;
                    return true;
                })
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        });
    }

    setTokenStatus(id, status, actor, reason = null) {
        const normalized = String(status || '').toLowerCase();
        if (![TOKEN_STATUS.ACTIVE, TOKEN_STATUS.INACTIVE].includes(normalized)) {
            throw new HttpError(400, 'status must be active or inactive', 'invalid_status');
        }

        return this.store.transaction((store) => {
            const now = new Date();
            this.pruneRevokedJtis(store, now);
            const record = store.api_tokens.find((item) => item.id === id);
            if (!record) {
                throw new HttpError(404, 'Token not found', 'token_not_found');
            }
            if (record.status === TOKEN_STATUS.REVOKED) {
                throw new HttpError(409, 'Revoked tokens cannot be reactivated', 'token_already_revoked');
            }

            if (normalized === TOKEN_STATUS.INACTIVE && record.status !== TOKEN_STATUS.INACTIVE) {
                this.addRevokedAccessJti(store, {
                    jti: record.jti,
                    token_id: record.id,
                    expires_at: record.access_expires_at,
                    reason: 'status_inactive',
                    created_by: buildActorString(actor)
                });
            }

            record.status = normalized;
            record.updated_at = now.toISOString();
            if (normalized === TOKEN_STATUS.ACTIVE) {
                record.revoke_reason = null;
            }

            this.appendAudit(store, {
                token_id: record.id,
                event_type: AUDIT_EVENTS.REVOKED,
                mall_id: record.mall_id,
                local_id: record.local_id,
                ip: null,
                ua: null,
                metadata: { stage: 'status_patch', new_status: normalized, reason: reason || null, actor: buildActorString(actor) }
            });

            return sanitizeTokenRecord(record);
        });
    }

    regenerateToken(id, actor, context = {}, options = {}) {
        let clientCredentials = null;
        let tokenResponse;

        return this.store.transaction((store) => {
            const now = new Date();
            this.pruneRevokedJtis(store, now);
            const record = store.api_tokens.find((item) => item.id === id);
            if (!record) {
                throw new HttpError(404, 'Token not found', 'token_not_found');
            }
            if (record.status === TOKEN_STATUS.REVOKED) {
                throw new HttpError(409, 'Cannot regenerate a revoked token', 'token_already_revoked');
            }

            let linkedServiceAccount = null;
            if (record.service_account_id) {
                linkedServiceAccount = store.service_accounts.find((item) => item.id === record.service_account_id) || null;
                if (linkedServiceAccount && options.rotate_client_secret) {
                    const newSecret = randomToken(24);
                    linkedServiceAccount.client_secret_hash = hashSecret(newSecret);
                    linkedServiceAccount.updated_at = now.toISOString();
                    clientCredentials = {
                        client_id: linkedServiceAccount.client_id,
                        client_secret: newSecret
                    };
                }
            }

            this.revokeRecordInStore(store, record, {
                actor: buildActorString(actor),
                reason: options.reason || 'regenerated',
                now,
                addAudit: true,
                requestMeta: this.getRequestMeta(context.req)
            });

            tokenResponse = this.issueTokenSessionInStore(store, {
                mall_id: record.mall_id,
                local_id: record.local_id,
                token_type: record.token_type,
                scopes: record.scopes,
                created_by: buildActorString(actor),
                subject: buildActorString(actor),
                service_account_id: record.service_account_id,
                metadata: { stage: 'regenerate' }
            }, context, now);

            if (linkedServiceAccount) {
                tokenResponse.service_account = sanitizeServiceAccount(linkedServiceAccount);
                if (clientCredentials) {
                    tokenResponse.client_credentials = clientCredentials;
                }
            }

            return tokenResponse;
        });
    }

    revokeByCurrentJti(jti, actor, context = {}, reason = 'manual_revoke') {
        return this.revokeByIdOrJti({ jti }, actor, context, reason);
    }

    revokeByIdOrJti({ id, jti }, actor, context = {}, reason = 'manual_revoke') {
        if (!id && !jti) {
            throw new HttpError(400, 'Provide id or jti', 'missing_revoke_target');
        }

        return this.store.transaction((store) => {
            const now = new Date();
            this.pruneRevokedJtis(store, now);
            const record = store.api_tokens.find((item) => (id && item.id === id) || (jti && item.jti === jti));
            if (!record) {
                throw new HttpError(404, 'Token not found', 'token_not_found');
            }
            this.revokeRecordInStore(store, record, {
                actor: buildActorString(actor),
                reason,
                now,
                addAudit: true,
                requestMeta: this.getRequestMeta(context.req)
            });
            return sanitizeTokenRecord(record);
        });
    }

    revokeByLocal({ mall_id, local_id }, actor, context = {}, reason = 'bulk_revoke_local') {
        const mallId = asStringOrNull(mall_id);
        const localId = asStringOrNull(local_id);
        ensureMallId(mallId);
        ensureExporterLocalId(localId);
        return this.bulkRevoke(
            (record) => record.mall_id === mallId && record.local_id === localId,
            actor,
            context,
            reason
        );
    }

    revokeByMall({ mall_id }, actor, context = {}, reason = 'bulk_revoke_mall') {
        const mallId = asStringOrNull(mall_id);
        ensureMallId(mallId);
        return this.bulkRevoke(
            (record) => record.mall_id === mallId,
            actor,
            context,
            reason
        );
    }

    bulkRevoke(predicate, actor, context = {}, reason) {
        return this.store.transaction((store) => {
            const now = new Date();
            this.pruneRevokedJtis(store, now);
            let revokedCount = 0;
            for (const record of store.api_tokens) {
                if (!predicate(record)) continue;
                if (record.status === TOKEN_STATUS.REVOKED) continue;
                this.revokeRecordInStore(store, record, {
                    actor: buildActorString(actor),
                    reason,
                    now,
                    addAudit: true,
                    requestMeta: this.getRequestMeta(context.req)
                });
                revokedCount += 1;
            }
            return { revoked_count: revokedCount };
        });
    }

    revokeRecordInStore(store, record, { actor, reason, now, addAudit, requestMeta } = {}) {
        if (record.status !== TOKEN_STATUS.REVOKED) {
            record.status = TOKEN_STATUS.REVOKED;
            record.revoked_at = (now || new Date()).toISOString();
            record.revoked_by = actor || 'system';
            record.revoke_reason = reason || 'revoked';
            record.updated_at = (now || new Date()).toISOString();
            this.addRevokedAccessJti(store, {
                jti: record.jti,
                token_id: record.id,
                expires_at: record.access_expires_at,
                reason: record.revoke_reason,
                created_by: record.revoked_by
            });
        }

        if (addAudit) {
            this.appendAudit(store, {
                token_id: record.id,
                event_type: AUDIT_EVENTS.REVOKED,
                mall_id: record.mall_id,
                local_id: record.local_id,
                ip: requestMeta?.ip || null,
                ua: requestMeta?.ua || null,
                metadata: { reason: record.revoke_reason, actor: record.revoked_by }
            });
        }
    }

    addRevokedAccessJti(store, entry) {
        if (!entry?.jti) return;
        const existing = store.revoked_access_jtis.find((item) => item.jti === entry.jti);
        if (existing) return;
        store.revoked_access_jtis.push({
            jti: entry.jti,
            token_id: entry.token_id || null,
            expires_at: entry.expires_at || null,
            reason: entry.reason || null,
            created_by: entry.created_by || 'system',
            created_at: nowIso()
        });
    }

    pruneRevokedJtis(store, now = new Date()) {
        if (!Array.isArray(store.revoked_access_jtis)) {
            store.revoked_access_jtis = [];
            return;
        }
        store.revoked_access_jtis = store.revoked_access_jtis.filter((entry) => {
            if (!entry.expires_at) return true;
            const expiresAt = new Date(entry.expires_at).getTime();
            if (!Number.isFinite(expiresAt)) return true;
            return expiresAt > now.getTime();
        });
    }

    appendAudit(store, auditEntry) {
        store.token_audit_log.push({
            id: crypto.randomUUID(),
            token_id: auditEntry.token_id || null,
            event_type: auditEntry.event_type,
            mall_id: auditEntry.mall_id || null,
            local_id: auditEntry.local_id || null,
            ip: auditEntry.ip || null,
            ua: auditEntry.ua || null,
            metadata: auditEntry.metadata || {},
            created_at: nowIso()
        });
    }

    getRequestMeta(req) {
        if (!req) {
            return { ip: null, ua: null };
        }
        return {
            ip: req.ip || req.headers['x-forwarded-for'] || null,
            ua: req.headers['user-agent'] || null
        };
    }

    authenticateAccessToken(rawToken, context = {}) {
        if (!rawToken) {
            throw new HttpError(401, 'Missing bearer token', 'missing_bearer_token');
        }

        let verified;
        try {
            verified = verifyJwtHS256(rawToken, this.settings.jwtSecret, {
                issuer: this.settings.issuer,
                audience: this.settings.audience
            });
        } catch (error) {
            throw new HttpError(401, error.message, 'invalid_access_token');
        }

        const claims = verified.payload;
        const tokenType = normalizeTokenType(claims.token_type);
        if (!tokenType) {
            throw new HttpError(401, 'Invalid token_type claim', 'invalid_access_token');
        }
        if (!claims.mall_id) {
            throw new HttpError(401, 'Missing mall_id claim', 'invalid_access_token');
        }
        if (tokenType === TOKEN_TYPES.EXPORTER && !claims.local_id) {
            throw new HttpError(401, 'Exporter token missing local_id claim', 'invalid_access_token');
        }

        const remoteMeta = this.getRequestMeta(context.req);
        const routeMeta = context.routeMeta || {};

        return this.store.transaction((store) => {
            const now = new Date();
            this.pruneRevokedJtis(store, now);
            const isRevokedJti = store.revoked_access_jtis.some((entry) => entry.jti === claims.jti);
            if (isRevokedJti) {
                this.appendAudit(store, {
                    token_id: claims.token_id || null,
                    event_type: AUDIT_EVENTS.FAILED,
                    mall_id: claims.mall_id,
                    local_id: claims.local_id || null,
                    ip: remoteMeta.ip,
                    ua: remoteMeta.ua,
                    metadata: { stage: 'access', reason: 'jti_revoked', path: routeMeta.path, method: routeMeta.method }
                });
                throw new HttpError(401, 'Token revoked', 'token_revoked');
            }

            const record = store.api_tokens.find((item) => item.jti === claims.jti);
            if (!record) {
                this.appendAudit(store, {
                    token_id: claims.token_id || null,
                    event_type: AUDIT_EVENTS.FAILED,
                    mall_id: claims.mall_id,
                    local_id: claims.local_id || null,
                    ip: remoteMeta.ip,
                    ua: remoteMeta.ua,
                    metadata: { stage: 'access', reason: 'token_not_found', path: routeMeta.path, method: routeMeta.method }
                });
                throw new HttpError(401, 'Token not recognized', 'token_not_found');
            }
            if (record.status !== TOKEN_STATUS.ACTIVE || record.revoked_at) {
                this.appendAudit(store, {
                    token_id: record.id,
                    event_type: AUDIT_EVENTS.FAILED,
                    mall_id: record.mall_id,
                    local_id: record.local_id,
                    ip: remoteMeta.ip,
                    ua: remoteMeta.ua,
                    metadata: { stage: 'access', reason: 'token_inactive_or_revoked', path: routeMeta.path, method: routeMeta.method }
                });
                throw new HttpError(401, 'Token revoked or inactive', 'token_revoked');
            }
            if (new Date(record.access_expires_at).getTime() <= now.getTime()) {
                this.appendAudit(store, {
                    token_id: record.id,
                    event_type: AUDIT_EVENTS.FAILED,
                    mall_id: record.mall_id,
                    local_id: record.local_id,
                    ip: remoteMeta.ip,
                    ua: remoteMeta.ua,
                    metadata: { stage: 'access', reason: 'token_expired', path: routeMeta.path, method: routeMeta.method }
                });
                throw new HttpError(401, 'Token expired', 'token_expired');
            }
            if (record.mall_id !== String(claims.mall_id)) {
                throw new HttpError(401, 'Token claim mismatch (mall_id)', 'invalid_access_token');
            }
            if ((record.local_id || null) !== (claims.local_id || null)) {
                throw new HttpError(401, 'Token claim mismatch (local_id)', 'invalid_access_token');
            }

            record.last_used_at = now.toISOString();
            record.last_used_ip = remoteMeta.ip;
            record.last_used_ua = remoteMeta.ua;
            record.updated_at = now.toISOString();

            this.appendAudit(store, {
                token_id: record.id,
                event_type: AUDIT_EVENTS.USED,
                mall_id: record.mall_id,
                local_id: record.local_id,
                ip: remoteMeta.ip,
                ua: remoteMeta.ua,
                metadata: {
                    stage: 'access',
                    path: routeMeta.path,
                    method: routeMeta.method
                }
            });

            return {
                token_id: record.id,
                jti: record.jti,
                mall_id: record.mall_id,
                local_id: record.local_id,
                token_type: record.token_type,
                scopes: Array.isArray(record.scopes) ? [...record.scopes] : [],
                claims,
                record: sanitizeTokenRecord(record),
                subject: claims.sub
            };
        });
    }

    getAuthorizedMappingsFromConfig() {
        if (!this.configLoader || typeof this.configLoader.load !== 'function') {
            return [];
        }
        const config = this.configLoader.load() || {};
        const candidates = [
            config.ingestion?.authorizedMappings,
            config.authorizedMappings,
            config.mappings?.authorized,
            config.msMall?.authorizedMappings
        ];
        const mappings = candidates.find(Array.isArray) || [];
        return mappings
            .map((entry) => ({
                mall_id: asStringOrNull(entry.mall_id),
                local_id: asStringOrNull(entry.local_id),
                mapping_key: asStringOrNull(entry.mapping_key || entry.mappingKey || entry.key),
                enabled: entry.enabled !== false
            }))
            .filter((entry) => entry.mall_id && entry.local_id && entry.enabled);
    }

    validateIngestionAuthorization({ auth, body, mappingKey }) {
        if (!auth) {
            throw new HttpError(401, 'Unauthorized', 'unauthorized');
        }
        if (auth.token_type !== TOKEN_TYPES.EXPORTER) {
            throw new HttpError(403, 'Exporter token required', 'exporter_token_required');
        }
        if (!auth.local_id) {
            throw new HttpError(403, 'Exporter token missing local_id', 'invalid_exporter_token');
        }

        const payloadMall = asStringOrNull(body?.mall_id);
        const payloadLocal = asStringOrNull(body?.local_id);
        ensureMallId(payloadMall);
        ensureExporterLocalId(payloadLocal);

        if (payloadMall !== auth.mall_id) {
            throw new HttpError(403, 'mall_id in payload does not match token', 'mall_id_mismatch');
        }
        if (payloadLocal !== auth.local_id) {
            throw new HttpError(403, 'local_id in payload does not match token', 'local_id_mismatch');
        }

        const effectiveMappingKey = asStringOrNull(mappingKey || body?.mapping_key || body?.mappingKey);
        const authorizedMappings = this.getAuthorizedMappingsFromConfig();
        if (authorizedMappings.length === 0) {
            throw new HttpError(403, 'No authorized ingestion mappings configured', 'mapping_not_configured');
        }

        const allowed = authorizedMappings.some((entry) => {
            if (entry.mall_id !== payloadMall || entry.local_id !== payloadLocal) return false;
            if (!effectiveMappingKey) return true;
            return entry.mapping_key === effectiveMappingKey;
        });

        if (!allowed) {
            throw new HttpError(403, 'Mapping not authorized for token mall/local', 'mapping_not_authorized');
        }

        return { ok: true, mapping_key: effectiveMappingKey };
    }
}

module.exports = {
    AuthService,
    HttpError,
    TOKEN_TYPES,
    TOKEN_STATUS
};
