module.exports = {
    version: 1,
    name: 'initial-auth-store',
    up(existingStore) {
        const now = new Date().toISOString();
        const base = existingStore && typeof existingStore === 'object' ? existingStore : {};
        return {
            meta: {
                schemaVersion: 1,
                createdAt: base.meta?.createdAt || now,
                migratedAt: now,
                updatedAt: now
            },
            service_accounts: Array.isArray(base.service_accounts) ? base.service_accounts : [],
            api_tokens: Array.isArray(base.api_tokens) ? base.api_tokens : [],
            token_audit_log: Array.isArray(base.token_audit_log) ? base.token_audit_log : [],
            revoked_access_jtis: Array.isArray(base.revoked_access_jtis) ? base.revoked_access_jtis : []
        };
    }
};
