const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { resolveRuntimePath } = require('./runtimePaths');
const isTest = process.env.NODE_ENV === 'test';

// Ensure log directory exists
const logDir = resolveRuntimePath('logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: isTest ? [
        new winston.transports.Console({ silent: true }),
    ] : [
        new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
        new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
    ],
});

// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
if (process.env.NODE_ENV !== 'production' && !isTest) {
    logger.add(new winston.transports.Console({
        format: winston.format.simple(),
    }));
}

module.exports = logger;
