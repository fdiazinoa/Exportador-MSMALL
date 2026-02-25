const configLoader = require('../src/configLoader');
const logger = require('../src/logger');
const { AuthService } = require('../src/auth');

try {
    const service = new AuthService({ logger, configLoader });
    const store = service.runMigrations();
    console.log(`Auth store ready at ${service.getSettings().storePath}`);
    console.log(`Schema version: ${store.meta?.schemaVersion || 'unknown'}`);
} catch (error) {
    console.error(`auth:migrate failed: ${error.message}`);
    process.exit(1);
}
