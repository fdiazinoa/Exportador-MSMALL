const path = require('path');

function getRuntimeRoot() {
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return path.resolve(__dirname, '..');
}

function resolveRuntimePath(...segments) {
    return path.join(getRuntimeRoot(), ...segments);
}

module.exports = { getRuntimeRoot, resolveRuntimePath };
