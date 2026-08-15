process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { normalizeSqlServerConfig, parseServerTarget } = require('../src/sqlServerConfig');
const { buildTediousConfig } = require('../src/tediousClient');
const { JobExecutor } = require('../src/jobExecutor');
const { parseLogLine, resolveLogFile } = require('../src/logReader');
const { resolveDestinationTarget } = require('../src/destinationResolver');
const configLoader = require('../src/configLoader');
const webServiceAuth = require('../src/webServiceAuth');
const windowsServiceManager = require('../src/windowsServiceManager');
const { parseVersion, loadReleaseConfig } = require('../scripts/release-config');
const { SecurityStore } = require('../src/securityStore');
const express = require('express');
const webSecurity = require('../src/webSecurity');
const { securityStore } = require('../src/securityStore');

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

test('Destination resolver supports explicit and legacy webservice jobs', () => {
    const config = { ftpServers: { ftp_main: {} }, webServices: { msmall_main: {} } };
    assert.deepStrictEqual(resolveDestinationTarget(config, 'webservice', 'msmall_main'), { type: 'webservice', key: 'msmall_main' });
    assert.deepStrictEqual(resolveDestinationTarget(config, '', 'msmall_main'), { type: 'webservice', key: 'msmall_main' });
    assert.deepStrictEqual(resolveDestinationTarget(config, 'local', 'C:\\Exports'), { type: 'local', path: 'C:\\Exports' });
});

test('Windows service manager parses English and Spanish service states', () => {
    assert.strictEqual(windowsServiceManager.parseScState('STATE              : 4  RUNNING'), 'running');
    assert.strictEqual(windowsServiceManager.parseScState('ESTADO             : 1  STOPPED'), 'stopped');
    assert.strictEqual(windowsServiceManager.MECHANISM, 'windows_service_winsw');
});

test('Windows service manager identifies the registered wrapper path', () => {
    const english = 'BINARY_PATH_NAME   : "C:\\Exportador V16.4\\ExportadorMSMallService.exe"';
    const spanish = 'NOMBRE_RUTA_BINARIO: C:\\ExportadorV16.5\\ExportadorMSMallService.exe';
    assert.strictEqual(windowsServiceManager.parseScBinaryPath(english), 'C:\\Exportador V16.4\\ExportadorMSMallService.exe');
    assert.strictEqual(windowsServiceManager.parseScBinaryPath(spanish), 'C:\\ExportadorV16.5\\ExportadorMSMallService.exe');
    assert.strictEqual(windowsServiceManager.sameWindowsPath('C:\\PACK\\Service.exe', 'c:\\pack\\service.exe'), true);
    assert.strictEqual(windowsServiceManager.sameWindowsPath('C:\\V16.4\\Service.exe', 'C:\\V16.5\\Service.exe'), false);
});

test('Windows service mode is reported as unavailable outside Windows', async () => {
    if (process.platform === 'win32') return;
    const status = await windowsServiceManager.getStatus();
    assert.strictEqual(status.supported, false);
    assert.strictEqual(status.installed, false);
    assert.strictEqual(status.serviceName, 'ExportadorMSMall');
});

test('Windows service assets are present and configured for automatic startup', () => {
    const wrapperPath = path.join(__dirname, '..', 'packaging', 'ExportadorMSMallService.exe');
    const installScript = fs.readFileSync(path.join(__dirname, '..', 'packaging', 'install-startup-task.ps1'), 'utf8');
    const handoffScript = fs.readFileSync(path.join(__dirname, '..', 'packaging', 'start-service-after-exit.ps1'), 'utf8');
    const buildScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-edition.js'), 'utf8');
    const resetAccessScript = fs.readFileSync(path.join(__dirname, '..', 'packaging', 'reset-web-access.ps1'), 'utf8');
    assert.strictEqual(fs.existsSync(wrapperPath), true);
    assert.strictEqual(
        crypto.createHash('sha256').update(fs.readFileSync(wrapperPath)).digest('hex'),
        '5859b114d96800a2b98ef9d19eaa573a786a422dad324547ef25be181389df01',
    );
    assert.strictEqual(installScript.includes('<startmode>Automatic</startmode>'), true);
    assert.strictEqual(installScript.includes('EXPORTADOR_RUN_MODE'), true);
    assert.strictEqual(installScript.includes('HandoffProcessId'), true);
    assert.strictEqual(installScript.includes('Migrando servicio desde'), true);
    assert.strictEqual(installScript.includes('sc.exe delete $ServiceName'), true);
    assert.strictEqual(handoffScript.includes('Get-Process -Id $ParentProcessId'), true);
    assert.strictEqual(handoffScript.includes("$service.Status -eq 'Running'"), true);
    assert.strictEqual(handoffScript.includes('Restart-Service -Name $ServiceName'), true);
    assert.strictEqual(handoffScript.includes('Start-Service -Name $ServiceName'), true);
    assert.strictEqual(handoffScript.includes('http://127.0.0.1:3000/api/health'), true);
    assert.strictEqual(handoffScript.includes('Start-Process -FilePath $appExe'), true);
    assert.strictEqual(buildScript.includes("'ExportadorMSMallService.exe'"), true);
    assert.strictEqual(buildScript.includes("'start-service-after-exit.ps1'"), true);
    assert.strictEqual(buildScript.includes("'reset-web-access.ps1'"), true);
    assert.strictEqual(resetAccessScript.includes('#Requires -RunAsAdministrator'), true);
    assert.strictEqual(resetAccessScript.includes('config\\security.json'), true);
});

test('Administrative password is stored as a salted scrypt hash', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exportador-security-'));
    const securityPath = path.join(tempDir, 'security.json');
    const store = new SecurityStore(securityPath);
    const password = 'Clave segura 2026!';
    try {
        await assert.rejects(store.create('corta'), error => error.code === 'WEAK_PASSWORD');
        await store.create(password);
        const raw = fs.readFileSync(securityPath, 'utf8');
        const record = JSON.parse(raw);
        assert.strictEqual(raw.includes(password), false);
        assert.strictEqual(record.password.algorithm, 'scrypt');
        assert.strictEqual(Buffer.from(record.password.salt, 'base64').length, 32);
        assert.strictEqual(await store.verify(password), true);
        assert.strictEqual(await store.verify('Clave incorrecta 2026!'), false);
        await assert.rejects(store.create(password), error => error.code === 'ALREADY_CONFIGURED');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Dashboard API requires authentication and CSRF protection', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exportador-auth-api-'));
    const originalSecurityPath = securityStore.filePath;
    securityStore.filePath = path.join(tempDir, 'security.json');
    const app = express();
    app.use(express.json());
    app.use(webSecurity.createSessionMiddleware({ sessionsPath: path.join(tempDir, 'sessions'), secret: 'test-session-secret-with-sufficient-length' }));
    app.use('/api/auth', webSecurity.authRouter);
    app.use('/api', webSecurity.requireAuthenticated, webSecurity.requireCsrf);
    app.get('/api/health', (req, res) => res.json({ ok: true }));
    app.get('/api/protected', (req, res) => res.json({ protected: true }));
    app.post('/api/protected', (req, res) => res.json({ changed: true }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const request = (method, route, body, headers) => new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : '';
        const call = http.request({
            host: '127.0.0.1', port: server.address().port, path: route, method,
            headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, headers || {}),
        }, response => {
            let data = '';
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: data ? JSON.parse(data) : {} }));
        });
        call.on('error', reject);
        if (payload) call.write(payload);
        call.end();
    });

    try {
        assert.strictEqual((await request('GET', '/api/health')).status, 200);
        assert.strictEqual((await request('GET', '/api/protected')).status, 428);
        const setup = await request('POST', '/api/auth/setup', { password: 'Clave segura 2026!' });
        assert.strictEqual(setup.status, 201);
        const cookie = setup.headers['set-cookie'][0].split(';')[0];
        assert.strictEqual((await request('GET', '/api/protected', null, { Cookie: cookie })).status, 200);
        assert.strictEqual((await request('POST', '/api/protected', {}, { Cookie: cookie })).status, 403);
        assert.strictEqual((await request('POST', '/api/protected', {}, { Cookie: cookie, 'X-Exportador-CSRF': setup.body.csrfToken })).status, 200);
        const stepUpRequest = { session: { reauthenticatedAt: 0 } };
        let stepUpStatus;
        webSecurity.requireRecentReauthentication(stepUpRequest, { status: code => ({ json: () => { stepUpStatus = code; } }) }, () => { stepUpStatus = 200; });
        assert.strictEqual(stepUpStatus, 403);
    } finally {
        securityStore.filePath = originalSecurityPath;
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Dashboard startup reports port conflicts in the application log', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.strictEqual(source.includes("server.on('error'"), true);
    assert.strictEqual(source.includes('Dashboard API could not listen on port'), true);
});

test('Release protocol derives both editions and canonical path from package version', () => {
    const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const parsed = parseVersion(packageInfo.version);
    const release = loadReleaseConfig(path.join(__dirname, '..'));
    assert.strictEqual(release.version, parsed.full);
    const legacyTemplate = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'editions', 'legacy-2008.package.json'), 'utf8'));
    assert.strictEqual(legacyTemplate.version, '0.0.0');
    assert.strictEqual(path.basename(release.outputRoot), `v${parsed.label}`);
    assert.strictEqual(path.basename(path.dirname(release.outputRoot)), 'release-packs');
    assert.strictEqual(release.editions.standard.artifact, `ExportadorMSMall-V${parsed.label}-Standard-win-x64`);
    assert.strictEqual(release.editions['legacy-2008'].artifact, `ExportadorMSMall-V${parsed.label}-Legacy-2008-win-x64`);
});

test('MsMall Service Account test persists identity from exporter token', async () => {
    const identity = { mall_id: '11111111-1111-4111-8111-111111111111', local_id: '22222222-2222-4222-8222-222222222222', exp: Math.floor(Date.now() / 1000) + 3600 };
    const jwtPayload = Buffer.from(JSON.stringify(identity)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ access_token: `header.${jwtPayload}.signature`, refresh_token: 'refresh', expires_in: 3600 }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const originalPath = configLoader.configPath;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exportador-v16-webservice-'));
    const tempConfig = path.join(tempDir, 'config.json');
    configLoader.configPath = tempConfig;
    fs.writeFileSync(tempConfig, JSON.stringify({ webServices: { msmall_test: { baseUrl: `http://127.0.0.1:${server.address().port}`, clientId: 'msa_test', clientSecret: 'secret', timeoutMs: 2000 } } }));
    try {
        const result = await webServiceAuth.testConnection('msmall_test');
        assert.strictEqual(result.resolvedIdentity.mallId, identity.mall_id);
        assert.strictEqual(result.resolvedIdentity.localId, identity.local_id);
        const saved = JSON.parse(fs.readFileSync(tempConfig, 'utf8'));
        assert.strictEqual(saved.webServices.msmall_test.mallId, identity.mall_id);
        assert.strictEqual(saved.webServices.msmall_test.localId, identity.local_id);
    } finally {
        configLoader.configPath = originalPath;
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
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
