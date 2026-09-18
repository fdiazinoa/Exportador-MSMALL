const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveRuntimePath } = require('./runtimePaths');

const MIN_PASSWORD_LENGTH = 12;
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_SECRET_SEED = crypto.randomBytes(48).toString('base64');

function scrypt(password, salt, keyLength, options) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, keyLength, options, (error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });
}

function hardenWindowsAcl(targetPath) {
    if (process.platform !== 'win32') return;
    const directory = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    const access = directory ? '(OI)(CI)F' : 'F';
    const grants = [`*S-1-5-18:${access}`, `*S-1-5-32-544:${access}`];
    const username = String(process.env.USERNAME || '').trim();
    const domain = String(process.env.USERDOMAIN || '').trim();
    if (username) grants.push(`${domain ? `${domain}\\` : ''}${username}:${access}`);
    const args = [targetPath, '/inheritance:r', '/grant:r'].concat(grants);
    spawnSync('icacls.exe', args, { windowsHide: true, stdio: 'ignore' });
}

class SecurityStore {
    constructor(filePath) {
        this.filePath = filePath || resolveRuntimePath('config', 'security.json');
    }

    exists() {
        return fs.existsSync(this.filePath);
    }

    read() {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (!parsed.password || parsed.password.algorithm !== 'scrypt') {
            throw new Error('El archivo de seguridad no tiene un formato compatible.');
        }
        return parsed;
    }

    getSessionSecret() {
        if (!this.exists()) return SESSION_SECRET_SEED;
        const record = this.read();
        return record.sessionSecret || SESSION_SECRET_SEED;
    }

    validatePassword(password) {
        if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
            const error = new Error(`La clave debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
            error.code = 'WEAK_PASSWORD';
            throw error;
        }
        if (password.length > 256) {
            const error = new Error('La clave no puede exceder 256 caracteres.');
            error.code = 'INVALID_PASSWORD';
            throw error;
        }
    }

    async create(password) {
        this.validatePassword(password);
        if (this.exists()) {
            const error = new Error('La clave administrativa ya fue configurada.');
            error.code = 'ALREADY_CONFIGURED';
            throw error;
        }

        const salt = crypto.randomBytes(32);
        const derivedKey = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
        const now = new Date().toISOString();
        const record = {
            version: 1,
            sessionSecret: SESSION_SECRET_SEED,
            password: {
                algorithm: 'scrypt',
                salt: salt.toString('base64'),
                hash: derivedKey.toString('base64'),
                keyLength: KEY_LENGTH,
                N: SCRYPT_OPTIONS.N,
                r: SCRYPT_OPTIONS.r,
                p: SCRYPT_OPTIONS.p,
            },
            createdAt: now,
            updatedAt: now,
        };

        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporaryPath, this.filePath);
        try { fs.chmodSync(this.filePath, 0o600); } catch (_) { /* Windows ACL is applied below. */ }
        hardenWindowsAcl(this.filePath);
        return record;
    }

    async verify(password) {
        if (!this.exists() || typeof password !== 'string') return false;
        const record = this.read();
        const passwordRecord = record.password;
        const expected = Buffer.from(passwordRecord.hash, 'base64');
        const actual = await scrypt(password, Buffer.from(passwordRecord.salt, 'base64'), passwordRecord.keyLength || KEY_LENGTH, {
            N: passwordRecord.N || SCRYPT_OPTIONS.N,
            r: passwordRecord.r || SCRYPT_OPTIONS.r,
            p: passwordRecord.p || SCRYPT_OPTIONS.p,
            maxmem: SCRYPT_OPTIONS.maxmem,
        });
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }
}

module.exports = { SecurityStore, securityStore: new SecurityStore(), MIN_PASSWORD_LENGTH, hardenWindowsAcl };
