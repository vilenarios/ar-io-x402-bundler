# AR.IO Bundler Administration Guide

Complete guide for deploying, operating, monitoring, and troubleshooting the AR.IO x402 Bundler.

## Table of Contents

- [Deployment](#deployment)
  - [All-Docker Deployment (Recommended)](#all-docker-deployment-recommended)
  - [PM2 Deployment](#pm2-deployment)
  - [Hybrid Deployment](#hybrid-deployment)
- [Configuration](#configuration)
- [AR.IO Gateway Integration](#ario-gateway-integration)
  - [Overview](#overview-1)
  - [Gateway Configuration](#gateway-configuration)
  - [Setting Up Your Gateway](#setting-up-your-gateway)
  - [Monitoring Gateway Integration](#monitoring-gateway-integration)
  - [Troubleshooting Gateway Issues](#troubleshooting-gateway-issues)
- [Monitoring](#monitoring)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)
- [Maintenance](#maintenance)
- [Storage Management](#storage-management)
  - [Understanding Storage Tiers](#understanding-storage-tiers)
  - [Cleanup Configuration](#cleanup-configuration)
  - [Monitoring Storage Usage](#monitoring-storage-usage)
  - [Manual Cleanup Operations](#manual-cleanup-operations)
  - [Troubleshooting Storage Issues](#troubleshooting-storage-issues)
  - [Storage Best Practices](#storage-best-practices)
- [Security](#security)

---

## Deployment

### All-Docker Deployment (Recommended)

**Best for**: Production, staging, and simple setups where you want everything containerized.

#### Quick Start

```bash
# 1. Copy environment template
cp .env.sample .env

# 2. Edit .env and set required variables:
#    - ARWEAVE_WALLET_FILE (absolute path to your wallet.json)
#    - X402_PAYMENT_ADDRESS (your Ethereum address)
#    - ADMIN_PASSWORD (generate with: openssl rand -hex 32)

# 3. Start everything
./start-bundler.sh
```

#### What Gets Deployed

The Docker setup runs these services:

| Service | Port | Description |
|---------|------|-------------|
| `bundler` | 3001 | Main API server (upload endpoint) |
| `workers` | - | BullMQ job workers (all 11 queues) |
| `admin` | 3002 | Admin dashboard + Bull Board |
| `postgres` | 5432 | PostgreSQL database |
| `redis-cache` | 6379 | Redis for caching |
| `redis-queue` | 6381 | Redis for BullMQ job queues |
| `minio` | 9000, 9001 | S3-compatible object storage |

#### Accessing Services

- **Bundler API**: http://localhost:3001
- **Admin Dashboard**: http://localhost:3002/admin/dashboard
- **Queue Monitor**: http://localhost:3002/admin/queues
- **MinIO Console**: http://localhost:9001 (credentials: minioadmin/minioadmin)
- **API Documentation**: http://localhost:3001/swagger

#### Docker Commands

```bash
# View logs
docker-compose logs -f bundler        # API server logs
docker-compose logs -f workers        # Worker logs
docker-compose logs -f admin          # Admin dashboard logs

# Restart a service
docker-compose restart bundler
docker-compose restart workers

# Stop everything (keeps data)
./stop-bundler.sh

# Stop and remove all data (clean slate)
./stop-bundler.sh --clean

# Rebuild after code changes
docker-compose up -d --build

# Access container shell
docker-compose exec bundler sh
docker-compose exec postgres psql -U postgres -d bundler_lite
```

#### Advantages

✅ Single command to start everything
✅ No local Node.js/Yarn installation needed
✅ Consistent environment across dev/staging/prod
✅ Easy scaling and deployment
✅ Automatic health checks and restarts
✅ Isolated network and volumes

---

### PM2 Deployment

**Best for**: Development, debugging, or when you need direct Node.js access.

#### Prerequisites

- Node.js >= 18.0.0
- Yarn >= 1.22.0
- Docker & Docker Compose (for infrastructure)

#### Setup Steps

```bash
# 1. Install dependencies
yarn install

# 2. Configure environment
cp .env.sample .env
# Edit .env with your settings

# 3. Start infrastructure (Docker)
yarn docker:up

# 4. Build TypeScript
yarn build

# 5. Run database migrations
yarn db:migrate

# 6. Start with PM2
pm2 start ecosystem.config.js

# 7. View logs
pm2 logs
pm2 monit
```

#### PM2 Process Management

```bash
# View status
pm2 list
pm2 status

# View logs
pm2 logs upload-api         # API server logs
pm2 logs upload-workers     # Worker logs
pm2 logs bull-board         # Dashboard logs

# Restart services
pm2 restart upload-api
pm2 restart upload-workers
pm2 restart all

# Stop services
pm2 stop upload-api
pm2 stop all

# Auto-restart on server reboot
pm2 startup
pm2 save

# Delete processes
pm2 delete all
```

#### PM2 Services

The `ecosystem.config.js` defines three PM2 processes:

1. **upload-api** (2 cluster instances)
   - HTTP API server
   - Handles upload requests and x402 payments
   - Port: 3001

2. **upload-workers** (1 fork instance)
   - BullMQ job workers
   - Processes all 11 job queues
   - Graceful shutdown with 30s timeout

3. **bull-board** (1 fork instance)
   - Admin dashboard
   - Queue monitoring UI
   - Port: 3002

#### Advantages

✅ Direct access to Node.js processes
✅ Easy debugging with Node.js tools
✅ Hot reload during development
✅ Detailed process monitoring
✅ Lower resource usage (no container overhead)

---

### Hybrid Deployment

**Best for**: Production environments where you want infrastructure in Docker but application running natively.

#### Setup

```bash
# 1. Start infrastructure only
docker-compose up -d postgres redis-cache redis-queue minio

# 2. Configure and build
cp .env.sample .env
# Edit .env with your settings
yarn install
yarn build
yarn db:migrate

# 3. Start application
pm2 start ecosystem.config.js
```

#### Advantages

✅ Managed infrastructure (PostgreSQL, Redis, MinIO)
✅ Native application performance
✅ Easy application debugging
✅ Simpler database backups (Docker volumes)

---

## Configuration

### Critical Environment Variables

#### Arweave Configuration

```bash
# REQUIRED: Absolute path to Arweave wallet (for signing bundles)
ARWEAVE_WALLET_FILE=/absolute/path/to/wallet.json

# Gateway for posting bundles
ARWEAVE_GATEWAY=https://arweave.net

# Gateway advertised to users (shown in /v1/info endpoint)
PUBLIC_ACCESS_GATEWAY=https://arweave.nexus
```

**⚠️ Common Mistake**: `ARWEAVE_WALLET_FILE` must be an **absolute path**, not relative.

#### x402 Payment Configuration

```bash
# REQUIRED: Your Ethereum address to receive USDC payments
X402_PAYMENT_ADDRESS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb

# Coinbase CDP Credentials (REQUIRED for mainnet, optional for testnet)
CDP_API_KEY_ID=your-cdp-key-id
CDP_API_KEY_SECRET=your-cdp-secret

# Multi-Facilitator Configuration (comma-separated lists)
# Base mainnet facilitators (default: Coinbase → Mogami fallback)
X402_FACILITATORS_BASE=https://api.cdp.coinbase.com/platform/v2/x402,https://facilitator.mogami.tech

# Base Sepolia testnet (default: Mogami only)
X402_FACILITATORS_BASE_TESTNET=https://facilitator.mogami.tech

# Optional: Ethereum/Polygon facilitators (no defaults)
# X402_FACILITATORS_ETH=https://facilitator1.com,https://facilitator2.com
# X402_FACILITATORS_POLYGON=https://facilitator1.com,https://facilitator2.com

# Advanced Settings
X402_FRAUD_TOLERANCE_PERCENT=5      # ±5% byte count tolerance
X402_FEE_PERCENT=30                 # 30% bundler fee (profit margin)
X402_PAYMENT_TIMEOUT_MS=300000      # 5 minutes
```

**Multi-Facilitator Fallback**:
The bundler supports automatic fallback between multiple facilitators. Facilitators are tried sequentially in the order specified until one succeeds.

**Networks Supported**:
- **Base Sepolia (testnet)** - Default: Mogami (no CDP needed)
- **Base Mainnet** - Default: Coinbase (primary) → Mogami (fallback)
- **Ethereum Mainnet** - No default (must configure if enabled)
- **Polygon Mainnet** - No default (must configure if enabled)

**Facilitator Configuration Examples**:

```bash
# Use defaults (leave commented or omit)
# X402_FACILITATORS_BASE=

# Custom facilitator list (tries in order)
X402_FACILITATORS_BASE=https://my-facilitator.com,https://backup-facilitator.com,https://third-facilitator.com

# Single facilitator only
X402_FACILITATORS_BASE=https://facilitator.mogami.tech

# Override mainnet defaults
X402_FACILITATORS_BASE=https://api.cdp.coinbase.com/platform/v2/x402,https://facilitator.mogami.tech
```

#### Database Configuration

```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_DATABASE=bundler_lite   # MUST be bundler_lite
```

#### Redis Configuration

```bash
# Redis for caching
ELASTICACHE_HOST=localhost
ELASTICACHE_PORT=6379

# Redis for BullMQ job queues
REDIS_HOST=localhost
REDIS_PORT_QUEUES=6381
```

**Note**: Two separate Redis instances prevent cache eviction from affecting job queue data.

#### Object Storage (MinIO/S3)

```bash
AWS_REGION=us-east-1
AWS_ENDPOINT=http://localhost:9000      # MinIO endpoint
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
DATA_ITEM_BUCKET=bundler-data-items
S3_FORCE_PATH_STYLE=true                # Required for MinIO
```

#### Admin Dashboard

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<generate-with-openssl-rand-hex-32>
BULL_BOARD_PORT=3002
```

#### Performance Tuning

```bash
# Bundle size limits
MAX_BUNDLE_SIZE=2147483648           # 2 GiB target bundle size
MAX_DATA_ITEM_SIZE=4294967296        # 4 GiB max upload size
MAX_DATA_ITEM_LIMIT=10000            # Max items per bundle

# Free upload limit (for testing)
FREE_UPLOAD_LIMIT=517120             # ~505 KiB

# Database migrations
MIGRATE_ON_STARTUP=true              # Auto-run migrations on startup
```

---

## AR.IO Gateway Integration

The bundler integrates with AR.IO gateways using two mechanisms for fast data availability.

### Overview

**Two Integration Methods:**

1. **Optical Bridging** (Data Item Fast Caching)
   - Job: `optical-post` queue
   - Endpoint: `/ar-io/admin/queue-data-item`
   - Posts data item headers immediately after upload
   - Enables sub-second retrieval before bundle confirmation
   - Supports multiple bridges (primary, optional, ArDrive-specific)
   - Filters low-priority AO messages to reduce gateway load

2. **Bundle Priority Queue** (Bundle Fast Indexing)
   - Job: `post-bundle` queue
   - Endpoint: `/ar-io/admin/queue-bundle`
   - Posts bundle transaction ID after bundle posting
   - Accelerates gateway indexing of the bundle
   - Requires `AR_IO_ADMIN_KEY` authentication

**Why Two Methods?**

- **Optical bridging**: Makes individual data items available instantly (before bundling)
- **Bundle queue**: Ensures gateway prioritizes indexing your bundles (after posting to Arweave)

### Gateway Configuration

#### Required Settings

```bash
# Enable optical bridging (enabled by default)
OPTICAL_BRIDGING_ENABLED=true

# Primary optical bridge URL (REQUIRED for optical bridging)
OPTICAL_BRIDGE_URL=http://your-gateway:4000/ar-io/admin/queue-data-item

# Admin key for priority bundle queue (OPTIONAL but recommended)
AR_IO_ADMIN_KEY=your-gateway-admin-key
```

#### Gateway Endpoints

```bash
# Gateway for posting bundles to Arweave
ARWEAVE_GATEWAY=https://arweave.net

# Gateway advertised to users for data retrieval
PUBLIC_ACCESS_GATEWAY=https://your-gateway.example.com

# Upload node for TX chunks (must support /chunk endpoint)
# AR.IO gateways don't support /chunk, so this defaults to arweave.net
ARWEAVE_UPLOAD_NODE=https://arweave.net

# Multiple gateways for data retrieval (comma-separated)
DATA_CACHES=your-gateway.example.com,backup-gateway.example.com
```

#### Advanced Optical Configuration

```bash
# Optional: Additional optical bridges (won't fail job if these fail)
OPTIONAL_OPTICAL_BRIDGE_URLS=https://goldsky-bridge.example.com,https://backup-bridge.example.com

# Optional: ArDrive-specific optical bridges
# Format: url|admin-key-env-name,url2|admin-key-env-name2
ARDRIVE_GATEWAY_OPTICAL_URLS=https://ardrive-gateway.com/bridge|ardrive-key

# Admin keys for ArDrive gateways (referenced by name in ARDRIVE_GATEWAY_OPTICAL_URLS)
ARDRIVE_ADMIN_KEY_ARDRIVE_KEY=your-ardrive-admin-key

# Optional: Canary optical bridge for testing (sample rate: 0.0-1.0)
CANARY_OPTICAL_BRIDGE_URL=https://canary-bridge.example.com
CANARY_OPTICAL_SAMPLE_RATE=0.1  # 10% of uploads sent to canary
```

### Setting Up Your Gateway

#### AR.IO Gateway Prerequisites

Your AR.IO gateway must expose these admin endpoints:

1. **`POST /ar-io/admin/queue-data-item`**
   - Accepts data item headers for fast caching
   - Requires `x-bundlr-public-key` header (optical wallet public key)
   - Optional: `Authorization: Bearer <admin-key>` header

2. **`POST /ar-io/admin/queue-bundle`**
   - Accepts bundle transaction IDs for priority indexing
   - Requires `Authorization: Bearer <admin-key>` header
   - Body: `{ "id": "bundle-tx-id" }`

#### Step-by-Step Setup

**1. Configure Gateway Admin Key**

On your AR.IO gateway, set an admin key for authenticated requests:

```bash
# In your gateway's .env
ADMIN_KEY=your-secure-admin-key
```

**2. Configure Bundler to Use Your Gateway**

```bash
# In bundler's .env
OPTICAL_BRIDGE_URL=http://your-gateway:4000/ar-io/admin/queue-data-item
AR_IO_ADMIN_KEY=your-secure-admin-key
PUBLIC_ACCESS_GATEWAY=https://your-gateway.example.com
```

**3. Verify Optical Wallet**

The bundler uses an "optical wallet" to sign data item headers. This is the same as `ARWEAVE_WALLET_FILE` unless you've configured a separate optical wallet.

**4. Test Optical Bridging**

Upload a test data item and check gateway logs:

```bash
# Upload test file
curl -X POST "http://localhost:3001/v1/tx" \
  -H "Content-Type: application/octet-stream" \
  -H "X-PAYMENT: <payment-header>" \
  --data-binary @test.bin

# Check optical-post queue
# Access Bull Board: http://localhost:3002/admin/queues
# Look for optical-post job completion

# Verify on gateway
curl "https://your-gateway.example.com/<data-item-id>"
```

### Monitoring Gateway Integration

#### Check Optical Bridge Status

**Bull Board** (http://localhost:3002/admin/queues):
- Monitor `optical-post` queue
- Check for failed optical-post jobs
- Review error details in failed jobs

**Database Queries:**

```sql
-- Check recent optical-post job activity (requires BullMQ Redis)
-- This is handled by Bull Board UI

-- Verify data items were uploaded
SELECT id, uploaded_date, byte_count
FROM new_data_item
ORDER BY uploaded_date DESC
LIMIT 10;
```

#### Prometheus Metrics

Access metrics at: http://localhost:3001/bundler_metrics

**Optical-specific metrics:**

```
# Optical bridge circuit breaker status
circuit_breaker_state{source="optical_legacyGateway"} 0  # 0=closed, 1=open
circuit_breaker_state{source="optical_goldsky"} 0
circuit_breaker_state{source="optical_ardriveGateway"} 0

# Optical bridge failures
optical_failure_total{bridge="legacy"} 0
optical_failure_total{bridge="goldsky"} 0
optical_failure_total{bridge="ardrive"} 0
```

#### Log Monitoring

**Docker:**

```bash
# Worker logs contain optical-post activity
docker-compose logs -f workers | grep optical

# Look for:
# - "Posting to optical bridge..."
# - "Successfully posted to primary optical bridge"
# - "Failed to post to optical bridge"
```

**PM2:**

```bash
# Worker logs
pm2 logs upload-workers | grep optical
```

#### Circuit Breaker Behavior

Optical bridges use circuit breakers to prevent cascading failures:

- **Timeout**: 3 seconds (production), 7.7 seconds (local)
- **Error Threshold**: 50% failure rate
- **Reset Timeout**: 30 seconds (breaker opens after threshold, tries again after 30s)

When a circuit breaker opens:
- Requests to that optical bridge are blocked
- Logs show "Optical circuit breaker command timed out"
- Breaker automatically retries after 30 seconds
- Primary bridge failures cause job failure; optional bridges don't

### Troubleshooting Gateway Issues

#### Problem: Optical bridge connection failed

**Symptoms:**

```
Failed to post to optical bridge: ECONNREFUSED
```

**Solutions:**

1. **Verify gateway is running:**

```bash
# Test gateway admin endpoint
curl -X POST "http://your-gateway:4000/ar-io/admin/queue-data-item" \
  -H "Content-Type: application/json" \
  -d '[]'

# Should return 200 or 401 (not connection refused)
```

2. **Check OPTICAL_BRIDGE_URL:**

```bash
# Verify URL format
grep OPTICAL_BRIDGE_URL .env

# Should be: http://hostname:port/ar-io/admin/queue-data-item
```

3. **Check network connectivity:**

```bash
# From bundler to gateway
docker-compose exec bundler ping your-gateway-host
docker-compose exec bundler curl http://your-gateway:4000/ar-io/health
```

#### Problem: Optical bridge authentication failed

**Symptoms:**

```
Failed to post to optical bridge: 401 Unauthorized
```

**Solutions:**

1. **Verify AR_IO_ADMIN_KEY matches gateway:**

```bash
# Bundler .env
grep AR_IO_ADMIN_KEY .env

# Gateway .env (on gateway server)
grep ADMIN_KEY /path/to/gateway/.env
```

2. **Check headers are sent:**

```bash
# Enable debug logging
LOG_LEVEL=debug docker-compose restart workers

# Check logs for Authorization header
docker-compose logs workers | grep Authorization
```

#### Problem: Circuit breaker opened (optical bridge timing out)

**Symptoms:**

```
Optical circuit breaker command timed out
circuit_breaker_state{source="optical_legacyGateway"} 1
```

**Solutions:**

1. **Check gateway performance:**

```bash
# Test gateway response time
time curl -X POST "http://your-gateway:4000/ar-io/admin/queue-data-item" \
  -H "Content-Type: application/json" \
  -d '[]'

# Should complete in < 3 seconds
```

2. **Increase timeout (if needed):**

Edit `src/jobs/optical-post.ts` and rebuild:

```typescript
timeout: process.env.NODE_ENV === "local" ? 7777 : 5000,  // Increase from 3000
```

3. **Wait for circuit breaker reset:**

The circuit breaker automatically resets after 30 seconds. Check metrics:

```bash
# Monitor breaker state
watch -n 1 'curl -s http://localhost:3001/bundler_metrics | grep circuit_breaker_state'
```

#### Problem: Data items not appearing on gateway

**Symptoms:**

- Optical-post jobs succeed
- Data items not retrievable from gateway

**Solutions:**

1. **Verify gateway received the data item header:**

Check gateway logs for data item ID

2. **Check optical wallet public key:**

```bash
# The bundler sends x-bundlr-public-key header
# Verify it matches your wallet

# Get wallet address
docker-compose exec bundler node -e "
const Arweave = require('arweave');
const jwk = require('$ARWEAVE_WALLET_FILE');
const arweave = Arweave.init({});
arweave.wallets.jwkToAddress(jwk).then(console.log);
"
```

3. **Verify optical bridging is enabled:**

```bash
grep OPTICAL_BRIDGING_ENABLED .env
# Should be: OPTICAL_BRIDGING_ENABLED=true
```

4. **Check if AO message filtering is removing your items:**

Low-priority AO messages are filtered out. Check logs:

```bash
docker-compose logs workers | grep "filtered out"
```

#### Problem: High optical bridge failure rate

**Symptoms:**

```
optical_failure_total{bridge="legacy"} 1523
```

**Solutions:**

1. **Check gateway health:**

```bash
# Gateway should be healthy
curl http://your-gateway:4000/ar-io/health
```

2. **Review failed jobs in Bull Board:**

http://localhost:3002/admin/queues → optical-post → Failed Jobs

3. **Consider using optional bridges as fallback:**

```bash
# Add backup optical bridge (won't fail jobs)
OPTIONAL_OPTICAL_BRIDGE_URLS=https://backup-gateway.example.com/bridge
```

4. **Temporarily disable optical bridging if critical:**

```bash
# Disable optical bridging (data items will still be bundled normally)
OPTICAL_BRIDGING_ENABLED=false
docker-compose restart bundler workers
```

#### Problem: ArDrive-specific optical routing not working

**Symptoms:**

ArDrive uploads not appearing on ArDrive gateway

**Solutions:**

1. **Verify ArDrive gateway configuration:**

```bash
grep ARDRIVE_GATEWAY_OPTICAL_URLS .env
# Format: https://gateway.com/bridge|admin-key-name

grep ARDRIVE_ADMIN_KEY_ .env
# Should have key matching the name in ARDRIVE_GATEWAY_OPTICAL_URLS
```

2. **Check if uploads have ArDrive tags:**

ArDrive-specific routing requires `App-Name` tag starting with "ArDrive":

```sql
-- Check for ArDrive tags in recent uploads
-- (This requires inspecting the actual data item tags)
```

3. **Check logs for ArDrive optical posts:**

```bash
docker-compose logs workers | grep "ardrive gateway optical"
```

---

## Monitoring

### Admin Dashboard

Access the admin dashboard at: http://localhost:3002/admin/dashboard

**Features**:
- Real-time upload statistics
- x402 payment metrics by network
- Bundle posting statistics
- System health indicators
- 30-second auto-refresh with caching

**Authentication**: Basic Auth using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`

### Queue Monitoring (Bull Board)

Access Bull Board at: http://localhost:3002/admin/queues

**Monitor**:
- All 11 job queues (new-data-item, plan-bundle, prepare-bundle, etc.)
- Job status: waiting, active, completed, failed
- Job details and error logs
- Manual job retry and cleanup
- Pause/resume queues

**Queue Health Indicators**:
- ✅ **Waiting**: Jobs queued for processing (normal)
- 🔄 **Active**: Jobs currently being processed
- ✅ **Completed**: Successfully processed jobs
- ❌ **Failed**: Jobs that encountered errors (investigate and retry)

### Database Queries

```sql
-- Check recent uploads
SELECT id, owner_public_address, byte_count, uploaded_date, deadline_height
FROM new_data_item
ORDER BY uploaded_date DESC
LIMIT 10;

-- Check x402 payments
SELECT
  payment_id,
  upload_id,
  network,
  payment_amount,
  declared_byte_count,
  actual_byte_count,
  fraud_detected,
  created_at
FROM x402_payments
ORDER BY created_at DESC
LIMIT 10;

-- Check bundle status
SELECT
  bundle_id,
  planned_date,
  posted_date,
  data_item_count,
  byte_count
FROM posted_bundle
ORDER BY posted_date DESC
LIMIT 5;

-- Find failed payments (fraud detected)
SELECT * FROM x402_payments
WHERE fraud_detected = true
ORDER BY created_at DESC;

-- Check data item status
SELECT status, COUNT(*) as count
FROM (
  SELECT 'new' as status FROM new_data_item
  UNION ALL
  SELECT 'planned' FROM planned_data_item
  UNION ALL
  SELECT 'permanent' FROM permanent_data_item
) AS all_items
GROUP BY status;
```

### Metrics Endpoint

Prometheus metrics available at: http://localhost:3001/bundler_metrics

**Key Metrics**:
- Upload counts and byte volumes
- x402 payment statistics
- Bundle posting rates
- Job queue metrics
- HTTP request latencies

### Health Check

Simple health check endpoint: http://localhost:3001/health

Returns `200 OK` if the service is running.

### Log Locations

**Docker Deployment**:
```bash
docker-compose logs -f bundler        # API logs
docker-compose logs -f workers        # Worker logs
docker-compose logs -f admin          # Dashboard logs
```

**PM2 Deployment**:
```bash
pm2 logs upload-api                   # API logs
pm2 logs upload-workers               # Worker logs
pm2 logs bull-board                   # Dashboard logs

# Log files
./logs/upload-api-out.log
./logs/upload-api-error.log
./logs/upload-workers-out.log
./logs/upload-workers-error.log
./logs/bull-board-out.log
./logs/bull-board-error.log
```

---

## Operations

### Starting and Stopping

#### Docker Deployment

```bash
# Start all services
./start-bundler.sh

# Stop services (keep data)
./stop-bundler.sh

# Stop and remove all data
./stop-bundler.sh --clean

# Restart specific service
docker-compose restart bundler
docker-compose restart workers
```

#### PM2 Deployment

```bash
# Start all services
pm2 start ecosystem.config.js

# Stop all services
pm2 stop all

# Restart all services
pm2 restart all

# Delete all processes
pm2 delete all
```

### Database Operations

#### Running Migrations

```bash
# PM2/Local deployment
yarn db:migrate

# Docker deployment
docker-compose exec bundler yarn db:migrate
```

#### Rolling Back Migrations

```bash
# Rollback last migration
yarn db:migrate:rollback

# Docker
docker-compose exec bundler yarn db:migrate:rollback
```

#### Creating New Migrations

```bash
# Create new migration file
yarn db:migrate:new add_new_feature

# Edit the generated file in src/migrations/
# Build and run
yarn build && yarn db:migrate
```

#### Database Backup

```bash
# Backup database
docker-compose exec postgres pg_dump -U postgres bundler_lite > backup.sql

# Restore database
docker-compose exec -T postgres psql -U postgres bundler_lite < backup.sql
```

### Scaling

#### Scaling Workers (Docker)

Edit `docker-compose.yml`:

```yaml
services:
  workers:
    deploy:
      replicas: 3  # Run 3 worker instances
```

Then restart:

```bash
docker-compose up -d --scale workers=3
```

#### Scaling API (PM2)

Edit `ecosystem.config.js`:

```javascript
{
  name: 'upload-api',
  instances: 4,  // Increase from 2 to 4
  exec_mode: 'cluster',
  // ...
}
```

Then restart:

```bash
pm2 restart upload-api
```

### Updating the Application

#### Docker Deployment

```bash
# 1. Pull latest code
git pull

# 2. Rebuild and restart
docker-compose up -d --build

# 3. Run migrations (if needed)
docker-compose exec bundler yarn db:migrate
```

#### PM2 Deployment

```bash
# 1. Pull latest code
git pull

# 2. Install dependencies
yarn install

# 3. Build
yarn build

# 4. Run migrations
yarn db:migrate

# 5. Restart PM2 processes
pm2 restart all
```

---

## Troubleshooting

### Build and Configuration Issues

#### Problem: `Cannot find module '@dha-team/arbundles'`

**Solution**: Clean install dependencies

```bash
rm -rf node_modules yarn.lock
yarn install
```

#### Problem: `ENOENT: no such file or directory, open './wallet.json'`

**Solution**: Use absolute path for wallet

```bash
# ❌ WRONG (relative path)
ARWEAVE_WALLET_FILE=./wallet.json

# ✅ CORRECT (absolute path)
ARWEAVE_WALLET_FILE=/home/user/ar-io-x402-bundler/wallet.json
```

#### Problem: `error TS2307: Cannot find module`

**Solution**: Rebuild TypeScript

```bash
yarn clean
yarn build
```

### Database Issues

#### Problem: `relation "new_data_item" does not exist`

**Solution**: Run migrations

```bash
# Ensure PostgreSQL is running
docker-compose up -d postgres

# Run migrations
yarn db:migrate
```

#### Problem: `ECONNREFUSED connecting to PostgreSQL`

**Solution**: Check database connection

```bash
# Verify PostgreSQL is running
docker-compose ps postgres

# Check connection manually
docker-compose exec postgres psql -U postgres -d bundler_lite

# Verify .env settings
grep DB_ .env
```

#### Problem: `database "bundler_lite" does not exist`

**Solution**: Create database

```bash
docker-compose exec postgres psql -U postgres -c "CREATE DATABASE bundler_lite;"
yarn db:migrate
```

### x402 Payment Issues

#### Problem: `Invalid EIP-712 signature`

**Solution**: Verify signature parameters match exactly

The EIP-712 domain must match the USDC contract:

```javascript
const domain = {
  name: "USD Coin",               // MUST match
  version: "2",                   // MUST match
  chainId: 84532,                 // MUST match network
  verifyingContract: "0x036..."   // MUST match USDC contract
};
```

#### Problem: `Facilitator verification failed`

**Solution**: Check facilitator configuration

```bash
# Testnet (Base Sepolia) - works without CDP credentials
X402_FACILITATOR_URL_BASE_TESTNET=https://x402.org/facilitator
X402_BASE_TESTNET_ENABLED=true

# Mainnet - requires CDP credentials
X402_FACILITATOR_URL_BASE=https://facilitator.base.coinbasecloud.net
X402_BASE_ENABLED=true
CDP_API_KEY_ID=your-key-id
CDP_API_KEY_SECRET=your-secret
```

#### Problem: `Fraud penalty - byte count mismatch`

**Solution**: Ensure Content-Length matches actual data size

```bash
# Content-Length MUST match actual data size (±5% tolerance)
curl -X POST "http://localhost:3001/v1/tx" \
  -H "Content-Length: $(wc -c < myfile.bin)" \
  --data-binary @myfile.bin
```

**Check fraud detection**:

```sql
SELECT
  payment_id,
  declared_byte_count,
  actual_byte_count,
  fraud_detected,
  (actual_byte_count - declared_byte_count) * 100.0 / declared_byte_count as percent_diff
FROM x402_payments
WHERE fraud_detected = true;
```

### Redis Issues

#### Problem: `ECONNREFUSED connecting to Redis`

**Solution**: Verify both Redis instances are running

```bash
# Check Redis containers
docker-compose ps redis-cache redis-queue

# Verify ports
netstat -tlnp | grep 6379   # Cache Redis
netstat -tlnp | grep 6381   # Queue Redis

# Test connections
redis-cli -h localhost -p 6379 ping   # Should return PONG
redis-cli -h localhost -p 6381 ping   # Should return PONG
```

### MinIO/S3 Issues

#### Problem: `S3 connection refused`

**Solution**: Verify MinIO is running

```bash
# Check MinIO container
docker-compose ps minio

# Test MinIO health
curl http://localhost:9000/minio/health/live

# Restart MinIO
docker-compose restart minio
```

#### Problem: `Bucket does not exist`

**Solution**: Create buckets

```bash
# Access MinIO console: http://localhost:9001
# Login: minioadmin/minioadmin
# Create buckets: bundler-data-items, backup-data-items

# Or use minio client (mc)
docker-compose exec minio mc mb local/bundler-data-items
docker-compose exec minio mc mb local/backup-data-items
```

### Worker/Job Queue Issues

#### Problem: Jobs stuck in "waiting" status

**Solution**: Check worker processes

```bash
# Docker
docker-compose logs -f workers
docker-compose restart workers

# PM2
pm2 logs upload-workers
pm2 restart upload-workers
```

#### Problem: Jobs failing repeatedly

**Solution**: Investigate job errors in Bull Board

1. Access Bull Board: http://localhost:3002/admin/queues
2. Find the failing queue
3. Click on failed jobs
4. Review error details and stack traces
5. Retry manually after fixing the issue

**Common job failures**:
- **new-data-item**: S3 connection issues, invalid data items
- **prepare-bundle**: S3 download failures, insufficient disk space
- **post-bundle**: Arweave node connectivity, insufficient AR balance
- **verify-bundle**: Network issues, bundle not found on chain

### Port Conflicts

#### Problem: `EADDRINUSE: address already in use :::3001`

**Solution**: Change port or kill existing process

```bash
# Option 1: Change port
PORT=3002 yarn start

# Option 2: Kill existing process
lsof -ti:3001 | xargs kill -9

# Option 3: Find what's using the port
sudo netstat -tlnp | grep 3001
```

### Docker Issues

#### Problem: `port is already allocated`

**Solution**: Stop conflicting containers

```bash
# List all containers using the port
docker ps -a | grep 3001

# Stop conflicting containers
docker stop <container-id>

# Or change port in docker-compose.yml
```

#### Problem: `no space left on device`

**Solution**: Clean up Docker resources

```bash
# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Clean up everything
docker system prune -a --volumes
```

#### Problem: Database volume corruption

**Solution**: Recreate volumes

```bash
# ⚠️ WARNING: This deletes all data!
./stop-bundler.sh --clean

# Or manually
docker-compose down -v
docker-compose up -d
```

### Performance Issues

#### Problem: Slow bundle processing

**Symptoms**: Long queue wait times, bundles not posting

**Solutions**:

1. **Increase worker concurrency**:
   Edit `src/jobs/allWorkers.ts` and increase concurrency values

2. **Scale workers**:
   ```bash
   # Docker
   docker-compose up -d --scale workers=3

   # PM2
   pm2 scale upload-workers +2
   ```

3. **Check Arweave node connectivity**:
   ```bash
   curl https://arweave.net/info
   ```

4. **Monitor database performance**:
   ```sql
   -- Check slow queries
   SELECT query, mean_exec_time, calls
   FROM pg_stat_statements
   ORDER BY mean_exec_time DESC
   LIMIT 10;
   ```

#### Problem: High memory usage

**Solution**: Adjust Node.js memory limits

```bash
# Docker: Edit docker-compose.yml
services:
  bundler:
    environment:
      NODE_OPTIONS: "--max-old-space-size=4096"  # 4GB

# PM2: Edit ecosystem.config.js
{
  name: 'upload-api',
  node_args: '--max-old-space-size=4096',
  // ...
}
```

---

## Maintenance

### Regular Maintenance Tasks

#### Daily

- Check admin dashboard for anomalies
- Review failed jobs in Bull Board
- Monitor disk space usage

```bash
# Check disk space
df -h

# Check Docker volumes
docker system df
```

#### Weekly

- Review x402 payment fraud detection logs
- Clean up old completed jobs
- Check database size and performance

```sql
-- Database size
SELECT pg_size_pretty(pg_database_size('bundler_lite'));

-- Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Monthly

- Backup database
- Review and archive old logs
- Update dependencies (security patches)

```bash
# Backup database
docker-compose exec postgres pg_dump -U postgres bundler_lite > backup-$(date +%Y%m%d).sql

# Check for outdated packages
yarn outdated
```

### Log Rotation

**Docker**: Docker handles log rotation automatically.

**PM2**: Configure in `ecosystem.config.js`:

```javascript
{
  name: 'upload-api',
  max_memory_restart: '1G',
  error_file: './logs/upload-api-error.log',
  out_file: './logs/upload-api-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  merge_logs: true,
  // PM2 log rotation
  log_type: 'json',
  // ...
}
```

Or use `pm2-logrotate`:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7
```

### Upgrading PostgreSQL

```bash
# 1. Backup current database
docker-compose exec postgres pg_dump -U postgres bundler_lite > backup-before-upgrade.sql

# 2. Stop services
./stop-bundler.sh

# 3. Update docker-compose.yml
# Change postgres version

# 4. Start with new version
./start-bundler.sh

# 5. Verify database
docker-compose exec postgres psql -U postgres -d bundler_lite -c "SELECT version();"
```

---

## Storage Management

### Understanding Storage Tiers

The bundler uses a **tiered storage architecture** to balance performance, cost, and data safety:

```
Upload → [Redis Cache + Filesystem + MinIO] → Bundling → Arweave
              ↓                ↓                            ↓
         (ephemeral)      (7 days)      (90 days)    (permanent)
```

#### Storage Tier Breakdown

| Tier | Purpose | Retention | Cleanup |
|------|---------|-----------|---------|
| **Redis Cache** | Hot cache for active uploads | Ephemeral (memory only) | Automatic eviction |
| **Filesystem** | Hot cache for bundling performance | 7 days (default) | Automatic cleanup job |
| **MinIO (S3)** | Cold storage for disaster recovery | 90 days (default) | Automatic cleanup job |
| **Arweave** | Permanent decentralized storage | Forever | None (immutable) |

#### Why This Architecture?

1. **Filesystem (7 days)**:
   - Fast bundling: Workers read from local disk instead of network
   - Performance: Assembling large bundles is disk I/O intensive
   - Temporary: After bundling, data is in MinIO + Arweave

2. **MinIO (90 days)**:
   - Disaster recovery: If Arweave posting fails, re-bundle from MinIO
   - Re-bundling: Can rebuild bundles without re-uploading
   - Network-accessible: Multiple workers can access same data
   - After 90 days: Data is confirmed on Arweave, MinIO copy not needed

3. **Arweave (permanent)**:
   - Immutable permanent storage
   - Decentralized availability
   - Final source of truth

### Cleanup Configuration

#### Environment Variables

```bash
# Filesystem cleanup (hot cache)
FILESYSTEM_CLEANUP_DAYS=7       # Keep for 7 days after upload

# MinIO cleanup (cold storage)
MINIO_CLEANUP_DAYS=90           # Keep for 90 days after upload

# Cleanup schedule (cron format)
CLEANUP_CRON=0 2 * * *          # Daily at 2 AM UTC
```

#### Cron Schedule Examples

```bash
# Every 6 hours
CLEANUP_CRON=0 */6 * * *

# Weekly on Sunday at 3 AM
CLEANUP_CRON=0 3 * * 0

# Monthly on the 1st at 1 AM
CLEANUP_CRON=0 1 1 * *

# Twice daily (2 AM and 2 PM)
CLEANUP_CRON=0 2,14 * * *
```

#### How Cleanup Works

The cleanup system uses BullMQ's repeatable jobs:

1. **Automatic Scheduling**: When workers start, cleanup job is scheduled with configured cron pattern
2. **Batch Processing**: Processes data items in batches of 500
3. **Tiered Deletion**:
   - Items older than `FILESYSTEM_CLEANUP_DAYS` → delete from filesystem
   - Items older than `MINIO_CLEANUP_DAYS` → delete from MinIO
   - Items on Arweave → never deleted (permanent)
4. **Error Handling**: Gracefully handles missing files (already cleaned or deleted)
5. **Progress Tracking**: Uses database cursor to resume from last position

### Monitoring Storage Usage

#### Check Disk Space

```bash
# Overall disk usage
df -h

# Docker volumes
docker system df -v

# Specific directories
du -sh /path/to/bundler/temp
du -sh /path/to/bundler/upload-service-data

# Inside Docker
docker-compose exec bundler df -h
docker-compose exec bundler du -sh /app/temp /app/upload-service-data
```

#### Check MinIO Storage

**Via MinIO Console**: http://localhost:9001

**Via CLI**:

```bash
# List buckets and sizes
docker-compose exec minio mc du local/bundler-data-items

# Count objects in bucket
docker-compose exec minio mc ls --recursive local/bundler-data-items | wc -l
```

#### Check Database Storage

```sql
-- Total data items by status
SELECT
  'filesystem' as tier,
  COUNT(*) as count,
  SUM(byte_count) as total_bytes,
  pg_size_pretty(SUM(byte_count)::bigint) as total_size
FROM permanent_data_item
WHERE uploaded_date > NOW() - INTERVAL '7 days';

-- MinIO data (uploaded within 90 days)
SELECT
  'minio' as tier,
  COUNT(*) as count,
  SUM(byte_count) as total_bytes,
  pg_size_pretty(SUM(byte_count)::bigint) as total_size
FROM permanent_data_item
WHERE uploaded_date > NOW() - INTERVAL '90 days';

-- Arweave (all permanent data)
SELECT
  'arweave' as tier,
  COUNT(*) as count,
  SUM(byte_count) as total_bytes,
  pg_size_pretty(SUM(byte_count)::bigint) as total_size
FROM permanent_data_item;
```

### Manual Cleanup Operations

#### Trigger Cleanup Manually

```bash
# Using trigger script
node scripts/trigger-cleanup.js

# Docker
docker-compose exec bundler node scripts/trigger-cleanup.js

# Check cleanup job in Bull Board
# http://localhost:3002/admin/queues → cleanup-fs queue
```

#### Monitor Cleanup Progress

```bash
# Watch cleanup job logs
docker-compose logs -f workers | grep cleanup

# PM2
pm2 logs upload-workers | grep cleanup

# Expected log output:
# "Cleanup job started"
# "Progress: filesystemDeletedCount=152, minioDeletedCount=43"
# "✅ Cleanup complete!"
```

#### Clean Specific Data Manually

**Emergency cleanup (if automation fails)**:

```bash
# Clean old filesystem files (7+ days old)
find /path/to/bundler/temp -type f -mtime +7 -delete
find /path/to/bundler/upload-service-data -type f -mtime +7 -delete

# Docker
docker-compose exec bundler find /app/temp -type f -mtime +7 -delete
docker-compose exec bundler find /app/upload-service-data -type f -mtime +7 -delete
```

**⚠️ Warning**: Manual deletion bypasses tracking. Use only in emergencies.

### Cleanup Job Monitoring

#### Check Cleanup Schedule

```bash
# View cleanup job in Bull Board
# http://localhost:3002/admin/queues → cleanup-fs

# Check next scheduled run
# Bull Board shows "Next job at: 2025-01-19 02:00:00 UTC"
```

#### Cleanup Job Metrics

Check Prometheus metrics at http://localhost:3001/bundler_metrics:

```bash
# Cleanup job executions
cleanup_job_total 47

# Cleanup errors
cleanup_job_errors_total 0

# Items cleaned by tier
cleanup_filesystem_deleted_total 15234
cleanup_minio_deleted_total 4521
```

#### Review Cleanup History

```sql
-- Check cleanup cursor (last cleaned item)
SELECT * FROM config WHERE key = 'fs-cleanup-last-deleted-cursor';

-- Example output:
-- {"uploadedAt": "2025-01-12T14:23:45", "dataItemId": "abc123..."}
```

### Troubleshooting Storage Issues

#### Problem: Disk space running out

**Symptoms**:

```
Error: ENOSPC: no space left on device
docker: Error response from daemon: no space left on device
```

**Solutions**:

1. **Check cleanup is running**:

```bash
# Verify cleanup job scheduled
# http://localhost:3002/admin/queues → cleanup-fs

# Check recent cleanup jobs
docker-compose logs workers | grep cleanup | tail -20
```

2. **Trigger immediate cleanup**:

```bash
# Run cleanup now (don't wait for schedule)
node scripts/trigger-cleanup.js

# Watch progress
docker-compose logs -f workers | grep cleanup
```

3. **Reduce retention periods temporarily**:

```bash
# Edit .env
FILESYSTEM_CLEANUP_DAYS=3  # Reduce from 7 to 3 days
MINIO_CLEANUP_DAYS=30      # Reduce from 90 to 30 days

# Restart workers to pick up new config
docker-compose restart workers

# Trigger cleanup
node scripts/trigger-cleanup.js
```

4. **Clean Docker resources**:

```bash
# Remove unused Docker images and volumes
docker system prune -a --volumes

# Check space saved
df -h
```

#### Problem: Cleanup job failing

**Symptoms**:

```
Bull Board shows cleanup-fs jobs in "Failed" status
Logs show "Error during cleanup processing"
```

**Solutions**:

1. **Check error details**:

Go to Bull Board → cleanup-fs queue → Failed Jobs → View error stack trace

2. **Common failures**:

**MinIO connection errors**:

```bash
# Verify MinIO is running
docker-compose ps minio
curl http://localhost:9000/minio/health/live

# Restart MinIO
docker-compose restart minio
```

**Database connection errors**:

```bash
# Check PostgreSQL
docker-compose exec postgres psql -U postgres -d bundler_lite -c "SELECT 1;"

# Restart if needed
docker-compose restart postgres
```

**Permission errors**:

```bash
# Check file permissions
docker-compose exec bundler ls -la /app/temp
docker-compose exec bundler ls -la /app/upload-service-data

# Fix if needed (run as root)
docker-compose exec --user root bundler chown -R node:node /app/temp /app/upload-service-data
```

3. **Retry failed jobs**:

In Bull Board, click "Retry" on failed cleanup jobs

4. **Reset cleanup cursor** (last resort):

```sql
-- Reset to start from beginning
DELETE FROM config WHERE key = 'fs-cleanup-last-deleted-cursor';

-- Trigger cleanup again
-- node scripts/trigger-cleanup.js
```

#### Problem: MinIO storage not being cleaned

**Symptoms**:

```
MinIO bucket size keeps growing
Filesystem is cleaned but MinIO is not
```

**Solutions**:

1. **Verify MINIO_CLEANUP_DAYS is set**:

```bash
grep MINIO_CLEANUP_DAYS .env

# Should be: MINIO_CLEANUP_DAYS=90 (or your preferred retention)
```

2. **Check cleanup logs for MinIO deletions**:

```bash
docker-compose logs workers | grep "Deleted MinIO"

# Expected output:
# "Deleted MinIO: raw-data-item/abc123..."
# "minioDeletedCount: 45"
```

3. **Verify data items are old enough**:

```sql
-- Count items eligible for MinIO cleanup (90+ days old)
SELECT COUNT(*)
FROM permanent_data_item
WHERE uploaded_date < NOW() - INTERVAL '90 days';
```

If count is 0, no items are old enough yet. Wait or reduce retention period.

4. **Test MinIO deletion manually**:

```bash
# List objects in MinIO
docker-compose exec minio mc ls local/bundler-data-items/raw-data-item/ | head

# Try deleting one object manually
docker-compose exec minio mc rm local/bundler-data-items/raw-data-item/test123

# If this fails, check MinIO credentials in .env
```

#### Problem: Cleanup running too frequently/infrequently

**Solution**: Adjust cleanup schedule

```bash
# Edit .env
CLEANUP_CRON=0 */12 * * *  # Every 12 hours instead of daily

# Restart workers
docker-compose restart workers

# Verify new schedule in Bull Board
# http://localhost:3002/admin/queues → cleanup-fs → Repeatable Jobs
```

### Storage Best Practices

#### 1. Monitor Disk Usage

Set up alerts for disk usage:

```bash
# Cron job to check disk usage daily
0 8 * * * df -h | grep -E "9[0-9]%|100%" && echo "ALERT: Disk usage high" | mail -s "Bundler Disk Alert" admin@example.com
```

#### 2. Regular Cleanup Verification

Weekly task: Check cleanup is working

```bash
# 1. Check Bull Board for successful cleanup jobs
# http://localhost:3002/admin/queues → cleanup-fs → Completed

# 2. Verify old files are being deleted
docker-compose exec bundler find /app/temp -type f -mtime +7 | head
# Should return 0 or very few files

# 3. Check MinIO object count trend
docker-compose exec minio mc ls --recursive local/bundler-data-items | wc -l
```

#### 3. Backup Before Major Changes

Before changing retention policies:

```bash
# 1. Backup database
docker-compose exec postgres pg_dump -U postgres bundler_lite > backup-before-retention-change.sql

# 2. Note current storage sizes
docker system df -v > storage-snapshot.txt
docker-compose exec minio mc du local/bundler-data-items > minio-snapshot.txt

# 3. Make changes gradually
# Start with small reduction, verify cleanup works, then reduce further
```

#### 4. Test Disaster Recovery

Quarterly: Verify you can re-bundle from MinIO

```bash
# 1. Pick a recent bundle from database
# 2. Verify data items still in MinIO
# 3. Simulate re-bundling process
# 4. Confirm bundle can be reconstructed
```

#### 5. Right-Size Retention Periods

**Conservative** (safer, more storage):
```bash
FILESYSTEM_CLEANUP_DAYS=14
MINIO_CLEANUP_DAYS=180
```

**Aggressive** (less storage, higher risk):
```bash
FILESYSTEM_CLEANUP_DAYS=3
MINIO_CLEANUP_DAYS=30
```

**Recommended** (balanced):
```bash
FILESYSTEM_CLEANUP_DAYS=7   # 1 week filesystem cache
MINIO_CLEANUP_DAYS=90       # 3 months disaster recovery
```

Choose based on:
- Available disk space
- Bundle posting frequency
- Re-bundling likelihood
- Disaster recovery requirements

---

## Security

### Securing the Admin Dashboard

```bash
# Generate strong password
ADMIN_PASSWORD=$(openssl rand -hex 32)

# Add to .env
echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> .env

# Restart admin service
docker-compose restart admin
```

### Firewall Configuration

**Recommended firewall rules**:

```bash
# Allow bundler API (from internet)
sudo ufw allow 3001/tcp

# Allow admin dashboard (from trusted IPs only)
sudo ufw allow from 192.168.1.0/24 to any port 3002

# Allow MinIO console (from trusted IPs only)
sudo ufw allow from 192.168.1.0/24 to any port 9001

# Deny direct PostgreSQL access (local only)
sudo ufw deny 5432/tcp
```

### Wallet Security

**Best practices**:

1. **Use a dedicated bundler wallet** - Don't reuse wallets from other services
2. **Store wallet securely** - Encrypt at rest, limit file permissions
3. **Regular balance monitoring** - Ensure sufficient AR for bundle posting
4. **Backup wallet** - Keep encrypted backups in multiple locations

```bash
# Set proper permissions on wallet file
chmod 600 /path/to/wallet.json
chown bundler:bundler /path/to/wallet.json
```

### HTTPS/TLS

**For production, use a reverse proxy**:

```nginx
# nginx configuration
server {
    listen 443 ssl http2;
    server_name bundler.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Admin dashboard (restricted access)
server {
    listen 443 ssl http2;
    server_name admin.bundler.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # IP whitelist
    allow 192.168.1.0/24;
    deny all;

    location / {
        proxy_pass http://localhost:3002;
        # ... proxy settings ...
    }
}
```

### Rate Limiting

The bundler includes built-in rate limiting. Configure in `.env`:

```bash
# Rate limiting (requests per minute per IP)
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
```

### Monitoring for Security Issues

```bash
# Check for unauthorized payment addresses
echo "Verify X402_PAYMENT_ADDRESS matches your wallet:"
grep X402_PAYMENT_ADDRESS .env

# Review recent payments for anomalies
docker-compose exec postgres psql -U postgres -d bundler_lite -c \
  "SELECT payment_id, network, payment_amount, created_at
   FROM x402_payments
   ORDER BY created_at DESC
   LIMIT 20;"

# Check for unusual upload patterns
docker-compose exec postgres psql -U postgres -d bundler_lite -c \
  "SELECT owner_public_address, COUNT(*), SUM(byte_count)
   FROM new_data_item
   WHERE uploaded_date > NOW() - INTERVAL '24 hours'
   GROUP BY owner_public_address
   ORDER BY COUNT(*) DESC
   LIMIT 10;"
```

---

## Support and Resources

### Getting Help

- **GitHub Issues**: https://github.com/ar-io/ar-io-x402-bundler/issues
- **Discord**: https://discord.gg/ario
- **Documentation**: https://docs.ar.io

### Useful Links

- **AR.IO Network**: https://ar.io
- **Arweave**: https://arweave.org
- **x402 Protocol**: https://x402.org
- **Coinbase CDP**: https://portal.cdp.coinbase.com/

### Quick Reference Commands

```bash
# Docker deployment
./start-bundler.sh                    # Start all services
./stop-bundler.sh                     # Stop services
docker-compose logs -f bundler        # View logs
docker-compose restart bundler        # Restart API

# PM2 deployment
pm2 start ecosystem.config.js         # Start all
pm2 logs                              # View logs
pm2 restart all                       # Restart all
pm2 monit                             # Monitor

# Database
yarn db:migrate                       # Run migrations
docker-compose exec postgres psql -U postgres -d bundler_lite

# Monitoring
http://localhost:3002/admin/dashboard # Admin dashboard
http://localhost:3002/admin/queues    # Queue monitor
http://localhost:3001/bundler_metrics # Prometheus metrics

# Troubleshooting
docker-compose down -v                # Clean restart
pm2 delete all && pm2 start ecosystem.config.js
yarn clean && yarn build              # Rebuild
```

---

**Last Updated**: 2025-01-18
