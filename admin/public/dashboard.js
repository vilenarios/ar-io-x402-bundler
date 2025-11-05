/**
 * AR.IO Bundler Admin Dashboard - Client-Side Logic
 *
 * Handles:
 * - Fetching stats from /admin/stats API
 * - Updating UI with fresh data
 * - Creating Chart.js visualizations
 * - Manual refresh (no auto-refresh per user request)
 */

// Chart instances (global to allow updates)
let signatureChart = null;
let paymentModeChart = null;
let networkChart = null;

/**
 * Fetch stats from API and update dashboard
 */
async function fetchStats() {
  const refreshBtn = document.getElementById('refresh-btn');
  const refreshIcon = document.getElementById('refresh-icon');
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const dashboard = document.getElementById('dashboard');

  // Show loading state
  refreshBtn.classList.add('loading');
  refreshBtn.disabled = true;
  if (dashboard.style.display === 'none') {
    loading.style.display = 'block';
  }
  error.style.display = 'none';

  try {
    const response = await fetch('/admin/stats');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const stats = await response.json();

    // Hide loading, show dashboard
    loading.style.display = 'none';
    dashboard.style.display = 'block';

    // Update all dashboard sections
    updateSystemHealth(stats.system);
    updateOverviewCards(stats);
    updateCharts(stats);
    updateQueueStatus(stats.system.queues);
    updateTopUploaders(stats.uploads.topUploaders);
    updateRecentUploads(stats.uploads.recentUploads);
    updateRecentTraditionalPayments(stats.payments?.recentPayments || []);
    updateRecentX402Payments(stats.x402Payments?.recentPayments || []);
    updateRecentBundles(stats.bundles?.recentPermanent || []);

    // Update last refresh time
    updateLastRefresh(stats.timestamp, stats._cached, stats._cacheAge);

  } catch (err) {
    console.error('Failed to fetch stats:', err);

    // Show error banner
    loading.style.display = 'none';
    error.style.display = 'flex';
    document.getElementById('error-message').textContent = err.message;

  } finally {
    // Reset button state
    refreshBtn.classList.remove('loading');
    refreshBtn.disabled = false;
  }
}

/**
 * Update system health indicators
 */
function updateSystemHealth(health) {
  const grid = document.getElementById('health-grid');
  grid.innerHTML = '';

  // Services
  Object.entries(health.services || {}).forEach(([name, data]) => {
    const el = document.createElement('div');
    el.className = `health-item ${data.status}`;
    el.innerHTML = `
      <span class="health-icon">${data.status === 'healthy' ? '✅' : '❌'}</span>
      <div>
        <div class="health-name">${formatServiceName(name)}</div>
        <div class="health-meta">${data.uptime || 'Unknown'} | ${data.memory || '--'}</div>
      </div>
    `;
    grid.appendChild(el);
  });

  // Infrastructure
  Object.entries(health.infrastructure || {}).forEach(([name, data]) => {
    const el = document.createElement('div');
    el.className = `health-item ${data.status}`;
    el.innerHTML = `
      <span class="health-icon">${data.status === 'healthy' ? '✅' : '❌'}</span>
      <div>
        <div class="health-name">${formatServiceName(name)}</div>
        <div class="health-meta">${data.memoryUsed || data.connections ? `${data.connections || ''} ${data.memoryUsed || ''}`.trim() : 'Active'}</div>
      </div>
    `;
    grid.appendChild(el);
  });
}

/**
 * Update overview stat cards
 */
function updateOverviewCards(stats) {
  // Today's uploads
  document.getElementById('today-uploads').textContent =
    stats.uploads.today.totalUploads.toLocaleString();
  document.getElementById('today-bytes').textContent =
    stats.uploads.today.totalBytesFormatted;

  // All time uploads
  document.getElementById('total-uploads').textContent =
    stats.uploads.allTime.totalUploads.toLocaleString();
  document.getElementById('total-bytes').textContent =
    stats.uploads.allTime.totalBytesFormatted;

  // Unique users
  document.getElementById('unique-users').textContent =
    stats.uploads.allTime.uniqueUploaders.toLocaleString();
  document.getElementById('users-today').textContent =
    `${stats.uploads.today.uniqueUploaders} today`;

  // Traditional payments (from payment_service - x402_payment_transaction table)
  const traditionalTotal = stats.payments?.x402Payments?.totalUSDC || '0.000000';
  const traditionalCount = stats.payments?.x402Payments?.totalCount || 0;
  document.getElementById('traditional-total').textContent =
    `$${parseFloat(traditionalTotal).toLocaleString()}`;
  document.getElementById('traditional-count').textContent =
    `${traditionalCount.toLocaleString()} payments`;

  // x402 payments (from upload_service - x402_payments table)
  const x402Total = stats.x402Payments?.total?.totalUSDC || '0.000000';
  const x402Count = stats.x402Payments?.total?.totalCount || 0;
  document.getElementById('x402-total').textContent =
    `$${parseFloat(x402Total).toLocaleString()}`;
  document.getElementById('x402-count').textContent =
    `${x402Count.toLocaleString()} payments`;
}

/**
 * Update all Chart.js visualizations
 */
function updateCharts(stats) {
  updateSignatureChart(stats.uploads.bySignatureType);
  updatePaymentTypeChart(stats.payments?.x402Payments?.byMode || {});
  updateNetworkChart(stats.x402Payments?.byNetwork || {});
}

/**
 * Update signature type distribution chart (Doughnut)
 */
function updateSignatureChart(byType) {
  const ctx = document.getElementById('signature-chart').getContext('2d');

  const data = Object.entries(byType).map(([type, data]) => ({
    label: type,
    value: data.count
  }));

  const chartData = {
    labels: data.map(d => d.label),
    datasets: [{
      data: data.map(d => d.value),
      backgroundColor: [
        '#3b82f6', // Blue (Ethereum)
        '#10b981', // Green (Arweave)
        '#f59e0b', // Amber (Solana)
        '#8b5cf6', // Purple
        '#ec4899', // Pink
      ],
      borderWidth: 2,
      borderColor: '#ffffff'
    }]
  };

  const config = {
    type: 'doughnut',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 16,
            font: { size: 13 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value.toLocaleString()} (${percentage}%)`;
            }
          }
        }
      }
    }
  };

  if (signatureChart) {
    signatureChart.destroy();
  }
  signatureChart = new Chart(ctx, config);
}

/**
 * Update traditional payment type distribution chart (Pie)
 */
function updatePaymentTypeChart(byMode) {
  const ctx = document.getElementById('payment-type-chart').getContext('2d');

  const data = Object.entries(byMode).map(([mode, data]) => ({
    label: mode.toUpperCase(),
    value: data.count
  }));

  if (data.length === 0) {
    data.push({ label: 'No Data', value: 1 });
  }

  const chartData = {
    labels: data.map(d => d.label),
    datasets: [{
      data: data.map(d => d.value),
      backgroundColor: [
        '#06b6d4', // Cyan (PAYG)
        '#8b5cf6', // Purple (TopUp)
        '#10b981', // Green (Hybrid)
      ],
      borderWidth: 2,
      borderColor: '#ffffff'
    }]
  };

  const config = {
    type: 'pie',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 16,
            font: { size: 13 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              return `${label}: ${value.toLocaleString()} payments`;
            }
          }
        }
      }
    }
  };

  if (paymentModeChart) {
    paymentModeChart.destroy();
  }
  paymentModeChart = new Chart(ctx, config);
}

// For backward compatibility, keep the old name as an alias
const updatePaymentModeChart = updatePaymentTypeChart;

/**
 * Update network distribution chart (Bar)
 */
function updateNetworkChart(byNetwork) {
  const ctx = document.getElementById('network-chart').getContext('2d');

  const data = Object.entries(byNetwork).map(([network, data]) => ({
    label: formatNetworkName(network),
    count: data.count,
    amount: parseFloat(data.amount)
  }));

  const chartData = {
    labels: data.map(d => d.label),
    datasets: [
      {
        label: 'Payment Count',
        data: data.map(d => d.count),
        backgroundColor: '#3b82f6',
        borderRadius: 6,
        yAxisID: 'y'
      },
      {
        label: 'Total USDC',
        data: data.map(d => d.amount),
        backgroundColor: '#10b981',
        borderRadius: 6,
        yAxisID: 'y1'
      }
    ]
  };

  const config = {
    type: 'bar',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            padding: 16,
            font: { size: 13 }
          }
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'Payment Count'
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'Total USDC'
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  };

  if (networkChart) {
    networkChart.destroy();
  }
  networkChart = new Chart(ctx, config);
}

/**
 * Update queue status summary and grid
 */
function updateQueueStatus(queues) {
  // Summary
  const summary = document.getElementById('queue-summary');
  summary.innerHTML = `
    <div class="queue-stat">
      <div class="queue-stat-value">${queues.totalActive || 0}</div>
      <div class="queue-stat-label">Active</div>
    </div>
    <div class="queue-stat">
      <div class="queue-stat-value">${queues.totalWaiting || 0}</div>
      <div class="queue-stat-label">Waiting</div>
    </div>
    <div class="queue-stat">
      <div class="queue-stat-value">${queues.totalFailed || 0}</div>
      <div class="queue-stat-label">Failed</div>
    </div>
    <div class="queue-stat">
      <div class="queue-stat-value">${queues.totalDelayed || 0}</div>
      <div class="queue-stat-label">Delayed</div>
    </div>
  `;

  // Grid
  const grid = document.getElementById('queue-grid');
  grid.innerHTML = '';

  (queues.byQueue || []).forEach(q => {
    const el = document.createElement('div');
    el.className = 'queue-card';
    el.innerHTML = `
      <div class="queue-name">${q.name}</div>
      <div class="queue-stats">
        <span>
          <div class="value">${q.active}</div>
          <div class="label">Active</div>
        </span>
        <span>
          <div class="value">${q.waiting}</div>
          <div class="label">Waiting</div>
        </span>
        <span>
          <div class="value ${q.failed > 0 ? 'text-danger' : ''}">${q.failed}</div>
          <div class="label">Failed</div>
        </span>
      </div>
    `;
    grid.appendChild(el);
  });
}

/**
 * Update top uploaders table
 */
function updateTopUploaders(uploaders) {
  const table = document.getElementById('top-uploaders-table');

  if (uploaders.length === 0) {
    table.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 40px; color: var(--text-secondary);">No data available</td></tr>';
    return;
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th>Address</th>
        <th style="text-align: right;">Upload Count</th>
        <th style="text-align: right;">Total Size</th>
      </tr>
    </thead>
    <tbody>
      ${uploaders.map(u => `
        <tr>
          <td>${makeCopyable(u.address, null, 'address')}</td>
          <td style="text-align: right;">${u.uploadCount.toLocaleString()}</td>
          <td style="text-align: right;">${u.totalBytesFormatted}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
}

/**
 * Update recent uploads table
 */
function updateRecentUploads(uploads) {
  const table = document.getElementById('recent-uploads-table');

  if (uploads.length === 0) {
    table.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">No recent uploads</td></tr>';
    return;
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th>Data Item ID</th>
        <th>Size</th>
        <th>Signature Type</th>
        <th>Owner</th>
        <th>Time</th>
      </tr>
    </thead>
    <tbody>
      ${uploads.map(u => `
        <tr>
          <td>${makeCopyable(u.id, null, 'data item ID')}</td>
          <td>${u.sizeFormatted}</td>
          <td>${u.signatureType}</td>
          <td>${makeCopyable(u.owner, null, 'address')}</td>
          <td>${formatTime(u.timestamp)}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
}

/**
 * Update recent traditional payments table (from payment_service)
 */
function updateRecentTraditionalPayments(payments) {
  const table = document.getElementById('recent-traditional-payments-table');

  if (!payments || payments.length === 0) {
    table.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px; color: var(--text-secondary);">No recent traditional payments</td></tr>';
    return;
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th>Payment ID</th>
        <th>Network</th>
        <th style="text-align: right;">Amount</th>
        <th>Mode</th>
        <th>Time</th>
      </tr>
    </thead>
    <tbody>
      ${payments.map(p => `
        <tr>
          <td>${makeCopyable(p.paymentId, null, 'payment ID')}</td>
          <td>${formatNetworkName(p.network)}</td>
          <td style="text-align: right;">${p.amount}</td>
          <td><span class="badge">${p.mode ? p.mode.toUpperCase() : 'N/A'}</span></td>
          <td>${formatTime(p.timestamp)}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
}

/**
 * Update recent x402 payments table (from upload_service)
 */
function updateRecentX402Payments(payments) {
  const table = document.getElementById('recent-x402-payments-table');

  if (!payments || payments.length === 0) {
    table.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">No recent x402 payments</td></tr>';
    return;
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th>Payment ID</th>
        <th>TX Hash</th>
        <th>Network</th>
        <th style="text-align: right;">Amount</th>
        <th>Data Size</th>
        <th>Time</th>
      </tr>
    </thead>
    <tbody>
      ${payments.map(p => `
        <tr>
          <td>${makeCopyable(p.paymentId, null, 'payment ID')}</td>
          <td>${makeCopyable(p.txHash, null, 'transaction hash')}</td>
          <td>${formatNetworkName(p.network)}</td>
          <td style="text-align: right;">${p.amount}</td>
          <td>${p.bytesFormatted}</td>
          <td>${formatTime(p.timestamp)}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
}

/**
 * Update recent bundles table
 */
function updateRecentBundles(bundles) {
  const table = document.getElementById('recent-bundles-table');

  if (!bundles || bundles.length === 0) {
    table.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">No recent bundles</td></tr>';
    return;
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th>Bundle ID</th>
        <th>Status</th>
        <th style="text-align: right;">Size</th>
        <th>Block Height</th>
        <th>Posted</th>
        <th>Verified</th>
      </tr>
    </thead>
    <tbody>
      ${bundles.map(b => `
        <tr>
          <td>${makeCopyable(b.bundleId, null, 'bundle ID')}</td>
          <td><span class="badge ${b.status === 'permanent' ? 'badge-success' : 'badge-info'}">${b.status.toUpperCase()}</span></td>
          <td style="text-align: right;">${b.payloadSizeFormatted}</td>
          <td>${b.blockHeight || 'Pending'}</td>
          <td>${formatTime(b.postedDate)}</td>
          <td>${b.permanentDate ? formatTime(b.permanentDate) : 'Pending'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
}

/**
 * Update last refresh indicator
 */
function updateLastRefresh(timestamp, cached, cacheAge) {
  const indicator = document.getElementById('last-refresh');
  const now = new Date();
  const time = now.toLocaleTimeString();

  if (cached) {
    indicator.textContent = `${time} (cached ${cacheAge}s ago)`;
  } else {
    indicator.textContent = time;
  }
}

/**
 * Helper: Format service name
 */
function formatServiceName(name) {
  const names = {
    'payment-service': 'Payment API',
    'upload-api': 'Upload API',
    'upload-workers': 'Upload Workers',
    'payment-workers': 'Payment Workers',
    'bull-board': 'Admin Dashboard',
    'postgresUpload': 'PostgreSQL (Upload)',
    'postgresPayment': 'PostgreSQL (Payment)',
    'redisCache': 'Redis Cache',
    'redisQueues': 'Redis Queues',
    'minio': 'MinIO Object Storage'
  };
  return names[name] || name;
}

/**
 * Helper: Format network name
 */
function formatNetworkName(network) {
  const names = {
    'base-mainnet': 'Base Mainnet',
    'base-sepolia': 'Base Sepolia (Testnet)',
    'ethereum-mainnet': 'Ethereum Mainnet',
    'polygon-mainnet': 'Polygon Mainnet'
  };
  return names[network] || network;
}

/**
 * Helper: Truncate address for display
 */
function truncateAddress(address) {
  if (!address || address.length < 16) return address;
  return `${address.substring(0, 8)}...${address.substring(address.length - 6)}`;
}

/**
 * Helper: Truncate ID for display
 */
function truncateId(id) {
  if (!id || id.length < 16) return id;
  return `${id.substring(0, 12)}...`;
}

/**
 * Helper: Create copyable ID element with click-to-copy functionality
 * @param {string} fullId - The full ID to be copied
 * @param {string} displayText - The truncated text to display (optional, will truncate if not provided)
 * @param {string} type - Type of ID for display purposes ('id', 'address', 'hash')
 */
function makeCopyable(fullId, displayText = null, type = 'id') {
  if (!fullId) return fullId;

  // Auto-truncate if no display text provided
  const display = displayText || (type === 'address' ? truncateAddress(fullId) : truncateId(fullId));

  // Generate unique ID for this element
  const uniqueId = 'copy-' + Math.random().toString(36).substr(2, 9);

  return `<span class="copyable-id"
               onclick="copyToClipboard('${escapeHtml(fullId)}', '${uniqueId}')"
               title="Click to copy full ${type}: ${escapeHtml(fullId)}"
               id="${uniqueId}">
            <code>${display}</code>
            <span class="copy-icon">📋</span>
            <span class="copy-feedback">✓ Copied!</span>
          </span>`;
}

/**
 * Copy text to clipboard and show feedback
 */
async function copyToClipboard(text, elementId) {
  try {
    await navigator.clipboard.writeText(text);

    // Show success feedback
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.add('copied');
      setTimeout(() => {
        element.classList.remove('copied');
      }, 2000);
    }
  } catch (err) {
    console.error('Failed to copy:', err);
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    const element = document.getElementById(elementId);
    if (element) {
      element.classList.add('copied');
      setTimeout(() => {
        element.classList.remove('copied');
      }, 2000);
    }
  }
}

/**
 * Escape HTML to prevent XSS in title attributes
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Helper: Format timestamp to relative time
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

// Initial load
fetchStats();
