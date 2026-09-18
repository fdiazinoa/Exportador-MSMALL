const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { loadReleaseConfig } = require('./release-config');

const projectRoot = path.resolve(__dirname, '..');
const allowNonDevelop = process.argv.includes('--allow-non-develop');

function run(command, args, options) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: options && options.capture ? 'pipe' : 'inherit',
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
        const detail = options && options.capture ? String(result.stderr || result.stdout || '').trim() : '';
        throw new Error(`Fallo: ${command} ${args.join(' ')}${detail ? `\n${detail}` : ''}`);
    }
    return String(result.stdout || '').trim();
}

function gitOutput(args) {
    return run('git', args, { capture: true });
}

function assertCleanWorkingTree() {
    const status = gitOutput(['status', '--porcelain']);
    if (status) throw new Error(`El repositorio tiene cambios pendientes. Confirme o descarte los cambios antes del release:\n${status}`);
}

function assertReleaseSource() {
    const branch = gitOutput(['branch', '--show-current']);
    if (branch !== 'develop' && !allowNonDevelop) {
        throw new Error(`Los Packs oficiales solo se generan desde develop. Rama actual: ${branch || '(detached)'}.`);
    }
    if (branch === 'develop') {
        const head = gitOutput(['rev-parse', 'HEAD']);
        const remoteDevelop = gitOutput(['rev-parse', 'origin/develop']);
        if (head !== remoteDevelop) {
            throw new Error('develop local no coincide con origin/develop. Ejecute git pull --ff-only antes del release.');
        }
    }
    return branch;
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyEdition(releaseConfig, editionName) {
    const edition = releaseConfig.editions[editionName];
    const packageDir = path.join(releaseConfig.outputRoot, edition.artifact);
    const zipPath = `${packageDir}.zip`;
    const requiredFiles = [
        'exportador-msmall-node.exe',
        'ExportadorMSMallService.exe',
        'install-startup-task.ps1',
        'remove-startup-task.ps1',
        'reset-web-access.ps1',
        'frontend/dist/index.html',
        'config/default.json',
        'build-info.json',
    ];

    for (const relativePath of requiredFiles) {
        if (!fs.existsSync(path.join(packageDir, relativePath))) {
            throw new Error(`Falta ${relativePath} en ${edition.artifact}.`);
        }
    }
    if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size === 0) {
        throw new Error(`ZIP ausente o vacio: ${zipPath}`);
    }
    const zipHeader = Buffer.alloc(2);
    const zipHandle = fs.openSync(zipPath, 'r');
    fs.readSync(zipHandle, zipHeader, 0, 2, 0);
    fs.closeSync(zipHandle);
    if (zipHeader.toString('ascii') !== 'PK') throw new Error(`Archivo ZIP invalido: ${zipPath}`);

    const buildInfo = JSON.parse(fs.readFileSync(path.join(packageDir, 'build-info.json'), 'utf8'));
    if (buildInfo.version !== releaseConfig.version || buildInfo.edition !== editionName) {
        throw new Error(`build-info.json inconsistente en ${edition.artifact}.`);
    }
    return {
        edition: editionName,
        file: path.basename(zipPath),
        bytes: fs.statSync(zipPath).size,
        sha256: sha256(zipPath),
    };
}

function writeManifest(releaseConfig, branch) {
    const artifacts = Object.keys(releaseConfig.editions).map(name => verifyEdition(releaseConfig, name));
    const manifest = {
        protocolVersion: 1,
        product: releaseConfig.product,
        version: releaseConfig.version,
        sourceBranch: branch,
        commit: gitOutput(['rev-parse', 'HEAD']),
        generatedAt: new Date().toISOString(),
        artifacts,
    };
    const manifestPath = path.join(releaseConfig.outputRoot, 'release-manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifestPath;
}

function removeStagingDirectories(releaseConfig) {
    for (const edition of Object.values(releaseConfig.editions)) {
        fs.rmSync(path.join(releaseConfig.outputRoot, edition.artifact), { recursive: true, force: true });
    }
}

function main() {
    const releaseConfig = loadReleaseConfig(projectRoot);
    assertCleanWorkingTree();
    const branch = assertReleaseSource();
    if (allowNonDevelop) process.stdout.write('ADVERTENCIA: validacion de protocolo fuera de develop; no distribuir estos Packs.\n');

    run('npm', ['test']);
    run('npm', ['--prefix', 'frontend', 'run', 'lint']);
    run('npm', ['run', 'build:frontend']);
    assertCleanWorkingTree();

    fs.rmSync(releaseConfig.outputRoot, { recursive: true, force: true });

    for (const editionName of Object.keys(releaseConfig.editions)) {
        run(process.execPath, [path.join('scripts', 'build-edition.js'), editionName]);
    }

    const manifestPath = writeManifest(releaseConfig, branch);
    removeStagingDirectories(releaseConfig);
    process.stdout.write(`Release verificado en: ${releaseConfig.outputRoot}\n`);
    process.stdout.write(`Manifiesto: ${manifestPath}\n`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exit(1);
    }
}

module.exports = { assertCleanWorkingTree, assertReleaseSource, verifyEdition, writeManifest, removeStagingDirectories };
