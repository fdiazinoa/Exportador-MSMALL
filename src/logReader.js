const fs = require('fs');
const path = require('path');
const { resolveRuntimePath } = require('./runtimePaths');

const LOG_FILES = Object.freeze({
    combined: 'combined.log',
    error: 'error.log',
});

function resolveLogFile(type) {
    const fileName = LOG_FILES[type];
    if (!fileName) {
        const error = new Error('Tipo de log no válido.');
        error.code = 'INVALID_LOG_TYPE';
        throw error;
    }
    return { type, fileName, filePath: resolveRuntimePath('logs', fileName) };
}

function parseLogLine(line) {
    try {
        const parsed = JSON.parse(line);
        return {
            raw: line,
            timestamp: parsed.timestamp || null,
            level: parsed.level || 'info',
            message: parsed.message || line,
            data: parsed,
        };
    } catch {
        return { raw: line, timestamp: null, level: 'info', message: line, data: null };
    }
}

function readLastLines(filePath, maxLines) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

function readLog(type, options = {}) {
    const target = resolveLogFile(type);
    const requestedLines = Number.parseInt(options.lines, 10);
    const lines = Math.min(Math.max(Number.isFinite(requestedLines) ? requestedLines : 200, 1), 2000);
    const level = String(options.level || '').trim().toLowerCase();
    const search = String(options.search || '').trim().toLowerCase();
    let entries = readLastLines(target.filePath, lines).map(parseLogLine).reverse();

    if (level && level !== 'all') entries = entries.filter(entry => entry.level.toLowerCase() === level);
    if (search) entries = entries.filter(entry => entry.raw.toLowerCase().includes(search));

    return { ...target, exists: fs.existsSync(target.filePath), lines, entries };
}

module.exports = { LOG_FILES, parseLogLine, readLog, resolveLogFile };
