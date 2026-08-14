const fs = require('fs');
const path = require('path');

function parseVersion(version) {
    const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) throw new Error(`Version invalida '${version}'. Use MAJOR.MINOR.PATCH.`);
    return {
        full: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
        label: `${Number(match[1])}.${Number(match[2])}`,
    };
}

function loadReleaseConfig(projectRoot) {
    const packageInfo = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const version = parseVersion(packageInfo.version);

    const outputRoot = path.join(projectRoot, 'release-packs', `v${version.label}`);
    return {
        product: 'Exportador MSMall',
        version: version.full,
        versionLabel: version.label,
        outputRoot,
        editions: {
            standard: {
                artifact: `ExportadorMSMall-V${version.label}-Standard-win-x64`,
                target: 'node18-win-x64',
                readme: 'README_STANDARD.txt',
                minimumWindows: 'Windows Server 2016 x64',
            },
            'legacy-2008': {
                artifact: `ExportadorMSMall-V${version.label}-Legacy-2008-win-x64`,
                target: 'node10-win-x64',
                readme: 'README_LEGACY_2008.txt',
                minimumWindows: 'Windows Server 2008 R2 x64 (Server 2008 requiere validacion de laboratorio)',
            },
        },
    };
}

module.exports = { parseVersion, loadReleaseConfig };
