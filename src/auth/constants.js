const TOKEN_TYPES = {
    APP: 'app',
    EXPORTER: 'exporter'
};

const TOKEN_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    REVOKED: 'revoked'
};

const AUDIT_EVENTS = {
    ISSUED: 'issued',
    REFRESHED: 'refreshed',
    REVOKED: 'revoked',
    USED: 'used',
    FAILED: 'failed'
};

const DEFAULT_SCOPES = [
    'app:read',
    'app:write',
    'export:write',
    'mapping:read',
    'tokens:manage'
];

module.exports = {
    TOKEN_TYPES,
    TOKEN_STATUS,
    AUDIT_EVENTS,
    DEFAULT_SCOPES
};
