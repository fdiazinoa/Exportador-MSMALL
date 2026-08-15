const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const createFileStore = require('session-file-store');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const { resolveRuntimePath } = require('./runtimePaths');
const { securityStore, MIN_PASSWORD_LENGTH, hardenWindowsAcl } = require('./securityStore');

const FileStore = createFileStore(session);
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

function isLoopback(req) {
    const address = String(req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '');
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function audit(event, req, outcome) {
    const address = String(req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown');
    logger.info(`Security audit event=${event} outcome=${outcome} remote=${address}`);
}

function createSessionMiddleware(options) {
    const settings = options || {};
    const sessionsPath = settings.sessionsPath || resolveRuntimePath('config', 'sessions');
    require('fs').mkdirSync(sessionsPath, { recursive: true });
    hardenWindowsAcl(sessionsPath);
    return session({
        name: 'exportador.sid',
        secret: settings.secret || securityStore.getSessionSecret(),
        store: new FileStore({ path: sessionsPath, ttl: SESSION_MAX_AGE_MS / 1000, retries: 1 }),
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            sameSite: 'strict',
            secure: false,
            maxAge: SESSION_MAX_AGE_MS,
        },
    });
}

function issueSession(req) {
    req.session.authenticated = true;
    req.session.csrfToken = crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    req.session.authenticatedAt = Date.now();
    req.session.reauthenticatedAt = 0;
    return req.session.csrfToken;
}

function destroySession(req) {
    return new Promise(resolve => req.session.destroy(() => resolve()));
}

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espere 15 minutos antes de intentar nuevamente.' },
});

const authRouter = express.Router();

authRouter.get('/status', (req, res) => {
    const configured = securityStore.exists();
    const authenticated = configured && Boolean(req.session && req.session.authenticated);
    res.json({
        configured,
        authenticated,
        setupAllowed: !configured && isLoopback(req),
        minimumPasswordLength: MIN_PASSWORD_LENGTH,
        csrfToken: authenticated ? req.session.csrfToken : undefined,
    });
});

authRouter.post('/setup', limiter, async (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: 'La clave inicial solo puede configurarse desde el servidor local.' });
    try {
        await securityStore.create(req.body && req.body.password);
        const csrfToken = issueSession(req);
        audit('setup', req, 'success');
        return res.status(201).json({ authenticated: true, csrfToken });
    } catch (error) {
        audit('setup', req, 'failure');
        const status = error.code === 'ALREADY_CONFIGURED' ? 409 : error.code === 'WEAK_PASSWORD' || error.code === 'INVALID_PASSWORD' ? 400 : 500;
        return res.status(status).json({ error: error.message });
    }
});

authRouter.post('/login', limiter, async (req, res) => {
    if (!securityStore.exists()) return res.status(409).json({ error: 'Primero debe crear la clave administrativa desde el servidor local.' });
    try {
        const valid = await securityStore.verify(req.body && req.body.password);
        if (!valid) {
            audit('login', req, 'failure');
            return res.status(401).json({ error: 'Clave incorrecta.' });
        }
        const csrfToken = issueSession(req);
        audit('login', req, 'success');
        return res.json({ authenticated: true, csrfToken });
    } catch (error) {
        logger.error(`Authentication error: ${error.message}`);
        return res.status(500).json({ error: 'No se pudo validar la clave administrativa.' });
    }
});

function requireAuthenticated(req, res, next) {
    if (req.path === '/health') return next();
    if (!securityStore.exists()) return res.status(428).json({ error: 'Debe configurar la clave administrativa.' });
    if (!req.session || !req.session.authenticated) return res.status(401).json({ error: 'Debe iniciar sesión.' });
    return next();
}

function requireCsrf(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const token = String(req.get('X-Exportador-CSRF') || '');
    if (!req.session || !req.session.csrfToken || token !== req.session.csrfToken) {
        return res.status(403).json({ error: 'La sesión de seguridad no es válida. Vuelva a iniciar sesión.' });
    }
    const origin = req.get('Origin');
    if (origin) {
        try {
            if (new URL(origin).host !== req.get('Host')) return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
        } catch (_) {
            return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
        }
    }
    return next();
}

authRouter.post('/reauthenticate', requireAuthenticated, requireCsrf, limiter, async (req, res) => {
    try {
        if (!await securityStore.verify(req.body && req.body.password)) {
            audit('reauthenticate', req, 'failure');
            return res.status(401).json({ error: 'Clave incorrecta.' });
        }
        req.session.reauthenticatedAt = Date.now();
        audit('reauthenticate', req, 'success');
        return res.json({ reauthenticated: true, validForSeconds: REAUTH_MAX_AGE_MS / 1000 });
    } catch (error) {
        logger.error(`Reauthentication error: ${error.message}`);
        return res.status(500).json({ error: 'No se pudo volver a validar la clave.' });
    }
});

authRouter.post('/logout', requireAuthenticated, requireCsrf, async (req, res) => {
    audit('logout', req, 'success');
    await destroySession(req);
    res.clearCookie('exportador.sid');
    return res.json({ authenticated: false });
});

function requireRecentReauthentication(req, res, next) {
    const timestamp = Number(req.session && req.session.reauthenticatedAt);
    if (!timestamp || Date.now() - timestamp > REAUTH_MAX_AGE_MS) {
        return res.status(403).json({ error: 'Confirme nuevamente la clave para administrar el servicio.' });
    }
    return next();
}

module.exports = {
    authRouter,
    createSessionMiddleware,
    requireAuthenticated,
    requireCsrf,
    requireRecentReauthentication,
    isLoopback,
    audit,
};
