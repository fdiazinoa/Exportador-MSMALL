const { AuthService, HttpError } = require('./service');
const { createAuthRouter } = require('./routes');
const { authenticate, requireScopes, requireExporterIngestion } = require('./middleware');

function createAuthModule(options = {}) {
    const { logger } = options;
    const authService = options.authService || new AuthService(options);
    const { router } = createAuthRouter({ authService, logger });
    return {
        router,
        authService,
        middleware: {
            authenticate: (opts) => authenticate(authService, opts),
            requireScopes,
            requireExporterIngestion: () => requireExporterIngestion(authService)
        }
    };
}

module.exports = {
    createAuthModule,
    AuthService,
    HttpError
};
