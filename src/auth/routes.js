const express = require('express');
const { AuthService, HttpError } = require('./service');
const { authenticate, requireScopes } = require('./middleware');
const { createMemoryRateLimiter } = require('./rateLimit');

function toSafeErrorPayload(error) {
    if (error instanceof HttpError) {
        return {
            status: error.statusCode,
            body: {
                error: error.message,
                code: error.code,
                details: error.details || undefined
            }
        };
    }
    return {
        status: 500,
        body: {
            error: error.message || 'Internal Server Error',
            code: 'internal_error'
        }
    };
}

function sendError(res, error, logger) {
    const payload = toSafeErrorPayload(error);
    if (payload.status >= 500 && logger) {
        logger.error(`Auth route error: ${error.message}`);
    }
    return res.status(payload.status).json(payload.body);
}

function createAuthRouter({ authService, logger } = {}) {
    const service = authService || new AuthService({ logger });
    const router = express.Router();

    const authLimiter = createMemoryRateLimiter({
        windowMs: service.getSettings().rateLimitWindowMs,
        max: service.getSettings().rateLimitMax,
        name: 'auth_sensitive'
    });

    const requireAuth = authenticate(service);
    const requireTokenManager = [requireAuth, requireScopes('tokens:manage')];

    router.get('/auth/me', requireAuth, (req, res) => {
        res.json({
            subject: req.auth.subject,
            mall_id: req.auth.mall_id,
            local_id: req.auth.local_id,
            token_type: req.auth.token_type,
            scopes: req.auth.scopes,
            token_id: req.auth.token_id,
            jti: req.auth.jti
        });
    });

    router.post('/auth/token', authLimiter, (req, res) => {
        try {
            const body = req.body || {};
            const grantType = String(body.grant_type || '').toLowerCase();
            const tokenType = String(body.token_type || '').toLowerCase();

            let result;
            if (grantType === 'password' || tokenType === 'app') {
                result = service.issueAppTokenWithPassword(body, { req });
            } else if (grantType === 'client_credentials' || tokenType === 'exporter') {
                result = service.issueExporterTokenWithClientCredentials(body, { req });
            } else {
                throw new HttpError(
                    400,
                    'Unsupported grant_type/token_type. Use password/app or client_credentials/exporter',
                    'unsupported_grant_type'
                );
            }
            res.status(201).json(result);
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    router.post('/auth/refresh', authLimiter, (req, res) => {
        try {
            const result = service.refreshToken(req.body || {}, { req });
            res.json(result);
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    router.post('/auth/revoke', authLimiter, requireAuth, (req, res) => {
        try {
            const body = req.body || {};
            const hasTarget = Boolean(body.id || body.jti);
            if (hasTarget && !(req.auth.scopes || []).includes('tokens:manage')) {
                throw new HttpError(403, 'tokens:manage scope required to revoke by id/jti', 'missing_scope');
            }

            const result = hasTarget
                ? service.revokeByIdOrJti({ id: body.id, jti: body.jti }, req.auth, { req }, body.reason || 'manual_revoke')
                : service.revokeByCurrentJti(req.auth.jti, req.auth, { req }, body.reason || 'self_revoke');

            res.json({ revoked: true, token: result });
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    router.post('/auth/revoke/local', authLimiter, ...requireTokenManager, (req, res) => {
        try {
            const result = service.revokeByLocal(req.body || {}, req.auth, { req }, (req.body || {}).reason || 'bulk_revoke_local');
            res.json(result);
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    router.post('/auth/revoke/mall', authLimiter, ...requireTokenManager, (req, res) => {
        try {
            const result = service.revokeByMall(req.body || {}, req.auth, { req }, (req.body || {}).reason || 'bulk_revoke_mall');
            res.json(result);
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    router.get('/tokens', ...requireTokenManager, (req, res) => {
        try {
            const tokens = service.listTokens(req.query || {});
            res.json({ items: tokens });
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    router.get('/tokens/audit', ...requireTokenManager, (req, res) => {
        try {
            const items = service.listAuditLogs(req.query || {});
            res.json({ items });
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    router.post('/tokens', ...requireTokenManager, (req, res) => {
        try {
            const result = service.createManualToken(req.body || {}, req.auth, { req });
            res.status(201).json(result);
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    router.patch('/tokens/:id/status', ...requireTokenManager, (req, res) => {
        try {
            const token = service.setTokenStatus(req.params.id, (req.body || {}).status, req.auth, (req.body || {}).reason || null);
            res.json({ token });
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    router.post('/tokens/:id/regenerate', ...requireTokenManager, (req, res) => {
        try {
            const body = req.body || {};
            const result = service.regenerateToken(req.params.id, req.auth, { req }, {
                rotate_client_secret: body.rotate_client_secret === true,
                reason: body.reason || 'regenerated'
            });
            res.json(result);
        } catch (error) {
            sendError(res, error, logger);
        }
    });

    return { router, authService: service };
}

module.exports = {
    createAuthRouter,
    sendError,
    toSafeErrorPayload
};
