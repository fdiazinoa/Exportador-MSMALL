const fs = require('fs');
const path = require('path');
const migration001 = require('./migrations/001_initial');

const MIGRATIONS = [migration001];

class AuthStore {
    constructor({ storePath, logger }) {
        this.storePath = storePath;
        this.logger = logger;
        this._initialized = false;
    }

    ensureInitialized() {
        if (this._initialized) return;
        const dir = path.dirname(this.storePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.storePath)) {
            const initialStore = this.applyMigrations(null);
            this.writeStore(initialStore);
            this.logger?.info(`Auth store created at ${this.storePath}`);
        } else {
            const migrated = this.applyMigrations(this.readStore());
            this.writeStore(migrated);
        }
        this._initialized = true;
    }

    applyMigrations(store) {
        let current = store;
        let currentVersion = Number(current?.meta?.schemaVersion || 0);
        for (const migration of MIGRATIONS) {
            if (migration.version > currentVersion) {
                current = migration.up(current);
                currentVersion = migration.version;
            }
        }
        if (!current || typeof current !== 'object') {
            throw new Error('Auth store migration failed');
        }
        current.meta = current.meta || {};
        current.meta.schemaVersion = currentVersion;
        current.meta.updatedAt = new Date().toISOString();
        current.meta.migratedAt = new Date().toISOString();
        return current;
    }

    readStore() {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        return JSON.parse(raw);
    }

    writeStore(store) {
        const tmpPath = `${this.storePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2));
        fs.renameSync(tmpPath, this.storePath);
    }

    transaction(mutator) {
        this.ensureInitialized();
        const store = this.readStore();
        const tx = { save: true };
        const result = mutator(store, tx);
        if (tx.save !== false) {
            store.meta = store.meta || {};
            store.meta.updatedAt = new Date().toISOString();
            this.writeStore(store);
        }
        return result;
    }

    runMigrations() {
        this.ensureInitialized();
        return this.read();
    }

    read() {
        this.ensureInitialized();
        return this.readStore();
    }
}

module.exports = AuthStore;
