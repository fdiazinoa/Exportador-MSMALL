function createMemoryRateLimiter({ windowMs = 60000, max = 30, keyFn, name = 'rate_limit' } = {}) {
    const buckets = new Map();

    return function rateLimitMiddleware(req, res, next) {
        const now = Date.now();
        const key = keyFn ? keyFn(req) : (req.ip || 'unknown');
        const bucketKey = `${name}:${key}`;
        const bucket = buckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };

        if (now > bucket.resetAt) {
            bucket.count = 0;
            bucket.resetAt = now + windowMs;
        }

        bucket.count += 1;
        buckets.set(bucketKey, bucket);

        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

        if (bucket.count > max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
                error: 'Too many requests',
                code: 'rate_limited'
            });
        }

        next();
    };
}

module.exports = {
    createMemoryRateLimiter
};
