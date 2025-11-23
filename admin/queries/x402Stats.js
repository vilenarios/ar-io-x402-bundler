/**
 * x402 Payment Statistics Query Functions
 *
 * Queries the upload_service database for x402 USDC payments:
 * - Total x402 payments (count, USDC amount, data uploaded)
 * - Payments by network (base-mainnet, base-sepolia, etc.)
 * - Top payers (by payment count and volume)
 * - Recent x402 payments
 */

// USDC has 6 decimals, so amounts in DB are in smallest unit
const USDC_DECIMALS = 1000000;

/**
 * Get comprehensive x402 payment statistics
 * @param {object} db - Knex database connection (upload_service)
 * @returns {Promise<object>} x402 payment statistics
 */
async function getX402Stats(db) {
  try {
    // Check if table exists first (use new table name)
    const tableExists = await db.schema.hasTable('x402_payment_transaction');

    if (!tableExists) {
      return getEmptyX402Stats();
    }

    const [totalStats, networkStats, topPayers, recentPayments] = await Promise.all([
      getTotalX402Stats(db),
      getX402NetworkStats(db),
      getTopX402Payers(db),
      getRecentX402Payments(db)
    ]);

    return {
      total: totalStats,
      byNetwork: networkStats,
      topPayers: topPayers,
      recentPayments: recentPayments
    };
  } catch (error) {
    console.error('Failed to get x402 stats:', error);
    throw error;
  }
}

/**
 * Get total x402 payment statistics
 */
async function getTotalX402Stats(db) {
  const result = await db('x402_payment_transaction')
    .select(
      db.raw('COUNT(*) as total_count'),
      db.raw('COALESCE(SUM(CAST(usdc_amount AS NUMERIC)), 0) as total_usdc'),
      db.raw('COALESCE(AVG(CAST(usdc_amount AS NUMERIC)), 0) as average_payment'),
      db.raw('COALESCE(SUM(CAST(COALESCE(declared_byte_count, actual_byte_count, \'0\') AS BIGINT)), 0) as total_bytes'),
      db.raw('COUNT(DISTINCT payer_address) as unique_payers')
    )
    .first();

  return {
    totalCount: parseInt(result.total_count),
    totalUSDC: (parseFloat(result.total_usdc) / USDC_DECIMALS).toFixed(6),
    averagePayment: (parseFloat(result.average_payment) / USDC_DECIMALS).toFixed(6),
    totalBytes: result.total_bytes,
    totalBytesFormatted: formatBytes(result.total_bytes),
    uniquePayers: parseInt(result.unique_payers)
  };
}

/**
 * Get x402 payments by network
 */
async function getX402NetworkStats(db) {
  const results = await db('x402_payment_transaction')
    .select(
      'network',
      db.raw('COUNT(*) as count'),
      db.raw('COALESCE(SUM(CAST(usdc_amount AS NUMERIC)), 0) as total_amount'),
      db.raw('COALESCE(SUM(CAST(COALESCE(declared_byte_count, actual_byte_count, \'0\') AS BIGINT)), 0) as total_bytes')
    )
    .groupBy('network')
    .orderBy('count', 'desc');

  const stats = {};
  results.forEach(row => {
    stats[row.network] = {
      count: parseInt(row.count),
      totalUSDC: (parseFloat(row.total_amount) / USDC_DECIMALS).toFixed(6),
      totalBytes: row.total_bytes,
      totalBytesFormatted: formatBytes(row.total_bytes)
    };
  });

  return stats;
}

/**
 * Get top x402 payers (by payment count)
 */
async function getTopX402Payers(db, limit = 10) {
  const results = await db('x402_payment_transaction')
    .select(
      'payer_address',
      db.raw('COUNT(*) as payment_count'),
      db.raw('COALESCE(SUM(CAST(usdc_amount AS NUMERIC)), 0) as total_usdc'),
      db.raw('COALESCE(SUM(CAST(COALESCE(declared_byte_count, actual_byte_count, \'0\') AS BIGINT)), 0) as total_bytes')
    )
    .groupBy('payer_address')
    .orderBy('payment_count', 'desc')
    .limit(limit);

  return results.map(row => ({
    address: row.payer_address,
    paymentCount: parseInt(row.payment_count),
    totalUSDC: (parseFloat(row.total_usdc) / USDC_DECIMALS).toFixed(6),
    totalBytes: row.total_bytes,
    totalBytesFormatted: formatBytes(row.total_bytes)
  }));
}

/**
 * Get recent x402 payments (last 50)
 */
async function getRecentX402Payments(db, limit = 50) {
  const results = await db('x402_payment_transaction')
    .select(
      'id',
      'tx_hash',
      'network',
      'payer_address',
      'usdc_amount',
      'declared_byte_count',
      'actual_byte_count',
      'data_item_id',
      'paid_at'
    )
    .orderBy('paid_at', 'desc')
    .limit(limit);

  return results.map(row => ({
    paymentId: row.id,
    txHash: row.tx_hash,
    network: row.network,
    payerAddress: row.payer_address,
    amount: `${(parseFloat(row.usdc_amount) / USDC_DECIMALS).toFixed(6)} USDC`,
    bytes: parseInt(row.declared_byte_count || row.actual_byte_count || 0),
    bytesFormatted: formatBytes(row.declared_byte_count || row.actual_byte_count || 0),
    dataItemId: row.data_item_id,
    timestamp: row.paid_at
  }));
}

/**
 * Helper: Format bytes to human-readable string
 */
function formatBytes(bytes) {
  const num = typeof bytes === 'string' ? parseFloat(bytes) : parseFloat(bytes || 0);
  if (num === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let value = num;

  while (value >= k && i < sizes.length - 1) {
    value = value / k;
    i++;
  }

  return `${value.toFixed(2)} ${sizes[i]}`;
}

/**
 * Get empty x402 stats (fallback for errors)
 */
function getEmptyX402Stats() {
  return {
    total: {
      totalCount: 0,
      totalUSDC: '0.000000',
      averagePayment: '0.000000',
      totalBytes: 0,
      totalBytesFormatted: '0 B',
      uniquePayers: 0
    },
    byNetwork: {},
    topPayers: [],
    recentPayments: []
  };
}

module.exports = {
  getX402Stats,
  getTotalX402Stats,
  getX402NetworkStats,
  getTopX402Payers,
  getRecentX402Payments
};
