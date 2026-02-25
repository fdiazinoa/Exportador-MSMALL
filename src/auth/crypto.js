const crypto = require('crypto');

function base64UrlEncode(input) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
    return buffer.toString('base64url');
}

function base64UrlDecode(input) {
    return Buffer.from(String(input), 'base64url');
}

function encodeJson(value) {
    return base64UrlEncode(Buffer.from(JSON.stringify(value)));
}

function safeCompareString(a, b) {
    const aBuf = Buffer.from(String(a));
    const bBuf = Buffer.from(String(b));
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}

function hashSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(secret), salt, 64).toString('hex');
    return `${salt}.${hash}`;
}

function verifySecretHash(secret, storedHash) {
    if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes('.')) return false;
    const [salt, expectedHash] = storedHash.split('.', 2);
    if (!salt || !expectedHash) return false;
    const actualHash = crypto.scryptSync(String(secret), salt, 64).toString('hex');
    return safeCompareString(actualHash, expectedHash);
}

function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}

function createRefreshToken(tokenId) {
    return `${tokenId}.${randomToken(32)}`;
}

function parseRefreshToken(refreshToken) {
    if (!refreshToken || typeof refreshToken !== 'string') return null;
    const firstDot = refreshToken.indexOf('.');
    if (firstDot <= 0 || firstDot === refreshToken.length - 1) return null;
    const tokenId = refreshToken.slice(0, firstDot);
    const secret = refreshToken.slice(firstDot + 1);
    if (!tokenId || !secret) return null;
    return { tokenId, secret };
}

function signJwtHS256(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = encodeJson(header);
    const encodedPayload = encodeJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto
        .createHmac('sha256', secret)
        .update(signingInput)
        .digest('base64url');
    return `${signingInput}.${signature}`;
}

function verifyJwtHS256(token, secret, options = {}) {
    if (!token || typeof token !== 'string') {
        throw new Error('Invalid token format');
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
        throw new Error('Invalid token format');
    }

    const [encodedHeader, encodedPayload, signature] = segments;
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signingInput)
        .digest('base64url');

    if (!safeCompareString(signature, expectedSignature)) {
        throw new Error('Invalid token signature');
    }

    let header;
    let payload;
    try {
        header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
        payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    } catch (error) {
        throw new Error('Invalid token encoding');
    }

    if (header.alg !== 'HS256') {
        throw new Error('Unsupported token algorithm');
    }

    const now = Math.floor(Date.now() / 1000);
    const clockSkew = Number.isFinite(options.clockSkewSeconds) ? options.clockSkewSeconds : 0;

    if (payload.nbf && now + clockSkew < payload.nbf) {
        throw new Error('Token not active yet');
    }
    if (!payload.exp || now - clockSkew >= payload.exp) {
        throw new Error('Token expired');
    }
    if (payload.iat && payload.iat > now + clockSkew) {
        throw new Error('Invalid token issue time');
    }
    if (options.issuer && payload.iss !== options.issuer) {
        throw new Error('Invalid token issuer');
    }
    if (options.audience) {
        const audience = payload.aud;
        const validAudience = Array.isArray(audience)
            ? audience.includes(options.audience)
            : audience === options.audience;
        if (!validAudience) {
            throw new Error('Invalid token audience');
        }
    }

    return { header, payload };
}

module.exports = {
    base64UrlEncode,
    base64UrlDecode,
    hashSecret,
    verifySecretHash,
    randomToken,
    createRefreshToken,
    parseRefreshToken,
    signJwtHS256,
    verifyJwtHS256
};
