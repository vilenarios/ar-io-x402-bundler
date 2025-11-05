/**
 * AR.IO Bundler Lite - Admin Dashboard
 *
 * Provides:
 * - BullMQ queue monitoring (/admin/queues)
 * - System statistics dashboard (/admin/dashboard)
 * - Stats API endpoint (/admin/stats)
 *
 * Authentication: Basic Auth (ADMIN_USERNAME / ADMIN_PASSWORD)
 *
 * Run with: node admin-server.js
 * Access at: http://localhost:3002/admin/dashboard
 */

// Load environment variables
require('dotenv').config();

const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { KoaAdapter } = require("@bull-board/koa");
const { Queue } = require("bullmq");
const Koa = require("koa");
const Router = require("@koa/router");
const serve = require("koa-static");
const mount = require("koa-mount");

// Import from bundler (constants and queue config)
const { jobLabels } = require('./lib/constants');
const { getQueue } = require('./lib/arch/queues/config');

const { authenticateAdmin } = require("./admin/middleware/authentication");
const { statsRateLimiter } = require("./admin/middleware/rateLimit");
const { initializeStatsCollector, getStats, cleanup } = require("./admin/statsCollector");

const app = new Koa();
const router = new Router();

// Initialize stats collector with single database
const config = {
  redisHost: process.env.REDIS_CACHE_HOST || 'localhost',
  redisPort: process.env.REDIS_CACHE_PORT || '6379',
  redisQueueHost: process.env.REDIS_QUEUE_HOST || 'localhost',
  redisQueuePort: process.env.REDIS_QUEUE_PORT || '6381',
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: process.env.DB_PORT || '5432',
  dbName: process.env.DB_DATABASE || 'bundler_lite',
  dbUser: process.env.DB_USER || 'postgres',
  dbPassword: process.env.DB_PASSWORD
};

initializeStatsCollector(config);

// Configure Bull Board
const serverAdapter = new KoaAdapter();
serverAdapter.setBasePath("/admin/queues");

// Bundler queues (11 queues)
const redisConfig = {
  host: process.env.REDIS_QUEUE_HOST || "localhost",
  port: parseInt(process.env.REDIS_QUEUE_PORT || "6381"),
  maxRetriesPerRequest: null,
};

const queues = [
  jobLabels.planBundle,
  jobLabels.prepareBundle,
  jobLabels.postBundle,
  jobLabels.seedBundle,
  jobLabels.verifyBundle,
  jobLabels.putOffsets,
  jobLabels.newDataItem,
  jobLabels.opticalPost,
  jobLabels.unbundleBdi,
  jobLabels.finalizeUpload,
  jobLabels.cleanupFs,
].map((label) => new BullMQAdapter(getQueue(label)));

createBullBoard({
  queues,
  serverAdapter,
});

// Apply authentication to ALL /admin routes
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/admin')) {
    await authenticateAdmin(ctx, next);
  } else {
    await next();
  }
});

// Admin stats API endpoint with rate limiting
router.get('/admin/stats', statsRateLimiter, async (ctx) => {
  try {
    const stats = await getStats(queues);
    ctx.body = stats;
    ctx.set('Content-Type', 'application/json');
  } catch (error) {
    console.error('Failed to get stats:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to fetch statistics',
      message: error.message
    };
  }
});

// Redirect /admin to /admin/dashboard
router.get('/admin', (ctx) => {
  ctx.redirect('/admin/dashboard');
});

// Redirect root to /admin/dashboard
router.get('/', (ctx) => {
  ctx.redirect('/admin/dashboard');
});

// Serve dashboard static files (HTML, CSS, JS)
app.use(mount('/admin/dashboard', serve(__dirname + '/admin/public')));

// Mount custom routes
app.use(router.routes());
app.use(router.allowedMethods());

// Mount Bull Board
app.use(mount(serverAdapter.registerPlugin()));

// Error handling middleware
app.on('error', (err, ctx) => {
  console.error('Server error:', err, ctx);
});

const PORT = process.env.BULL_BOARD_PORT || 3002;

const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║      AR.IO Bundler Lite - Admin Dashboard                ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  📊 Dashboard:  http://localhost:${PORT}/admin/dashboard      ║
║  📈 Queues:     http://localhost:${PORT}/admin/queues         ║
║  🔌 Stats API:  http://localhost:${PORT}/admin/stats          ║
║                                                           ║
║  🔒 Authentication Required (Basic Auth)                  ║
║      Username: ${process.env.ADMIN_USERNAME || 'admin'}                                        ║
║      Password: ${process.env.ADMIN_PASSWORD ? '***' + process.env.ADMIN_PASSWORD.slice(-4) : 'NOT SET'}                                       ║
║                                                           ║
║  Monitoring ${queues.length} BullMQ queues:                          ║
║                                                           ║
║  📦 x402 Bundler Queues:                                  ║
║  • plan-bundle        • prepare-bundle                    ║
║  • post-bundle        • seed-bundle                       ║
║  • verify-bundle      • put-offsets                       ║
║  • new-data-item      • optical-post                      ║
║  • unbundle-bdi       • finalize-upload                   ║
║  • cleanup-fs                                             ║
║                                                           ║
║  💳 x402 USDC Payments:                                   ║
║  • Integrated payment tracking                            ║
║  • Network statistics (Base, Ethereum, Polygon)           ║
║  • Top payers and recent transactions                     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  if (!process.env.ADMIN_PASSWORD) {
    console.warn(`
⚠️  WARNING: ADMIN_PASSWORD not set!
   Set ADMIN_PASSWORD in your .env file to enable admin dashboard access.
   Example: ADMIN_PASSWORD=$(openssl rand -hex 32)
    `);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  await cleanup();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT received, shutting down gracefully...');
  await cleanup();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
