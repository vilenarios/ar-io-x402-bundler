/**
 * Rate Limiting Middleware for Admin Dashboard
 *
 * Prevents abuse of stats API endpoint
 * Limit: 60 requests per minute per IP
 */

const rateLimit = require('koa-ratelimit');

const RATE_LIMIT_WINDOW = 60000; // 1 minute in milliseconds
const RATE_LIMIT_MAX = 60; // requests per window

/**
 * In-memory rate limiting for admin stats endpoint
 * For production with multiple instances, use Redis driver instead
 */
const statsRateLimiter = rateLimit({
  driver: 'memory',
  db: new Map(),
  duration: RATE_LIMIT_WINDOW,
  errorMessage: {
    error: 'Too many requests',
    message: 'Please wait before requesting stats again',
    retryAfter: RATE_LIMIT_WINDOW / 1000
  },
  id: (ctx) => ctx.ip,
  headers: {
    remaining: 'X-RateLimit-Remaining',
    reset: 'X-RateLimit-Reset',
    total: 'X-RateLimit-Limit'
  },
  max: RATE_LIMIT_MAX,
  disableHeader: false,
  whitelist: (ctx) => {
    // Allow localhost without rate limiting in development
    return process.env.NODE_ENV === 'development' &&
           (ctx.ip === '127.0.0.1' || ctx.ip === '::1' || ctx.ip === 'localhost');
  },
  blacklist: (ctx) => {
    // Could blacklist IPs here if needed
    return false;
  }
});

module.exports = { statsRateLimiter };
