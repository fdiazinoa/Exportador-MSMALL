const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeSqlServerConfig, parseServerTarget } = require('../src/sqlServerConfig');
const { buildTediousConfig } = require('../src/tediousClient');
const { JobExecutor } = require('../src/jobExecutor');
const { parseLogLine, resolveLogFile } = require('../src/logReader');

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

test('SQL Server 2008 uses TDS 7.3A and legacy timeout defaults', () => {
    const result = normalizeSqlServerConfig({
        server: 'SQL01\\MSSQLSERVER',
        compatibilityProfile: 'sqlserver2008',
        securityMode: 'legacy_tls1',
        options: {},
    });
    assert.strictEqual(result.config.server, 'SQL01');
    assert.strictEqual(result.config.options.instanceName, 'MSSQLSERVER');
    assert.strictEqual(result.config.options.tdsVersion, '7_3_A');
    assert.strictEqual(result.config.requestTimeout, 120000);
    assert.strictEqual(result.config.options.cancelTimeout, 15000);
    assert.strictEqual(result.config.options.cryptoCredentialsDetails.minVersion, 'TLSv1');
});

test('SQL Server 2008 R2 uses TDS 7.3B', () => {
    const result = normalizeSqlServerConfig({ server: 'SQL02,1444', compatibilityProfile: 'sqlserver2008r2' });
    assert.strictEqual(result.config.server, 'SQL02');
    assert.strictEqual(result.config.port, 1444);
    assert.strictEqual(result.config.options.tdsVersion, '7_3_B');
});

test('Modern profile uses TDS 7.4 and explicit timeouts', () => {
    const result = normalizeSqlServerConfig({
        server: 'SQL03',
        compatibilityProfile: 'modern',
        requestTimeout: 90000,
        options: { cancelTimeout: 20000 },
    });
    assert.strictEqual(result.config.options.tdsVersion, '7_4');
    assert.strictEqual(result.config.requestTimeout, 90000);
    assert.strictEqual(result.config.options.cancelTimeout, 20000);
});

test('Server parser accepts host, port and instance', () => {
    assert.deepStrictEqual(parseServerTarget('host:1433'), { server: 'host', port: 1433, instanceName: undefined });
    assert.deepStrictEqual(parseServerTarget('host\\instance'), { server: 'host', port: undefined, instanceName: 'instance' });
});

test('Normalized settings are mapped to the direct TDS client', () => {
    const normalized = normalizeSqlServerConfig({
        server: 'SQL01', user: 'exportador', password: 'secret', database: 'MSMALL',
        compatibilityProfile: 'sqlserver2008', requestTimeout: 70000,
    });
    const config = buildTediousConfig(normalized);
    assert.strictEqual(config.options.database, 'MSMALL');
    assert.strictEqual(config.options.requestTimeout, 70000);
    assert.strictEqual(config.options.tdsVersion, '7_3_A');
    assert.strictEqual(config.authentication.options.userName, 'exportador');
});

test('Job executor rejects overlapping execution of the same job', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const executor = new JobExecutor({
        runner: async () => gate,
        configProvider: () => ({ runtime: { maxConcurrentJobs: 2 } }),
        logger: { info: () => {} },
    });
    const first = executor.execute('CASA VIRGINIA');
    await assert.rejects(executor.execute('CASA VIRGINIA'), error => error.code === 'JOB_ALREADY_RUNNING');
    release();
    await first;
});

test('SQL factory uses an isolated direct TDS connection', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'dbFactory.js'), 'utf8');
    assert.strictEqual(source.includes("require('mssql')"), false);
    assert.strictEqual(source.includes('tediousClient.openConnection'), true);
});

test('Log reader parses structured and legacy entries', () => {
    const structured = parseLogLine('{"timestamp":"2026-08-12T12:00:00.000Z","level":"error","message":"Timeout"}');
    assert.strictEqual(structured.level, 'error');
    assert.strictEqual(structured.message, 'Timeout');
    const legacy = parseLogLine('legacy event');
    assert.strictEqual(legacy.message, 'legacy event');
});

test('Log reader only resolves supported files', () => {
    assert.strictEqual(resolveLogFile('error').fileName, 'error.log');
    assert.throws(() => resolveLogFile('../config'), error => error.code === 'INVALID_LOG_TYPE');
});

(async () => {
    let failures = 0;
    for (const item of tests) {
        try {
            await item.fn();
            process.stdout.write(`ok - ${item.name}\n`);
        } catch (error) {
            failures += 1;
            process.stderr.write(`not ok - ${item.name}\n${error.stack}\n`);
        }
    }
    if (failures > 0) process.exit(1);
    process.stdout.write(`${tests.length} tests passed\n`);
})();
