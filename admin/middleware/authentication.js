/**
 * Admin Dashboard Authentication Middleware
 *
 * Uses Basic Auth to protect all admin routes
 * Credentials configured via environment variables:
 * - ADMIN_USERNAME (default: admin)
 * - ADMIN_PASSWORD (required)
 */

const auth = require('koa-basic-auth');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD not set! Admin dashboard will be inaccessible.');
  console.warn('   Set ADMIN_PASSWORD in your .env file to enable admin access.');
}

/**
 * Basic Auth middleware for admin routes
 * Usage: app.use(authenticateAdmin)
 */
async function authenticateAdmin(ctx, next) {
  // Skip auth if password not configured (but log warning)
  if (!ADMIN_PASSWORD) {
    ctx.status = 503;
    ctx.body = {
      error: 'Admin dashboard not configured',
      message: 'ADMIN_PASSWORD must be set in environment variables'
    };
    return;
  }

  try {
    await auth({
      name: ADMIN_USERNAME,
      pass: ADMIN_PASSWORD
    })(ctx, next);
  } catch (err) {
    // Log failed authentication attempts
    console.warn(`Failed admin auth attempt from ${ctx.ip} at ${new Date().toISOString()}`);

    ctx.status = 401;
    ctx.set('WWW-Authenticate', 'Basic realm="AR.IO Bundler Admin"');
    ctx.body = { error: 'Authentication required' };
  }
}

module.exports = { authenticateAdmin };
