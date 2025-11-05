/**
 * Admin Dashboard Stats Collector (x402 Bundler Lite)
 *
 * Aggregates statistics from bundler database and system health
 * Implements Redis caching to minimize database load
 */

const { getUploadStats } = require('./queries/uploadStats');
const { getX402Stats } = require('./queries/x402Stats');
const { getBundleStats } = require('./queries/bundleStats');
const { getSystemHealth } = require('./queries/systemHealth');
const Redis = require('ioredis');
const Knex = require('knex');

const CACHE_TTL = 30; // seconds
const CACHE_KEY = 'admin:stats';

let cacheRedis = null;
let db = null;
let queueRedis = null;

/**
 * Initialize stats collector with database and Redis connections
 */
function initializeStatsCollector(config) {
  // Redis for caching (ElastiCache - port 6379)
  try {
    if (!cacheRedis) {
      cacheRedis = new Redis({
        host: config.redisHost || 'localhost',
        port: parseInt(config.redisPort || '6379'),
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 100, 1000);
        }
      });
      console.log('📊 Stats collector: Connected to Redis cache');
    }
  } catch (error) {
    console.warn('⚠️  Stats collector: Failed to connect to Redis cache:', error.message);
    cacheRedis = null;
  }

  // Redis for queue stats (BullMQ - port 6381)
  try {
    if (!queueRedis) {
      queueRedis = new Redis({
        host: config.redisQueueHost || 'localhost',
        port: parseInt(config.redisQueuePort || '6381'),
        maxRetriesPerRequest: null
      });
      console.log('📊 Stats collector: Connected to Redis queues');
    }
  } catch (error) {
    console.warn('⚠️  Stats collector: Failed to connect to Redis queues:', error.message);
    queueRedis = null;
  }

  // Bundler database (single database for all stats)
  try {
    if (!db) {
      db = Knex({
        client: 'postgresql',
        connection: {
          host: config.dbHost || 'localhost',
          port: parseInt(config.dbPort || '5432'),
          database: config.dbName || 'bundler_lite',
          user: config.dbUser || 'postgres',
          password: config.dbPassword
        },
        pool: { min: 1, max: 5 }
      });
      console.log('📊 Stats collector: Connected to bundler database');
    }
  } catch (error) {
    console.error('❌ Stats collector: Failed to connect to database:', error.message);
    throw error;
  }
}

/**
 * Get aggregated statistics from all sources
 */
async function getStats(queues) {
  try {
    // Try to get from cache first
    const cached = cacheRedis ? await cacheRedis.get(CACHE_KEY) : null;
    if (cached) {
      console.log('📊 Returning cached stats');
      return JSON.parse(cached);
    }

    console.log('📊 Generating fresh stats...');

    // Gather stats in parallel
    const [uploadStats, x402Stats, bundleStats, systemHealth, queueStats] = await Promise.all([
      getUploadStats(db).catch(error => {
        console.error('Failed to get upload stats:', error);
        return null;
      }),
      getX402Stats(db).catch(error => {
        console.error('Failed to get x402 stats:', error);
        return null;
      }),
      getBundleStats(db).catch(error => {
        console.error('Failed to get bundle stats:', error);
        return null;
      }),
      getSystemHealth(db, queueRedis).catch(error => {
        console.error('Failed to get system health:', error);
        return null;
      }),
      getQueueStats(queues).catch(error => {
        console.error('Failed to get queue stats:', error);
        return null;
      })
    ]);

    const stats = {
      upload: uploadStats,
      x402: x402Stats,
      bundles: bundleStats,
      system: systemHealth,
      queues: queueStats,
      timestamp: new Date().toISOString()
    };

    // Cache the results
    if (cacheRedis) {
      await cacheRedis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(stats));
    }

    return stats;
  } catch (error) {
    console.error('Failed to collect stats:', error);
    throw error;
  }
}

/**
 * Get queue statistics from Bull Board adapters
 */
async function getQueueStats(queues) {
  try {
    const stats = await Promise.all(
      queues.map(async (queue) => {
        try {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed'
          );
          return {
            name: queue.name,
            waiting: counts.waiting || 0,
            active: counts.active || 0,
            completed: counts.completed || 0,
            failed: counts.failed || 0,
            delayed: counts.delayed || 0
          };
        } catch (error) {
          console.error(`Failed to get stats for queue ${queue.name}:`, error.message);
          return {
            name: queue.name,
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            error: error.message
          };
        }
      })
    );

    const totals = stats.reduce((acc, queue) => ({
      waiting: acc.waiting + queue.waiting,
      active: acc.active + queue.active,
      completed: acc.completed + queue.completed,
      failed: acc.failed + queue.failed,
      delayed: acc.delayed + queue.delayed
    }), { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });

    return {
      byQueue: stats,
      totals: totals
    };
  } catch (error) {
    console.error('Failed to get queue stats:', error);
    return null;
  }
}

/**
 * Cleanup connections gracefully
 */
async function cleanup() {
  console.log('📊 Cleaning up stats collector connections...');

  if (cacheRedis) {
    await cacheRedis.quit();
    cacheRedis = null;
  }

  if (queueRedis) {
    await queueRedis.quit();
    queueRedis = null;
  }

  if (db) {
    await db.destroy();
    db = null;
  }

  console.log('✅ Stats collector cleanup complete');
}

module.exports = {
  initializeStatsCollector,
  getStats,
  cleanup
};
