const PROFILE_DEFINITIONS = Object.freeze({
    sqlserver2008: { label: 'SQL Server 2008', tdsVersion: '7_3_A', requestTimeout: 120000 },
    sqlserver2008r2: { label: 'SQL Server 2008 R2', tdsVersion: '7_3_B', requestTimeout: 120000 },
    modern: { label: 'SQL Server 2012 o superior', tdsVersion: '7_4', requestTimeout: 60000 },
});

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeProfile(value) {
    const profile = String(value || '').toLowerCase().trim();
    if (profile === 'sqlserver2008' || profile === 'sqlserver2008r2') return profile;
    return 'modern';
}

function parseServerTarget(serverValue) {
    const rawTarget = String(serverValue || '').trim();
    let server = rawTarget;
    let instanceName;
    let port;

    if (rawTarget.includes('\\')) {
        const parts = rawTarget.split('\\');
        server = parts.shift().trim();
        instanceName = parts.join('\\').trim() || undefined;
    }

    const portMatch = server.match(/^(.*?)(?:,|:)(\d+)$/);
    if (portMatch) {
        server = portMatch[1].trim();
        port = Number(portMatch[2]);
    }
    return { server, instanceName, port };
}

function normalizeSqlServerConfig(input = {}) {
    const config = JSON.parse(JSON.stringify(input || {}));
    const profileName = normalizeProfile(config.compatibilityProfile || (config.options && config.options.compatibilityProfile));
    const profile = PROFILE_DEFINITIONS[profileName];
    const securityMode = String(config.securityMode || (config.options && config.options.securityMode) || 'modern').toLowerCase();
    const parsedTarget = parseServerTarget(config.server || config.host);
    const explicitPort = positiveInteger(config.port, parsedTarget.port);

    config.server = parsedTarget.server;
    delete config.host;
    delete config.compatibilityProfile;
    delete config.securityMode;
    config.connectionTimeout = positiveInteger(config.connectionTimeout, 30000);
    config.requestTimeout = positiveInteger(config.requestTimeout, profile.requestTimeout);
    config.options = { ...(config.options || {}) };
    delete config.options.compatibilityProfile;
    delete config.options.securityMode;
    config.options.tdsVersion = profile.tdsVersion;
    config.options.cancelTimeout = positiveInteger(config.options.cancelTimeout, 15000);
    config.options.trustServerCertificate = config.options.trustServerCertificate !== false;

    const configuredInstance = String(config.options.instanceName || parsedTarget.instanceName || '').trim();
    if (explicitPort) {
        config.port = explicitPort;
        delete config.options.instanceName;
    } else if (configuredInstance) {
        delete config.port;
        config.options.instanceName = configuredInstance;
    }

    if (securityMode === 'legacy_tls1') {
        config.options.encrypt = true;
        config.options.cryptoCredentialsDetails = {
            ...(config.options.cryptoCredentialsDetails || {}),
            minVersion: 'TLSv1',
            ciphers: 'DEFAULT@SECLEVEL=0',
        };
    } else if (securityMode === 'unencrypted') {
        config.options.encrypt = false;
        delete config.options.cryptoCredentialsDetails;
    } else {
        config.options.encrypt = config.options.encrypt !== false;
        delete config.options.cryptoCredentialsDetails;
    }

    return {
        config,
        metadata: {
            profile: profileName,
            profileLabel: profile.label,
            securityMode,
            tdsVersion: profile.tdsVersion,
        },
    };
}

module.exports = { PROFILE_DEFINITIONS, normalizeProfile, normalizeSqlServerConfig, parseServerTarget };
