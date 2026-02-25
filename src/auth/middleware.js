const { HttpError } = require('./service');

function extractBearerToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || typeof authHeader !== 'string') return null;
    const [scheme, token] = authHeader.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
    return token.trim();
}

function authenticate(authService, options = {}) {
    return (req, res, next) => {
        try {
            const token = extractBearerToken(req);
            if (!token && options.optional) {
                req.auth = null;
                return next();
            }
            req.auth = authService.authenticateAccessToken(token, {
                req,
                routeMeta: { path: req.path, method: req.method }
            });
            next();
        } catch (error) {
            next(error);
        }
    };
}

function requireScopes(requiredScopes) {
    const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
    return (req, res, next) => {
        try {
            if (!req.auth) {
                throw new HttpError(401, 'Unauthorized', 'unauthorized');
            }
            const currentScopes = new Set(req.auth.scopes || []);
            const missing = scopes.filter((scope) => !currentScopes.has(scope));
            if (missing.length > 0) {
                throw new HttpError(403, `Missing required scope(s): ${missing.join(', ')}`, 'missing_scope', { missing });
            }
            next();
        } catch (error) {
            next(error);
        }
    };
}

function requireExporterIngestion(authService) {
    return (req, res, next) => {
        try {
            authService.validateIngestionAuthorization({
                auth: req.auth,
                body: req.body,
                mappingKey: req.headers['x-mapping-key'] || req.body?.mapping_key || req.body?.mappingKey
            });
            next();
        } catch (error) {
            next(error);
        }
    };
}

module.exports = {
    extractBearerToken,
    authenticate,
    requireScopes,
    requireExporterIngestion
};
