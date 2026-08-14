const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);

const action = args.includes('--install')
    ? 'install-startup-task.ps1'
    : args.includes('--uninstall')
        ? 'remove-startup-task.ps1'
        : null;

if (action) {
    const scriptPath = path.join(__dirname, 'packaging', action);
    const result = spawnSync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
    ], { stdio: 'inherit' });
    process.exit(result.status || 0);
} else {
    console.log('Usage: node service.js --install | --uninstall');
}
