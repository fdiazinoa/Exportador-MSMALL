const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const archiver = require('archiver');
const { loadReleaseConfig } = require('./release-config');

const projectRoot = path.resolve(__dirname, '..');
const editionName = process.argv[2];
const releaseConfig = loadReleaseConfig(projectRoot);
const definitions = releaseConfig.editions;

const definition = definitions[editionName];
if (!definition) {
    throw new Error(`Edicion desconocida '${editionName}'. Use standard o legacy-2008.`);
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) {
        throw new Error(`Fallo el comando: ${command} ${args.join(' ')}`);
    }
}

function copyTree(source, destination) {
    fs.cpSync(source, destination, { recursive: true });
}

function prepareLegacyStage() {
    const stage = path.join(projectRoot, '.build', 'legacy-2008');
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    const legacyPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'editions', 'legacy-2008.package.json'), 'utf8'));
    legacyPackage.version = releaseConfig.version;
    fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(legacyPackage, null, 2)}\n`);
    fs.copyFileSync(path.join(projectRoot, 'index.js'), path.join(stage, 'index.js'));
    copyTree(path.join(projectRoot, 'src'), path.join(stage, 'src'));
    copyTree(path.join(projectRoot, 'frontend', 'dist'), path.join(stage, 'frontend', 'dist'));
    run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
    return stage;
}

function writeBuildInfo(packageDir) {
    fs.writeFileSync(path.join(packageDir, 'build-info.json'), JSON.stringify({
        product: 'Exportador MSMall',
        version: releaseConfig.version,
        edition: editionName,
        target: definition.target,
        minimumWindows: definition.minimumWindows,
        builtAt: new Date().toISOString(),
    }, null, 2));
}

function createZip(sourceDir, zipPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(sourceDir, path.basename(sourceDir));
        archive.finalize();
    });
}

async function main() {
    const distRoot = releaseConfig.outputRoot;
    const packageDir = path.join(distRoot, definition.artifact);
    const executable = path.join(packageDir, 'exportador-msmall-node.exe');
    fs.rmSync(packageDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(packageDir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'exports'), { recursive: true });

    const sourceRoot = editionName === 'legacy-2008' ? prepareLegacyStage() : projectRoot;
    const pkgBinary = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'pkg.cmd' : 'pkg');
    run(pkgBinary, [sourceRoot, '--target', definition.target, '--output', executable], projectRoot);

    copyTree(path.join(projectRoot, 'frontend', 'dist'), path.join(packageDir, 'frontend', 'dist'));
    fs.copyFileSync(path.join(projectRoot, 'config', 'default.json'), path.join(packageDir, 'config', 'default.json'));
    fs.copyFileSync(path.join(projectRoot, 'packaging', definition.readme), path.join(packageDir, 'README.txt'));
    for (const file of ['run-exportador-silent.bat', 'install-startup-task.ps1', 'remove-startup-task.ps1', 'start-service-after-exit.ps1']) {
        fs.copyFileSync(path.join(projectRoot, 'packaging', file), path.join(packageDir, file));
    }
    fs.copyFileSync(
        path.join(projectRoot, 'packaging', 'ExportadorMSMallService.exe'),
        path.join(packageDir, 'ExportadorMSMallService.exe'),
    );
    fs.writeFileSync(path.join(packageDir, 'logs', 'README.txt'), 'Los logs de ejecucion se guardan en esta carpeta.\n');
    fs.writeFileSync(path.join(packageDir, 'exports', 'README.txt'), 'Los archivos exportados se guardan en esta carpeta.\n');
    writeBuildInfo(packageDir);

    const zipPath = path.join(distRoot, `${definition.artifact}.zip`);
    fs.rmSync(zipPath, { force: true });
    await createZip(packageDir, zipPath);
    process.stdout.write(`Artefacto creado: ${zipPath}\n`);
}

main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
});
