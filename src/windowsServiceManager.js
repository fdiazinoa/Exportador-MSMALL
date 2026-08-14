const fs = require('fs');
const { execFile } = require('child_process');
const { resolveRuntimePath } = require('./runtimePaths');

const SERVICE_NAME = 'ExportadorMSMall';
const WRAPPER_EXE = 'ExportadorMSMallService.exe';
const MECHANISM = 'windows_service_winsw';

function isWindows() {
    return process.platform === 'win32';
}

function getServicePaths() {
    return {
        installScript: resolveRuntimePath('install-startup-task.ps1'),
        removeScript: resolveRuntimePath('remove-startup-task.ps1'),
        serviceWrapper: resolveRuntimePath(WRAPPER_EXE),
        serviceXml: resolveRuntimePath('ExportadorMSMallService.xml'),
        binaryPath: resolveRuntimePath('exportador-msmall-node.exe'),
        logsDir: resolveRuntimePath('logs'),
    };
}

function execFileAsync(command, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        execFile(command, args, {
            windowsHide: true,
            timeout: timeoutMs || 30000,
            maxBuffer: 1024 * 1024,
        }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function buildStatus(patch) {
    return Object.assign({
        supported: isWindows(),
        installed: false,
        state: 'not_installed',
        mechanism: MECHANISM,
        serviceName: SERVICE_NAME,
        platform: process.platform,
    }, patch || {});
}

function hasRequiredFiles(paths) {
    const target = paths || getServicePaths();
    return fs.existsSync(target.installScript)
        && fs.existsSync(target.removeScript)
        && fs.existsSync(target.serviceWrapper)
        && fs.existsSync(target.binaryPath);
}

function parseScState(stdout) {
    const text = String(stdout || '');
    const match = text.match(/(?:STATE|ESTADO)\s*:\s*\d+\s+([A-Z_]+)/i);
    return String(match && match[1] ? match[1] : 'unknown').toLowerCase();
}

function isServiceMissing(error) {
    const output = `${String(error.stdout || '')}\n${String(error.stderr || '')}\n${String(error.message || '')}`.toLowerCase();
    return output.includes('1060')
        || output.includes('does not exist')
        || output.includes('no existe')
        || output.includes('not exist')
        || output.includes('service has not been installed');
}

async function queryServiceState() {
    try {
        const result = await execFileAsync('sc.exe', ['query', SERVICE_NAME]);
        return { installed: true, state: parseScState(result.stdout) };
    } catch (error) {
        if (isServiceMissing(error)) return { installed: false, state: 'not_installed' };
        throw error;
    }
}

async function getStatus() {
    const paths = getServicePaths();
    if (!isWindows()) {
        return buildStatus({
            supported: false,
            message: 'Disponible únicamente en Windows.',
        });
    }
    if (!hasRequiredFiles(paths)) {
        return buildStatus({
            supported: false,
            message: `Faltan ${WRAPPER_EXE}, el ejecutable o los scripts de instalación en la carpeta del Exportador.`,
        });
    }

    try {
        const service = await queryServiceState();
        return buildStatus({
            supported: true,
            installed: service.installed,
            state: service.state,
            message: service.installed
                ? `Servicio Windows ${SERVICE_NAME} instalado (${service.state}).`
                : 'Servicio Windows no instalado.',
        });
    } catch (error) {
        return buildStatus({
            supported: true,
            state: 'unknown',
            message: `No se pudo consultar el servicio Windows: ${error.message}`,
        });
    }
}

async function runPowerShellScript(scriptPath) {
    await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-ServiceName',
        SERVICE_NAME,
    ], 180000);
}

async function runWrapperCommand(command) {
    const paths = getServicePaths();
    if (!fs.existsSync(paths.serviceWrapper)) {
        throw new Error(`No se encontró ${WRAPPER_EXE} en la carpeta del Exportador.`);
    }
    await execFileAsync(paths.serviceWrapper, [command], 60000);
}

async function install() {
    const paths = getServicePaths();
    if (!isWindows()) throw new Error('El modo servicio solo se puede instalar en Windows.');
    if (!hasRequiredFiles(paths)) {
        throw new Error(`Faltan archivos para instalar el servicio. Deben existir ${WRAPPER_EXE}, exportador-msmall-node.exe y los scripts PowerShell.`);
    }

    await runPowerShellScript(paths.installScript);
    const status = await getStatus();
    if (!status.installed) throw new Error(status.message || 'El servicio Windows no quedó instalado.');
    return { message: 'Servicio Windows instalado e iniciado.', status };
}

async function uninstall() {
    const paths = getServicePaths();
    if (!isWindows()) throw new Error('El modo servicio solo se puede administrar en Windows.');
    if (!fs.existsSync(paths.removeScript)) throw new Error('No se encontró el script para quitar el servicio.');

    await runPowerShellScript(paths.removeScript);
    const status = await getStatus();
    if (status.installed) throw new Error('El servicio Windows continúa instalado.');
    return { message: 'Servicio Windows eliminado.', status };
}

async function control(action) {
    if (!isWindows()) throw new Error('El modo servicio solo se puede administrar en Windows.');
    if (!['start', 'stop', 'restart'].includes(action)) {
        throw new Error(`Acción de servicio no soportada: ${action}`);
    }

    await runWrapperCommand(action);
    return {
        message: `Acción '${action}' ejecutada sobre el servicio Windows.`,
        status: await getStatus(),
    };
}

module.exports = {
    SERVICE_NAME,
    MECHANISM,
    getServicePaths,
    hasRequiredFiles,
    parseScState,
    getStatus,
    install,
    uninstall,
    control,
};
