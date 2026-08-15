const fs = require('fs');
const { resolveRuntimePath } = require('./runtimePaths');

function loadBuildInfo() {
    try {
        return JSON.parse(fs.readFileSync(resolveRuntimePath('build-info.json'), 'utf8'));
    } catch (error) {
        return { edition: process.env.EXPORTADOR_EDITION || 'development', version: '16.3.0' };
    }
}

module.exports = loadBuildInfo();
