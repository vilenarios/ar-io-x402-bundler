# AR.IO Bundler Lite

**Lightweight Arweave ANS-104 bundler with x402 USDC payments - designed for AI agents and stateless applications.**

Perfect for **AI agents**, **CLI tools**, **stateless clients**, and **developers** who want programmable Arweave uploads without managing user accounts.

## 🌟 Features

- **✅ x402 USDC Payments** - Pay with USDC using Coinbase's x402 HTTP 402 standard (EIP-3009)
- **✅ Stateless Operation** - No account creation required for x402 payments
- **✅ ANS-104 Bundling** - Efficient data item bundling for Arweave
- **✅ Multi-Signature Support** - Arweave, Ethereum, Solana wallets
- **✅ Fraud Detection** - Automatic byte-count verification with ±5% tolerance
- **✅ Job Queue System** - BullMQ-powered async bundling pipeline
- **✅ S3-Compatible Storage** - MinIO or AWS S3 for data item storage
- **✅ PostgreSQL Database** - Reliable payment and bundle tracking
- **✅ Docker Support** - Complete infrastructure in docker-compose
- **✅ Production Ready** - Built on AR.IO's battle-tested bundler architecture

---

## 🚀 Quick Start

### Prerequisites

- **Docker** & **Docker Compose** (recommended)
- **Arweave Wallet** (JWK file for bundle signing)
- **EVM Address** (for receiving USDC payments)

*Alternative: Node.js >= 18.0.0 + Yarn >= 1.22.0 for PM2 deployment*

### Option 1: All-Docker (Simplest - Recommended)

**Get running in 3 commands:**

\`\`\`bash
# 1. Configure
cp .env.sample .env
# Edit .env: set ARWEAVE_WALLET_FILE and X402_PAYMENT_ADDRESS

# 2. Start everything
./start-bundler.sh

# 3. That's it! Check the output for URLs and credentials
\`\`\`

**What you get:**
- Bundler API: http://localhost:3001
- Admin Dashboard: http://localhost:3002/admin/dashboard
- Queue Monitor: http://localhost:3002/admin/queues
- MinIO Console: http://localhost:9001

**Stop everything:**
\`\`\`bash
./stop-bundler.sh              # Stop (keep data)
./stop-bundler.sh --clean      # Stop and delete all data
\`\`\`

📖 **Full Docker guide:** [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)

### Option 2: CLI with Flags

Use the `quick-start.sh` script with command-line arguments:

\`\`\`bash
# TESTNET (Base Sepolia - no CDP credentials required)
./quick-start.sh --wallet ./path/to/wallet.json --x402-address 0xYourEthereumAddress

# MAINNET (requires Coinbase CDP credentials)
./quick-start.sh --wallet ./wallet.json --x402-address 0xYourAddress --network mainnet
\`\`\`

### Option 3: PM2 Deployment

For development or if you need Node.js debugging:

\`\`\`bash
# 1. Install dependencies
yarn install

# 2. Configure
cp .env.sample .env
# Edit .env with your settings

# 3. Start infrastructure (Docker)
yarn docker:up

# 4. Build and migrate
yarn build
yarn db:migrate

# 5. Start with PM2
pm2 start ecosystem.config.js

# View logs
pm2 logs
\`\`\`

📖 **Deployment comparison:** [DEPLOYMENT_OPTIONS.md](./DEPLOYMENT_OPTIONS.md)

**Useful Commands:**
\`\`\`bash
pm2 stop all              # Stop services
pm2 restart all           # Restart services
pm2 logs upload-api       # View API logs
pm2 logs upload-workers   # View worker logs
docker-compose down       # Stop infrastructure
\`\`\`

---

## 📚 Documentation

- **[DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)** - Complete Docker deployment guide
- **[DEPLOYMENT_OPTIONS.md](./DEPLOYMENT_OPTIONS.md)** - Compare deployment methods
- **[X402_TWO_STAGE_PAYMENT.md](./X402_TWO_STAGE_PAYMENT.md)** - x402 payment flow details
- **[CLAUDE.md](./CLAUDE.md)** - Architecture for AI assistants

---

## 📦 Docker Commands

If using Docker deployment:

\`\`\`bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Stop and remove all data (clean slate)
docker-compose down -v

# View logs for specific service
docker-compose logs -f bundler
docker-compose logs -f admin

# Rebuild after code changes
docker-compose up -d --build

# Access bundler container shell
docker-compose exec bundler sh
\`\`\`

**What Docker runs:**
- ✅ PostgreSQL (database)
- ✅ Redis (cache + queues)
- ✅ MinIO (S3 storage)
- ✅ Bundler Service (main API)
- ✅ Admin Dashboard (monitoring)

**Advantages of Docker setup:**
- Single command to start everything
- No local Node.js/Yarn installation needed (except for development)
- Consistent environment across dev/staging/prod
- Easy scaling and deployment
- Automatic health checks and restarts
- Isolated network and volumes

---

## 📡 x402 Payment Flow

### How It Works

The x402 protocol enables stateless, pay-per-upload payments without account creation:

\`\`\`
┌─────────┐                    ┌──────────────┐                    ┌─────────┐
│ Client  │                    │   Bundler    │                    │  USDC   │
│         │                    │   (Lite)     │                    │ Contract│
└────┬────┘                    └──────┬───────┘                    └────┬────┘
     │                                │                                  │
     │ 1. POST /v1/tx                 │                                  │
     │   (no X-PAYMENT header)        │                                  │
     ├───────────────────────────────>│                                  │
     │                                │                                  │
     │ 2. 402 Payment Required        │                                  │
     │   X-Payment-Required: x402-1   │                                  │
     │   {maxAmountRequired, payTo..} │                                  │
     │<───────────────────────────────┤                                  │
     │                                │                                  │
     │ 3. Create EIP-712 signature    │                                  │
     │    for USDC transfer          │                                  │
     │                                │                                  │
     │ 4. POST /v1/tx                 │                                  │
     │   X-PAYMENT: <base64-payload>  │                                  │
     │   Content-Length: <bytes>      │                                  │
     ├───────────────────────────────>│                                  │
     │                                │                                  │
     │                                │ 5. Verify signature              │
     │                                │    Settle USDC transfer          │
     │                                ├─────────────────────────────────>│
     │                                │<─────────────────────────────────┤
     │                                │  Transaction confirmed           │
     │                                │                                  │
     │ 6. 200 OK                      │                                  │
     │   X-Payment-Response:          │                                  │
     │   {txHash, paymentId, receipt} │                                  │
     │<───────────────────────────────┤                                  │
     │                                │                                  │
     │ 7. (After upload verification) │                                  │
     │                                │ 8. Fraud detection               │
     │                                │    ±5% byte count tolerance      │
     │                                │                                  │
\`\`\`

### Example: Upload with x402

#### Step 1: Get Price Quote

\`\`\`bash
curl -X GET "http://localhost:3001/v1/x402/price/3/0xYourAddress?bytes=1024"
\`\`\`

**Response: 200 OK** (per x402 spec, price quotes return 200, not 402)

\`\`\`json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "150000",
      "resource": "/v1/tx",
      "description": "Upload data to Arweave via AR.IO Bundler",
      "mimeType": "application/json",
      "payTo": "0xYourPaymentAddress",
      "maxTimeoutSeconds": 300,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": {
        "name": "USD Coin",
        "version": "2"
      }
    }
  ]
}
\`\`\`

#### Step 2: Create EIP-712 Signature (in your application)

\`\`\`typescript
import { ethers } from 'ethers';

// EIP-712 domain for USDC contract
const domain = {
  name: "USD Coin",
  version: "2",
  chainId: 84532, // Base Sepolia
  verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
};

// EIP-712 types for transferWithAuthorization
const types = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
};

// Authorization message
const authorization = {
  from: "0xYourAddress",
  to: "0xPaymentAddress",
  value: "150000", // USDC atomic units (6 decimals)
  validAfter: 0,
  validBefore: Math.floor(Date.now() / 1000) + 300, // 5 min from now
  nonce: ethers.hexlify(ethers.randomBytes(32))
};

// Sign with your wallet
const signer = new ethers.Wallet(privateKey);
const signature = await signer.signTypedData(domain, types, authorization);

// Create x402 payment header
const paymentPayload = {
  x402Version: 1,
  scheme: "exact",
  network: "base-sepolia",
  payload: {
    signature,
    authorization
  }
};

const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
\`\`\`

#### Step 3: Upload with Payment

\`\`\`bash
curl -X POST "http://localhost:3001/v1/tx" \\
  -H "Content-Type: application/octet-stream" \\
  -H "X-PAYMENT: <base64-payment-payload>" \\
  -H "Content-Length: 1024" \\
  --data-binary @mydata.bin
\`\`\`

**Response: 200 OK**

\`\`\`json
{
  "id": "dataItemId123...",
  "timestamp": 1699123456789,
  "owner": "0xYourAddress",
  "signature": "...",
  "deadlineHeight": 1234567,
  "version": "1.0.0",
  "x402Payment": {
    "paymentId": "x402_1699123456_abc123",
    "txHash": "0x789...",
    "network": "base-sepolia",
    "mode": "payg"
  }
}
\`\`\`

---

## ⚙️ Configuration

### Required Environment Variables

Edit \`.env\` with these critical settings:

\`\`\`bash
# Server Configuration
PORT=3001
NODE_ENV=production

# Database (PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=bundler_lite
DB_USER=bundler
DB_PASSWORD=your-secure-password

# Redis (Cache)
REDIS_CACHE_HOST=localhost
REDIS_CACHE_PORT=6379

# Redis (Queue)
REDIS_QUEUE_HOST=localhost
REDIS_QUEUE_PORT=6381

# Object Storage (MinIO or S3)
AWS_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_REGION=us-east-1
OBJECT_STORE_TYPE=s3

# Arweave Configuration
ARWEAVE_GATEWAY=https://arweave.net
TURBO_JWK_FILE=/absolute/path/to/your/arweave-wallet.json

# x402 Payment Configuration
X402_PAYMENT_ADDRESS=0xYourEthereumAddress
X402_BASE_TESTNET_ENABLED=true
X402_BASE_ENABLED=false  # Set to true for mainnet
X402_FACILITATOR_URL_BASE_TESTNET=https://x402.org/facilitator
X402_FRAUD_TOLERANCE_PERCENT=5
X402_PRICING_BUFFER_PERCENT=15

# Coinbase CDP (Required for mainnet, optional for testnet)
CDP_API_KEY_ID=your-cdp-key-id
CDP_API_KEY_SECRET=your-cdp-secret
\`\`\`

### Network Configuration

**Testnet (Base Sepolia) - Default**
\`\`\`bash
X402_BASE_TESTNET_ENABLED=true
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
X402_FACILITATOR_URL_BASE_TESTNET=https://x402.org/facilitator
\`\`\`

**Mainnet (Base) - Production**
\`\`\`bash
X402_BASE_ENABLED=true
BASE_MAINNET_RPC_URL=https://mainnet.base.org
X402_FACILITATOR_URL_BASE=https://facilitator.base.coinbasecloud.net
CDP_API_KEY_ID=required-for-mainnet
CDP_API_KEY_SECRET=required-for-mainnet
\`\`\`

### Important Notes

- **TURBO_JWK_FILE**: MUST be an absolute path (not relative)
- **X402_PAYMENT_ADDRESS**: Your Ethereum address that will receive USDC payments
- **CDP Credentials**: Get from [Coinbase Developer Platform](https://portal.cdp.coinbase.com/)
- **Testnet Facilitator**: Public facilitator (https://x402.org/facilitator) works without CDP credentials
- **Mainnet Facilitator**: Requires CDP API credentials

---

## 🗄️ Database Setup

The bundler uses PostgreSQL with Knex migrations:

\`\`\`bash
# Run all migrations
yarn db:migrate

# Rollback last migration
yarn db:migrate:rollback

# Create new migration
yarn db:migrate:new migration_name
\`\`\`

### Key Tables

- \`new_data_item\` - Uploaded data items awaiting bundling
- \`planned_data_item\` - Data items queued for bundling
- \`permanent_data_item\` - Successfully bundled and permanent items
- \`bundle_plan\` - Bundle planning records
- \`posted_bundle\` - Posted bundles to Arweave
- \`x402_payments\` - x402 payment transactions and fraud detection

---

## 📦 Docker Infrastructure

The \`docker-compose.yml\` provides complete infrastructure:

\`\`\`yaml
services:
  postgres:       # Port 5432 - PostgreSQL database
  redis-cache:    # Port 6379 - Caching layer
  redis-queue:    # Port 6381 - BullMQ job queues
  minio:          # Port 9000 - S3-compatible storage
  minio-init:     # Initializes S3 buckets (raw-data-items, backup-data-items)
\`\`\`

### Commands

\`\`\`bash
# Start all infrastructure services
yarn docker:up

# Stop all services
yarn docker:down

# View logs
docker-compose logs -f postgres
docker-compose logs -f redis-cache

# Access MinIO web console
open http://localhost:9001
# Login: minioadmin / minioadmin
\`\`\`

---

## 🔄 Job Pipeline

The bundler uses BullMQ for async processing with 11 job queues:

\`\`\`
Upload → newDataItem → planBundle → prepareBundle → postBundle → verifyBundle
              ↓              ↓
        opticalPost    unbundleBdi
              ↓              ↓
         putOffsets     cleanupFs
\`\`\`

### Job Queues & Workers

1. **new-data-item** - Process new uploads and store in object storage
2. **plan-bundle** - Group data items into bundles (size/feature-based)
3. **prepare-bundle** - Download items and assemble ANS-104 bundles
4. **post-bundle** - Post assembled bundles to Arweave network
5. **verify-bundle** - Confirm bundle posting and update database
6. **optical-post** - Optional AR.IO Gateway optimistic caching
7. **unbundle-bdi** - Extract nested bundle data items (BDIs)
8. **cleanup-fs** - Remove temporary filesystem artifacts
9. **put-offsets** - Write data item offset information
10. **finalize-upload** - Complete multipart upload flow

### Monitoring

- BullMQ provides job status, retry logic, and failure handling
- Failed jobs are automatically retried with exponential backoff
- Job metrics available via Prometheus endpoint (if enabled)

---

## 🧪 Testing

\`\`\`bash
# Unit tests only
yarn test:unit

# Integration tests (requires Docker infrastructure)
yarn test:integration

# All tests
yarn test

# Type checking
yarn typecheck

# Linting
yarn lint
yarn lint:fix

# Code formatting
yarn format
yarn format:check
\`\`\`

---

## 🔧 Development

\`\`\`bash
# Development mode with hot reload
yarn dev

# Watch mode (rebuild on changes)
yarn start:watch

# Build TypeScript to JavaScript
yarn build

# Clean build artifacts
yarn clean
\`\`\`

---

## 📊 Admin Dashboard

The bundler includes a comprehensive admin dashboard for monitoring and managing your service.

### Features

- **📈 Real-time Statistics**
  - Upload metrics (total uploads, bytes, unique users)
  - x402 payment stats (USDC volume, transactions by network)
  - Bundle statistics (bundles posted, average size)
  - System health (database, Redis, queues)

- **🔍 Queue Monitoring (Bull Board)**
  - View all 11 job queues in real-time
  - Monitor job status (waiting, active, completed, failed)
  - Inspect individual jobs and error details
  - Retry failed jobs manually

- **🔒 Secure Access**
  - Basic Authentication (ADMIN_USERNAME/ADMIN_PASSWORD)
  - Rate limiting to prevent abuse
  - IP logging for audit trail

### Starting the Dashboard

\`\`\`bash
# Start admin dashboard (runs on port 3002)
yarn admin

# Or with PM2
pm2 start admin-server.js --name admin-dashboard
\`\`\`

### Accessing the Dashboard

- **Dashboard**: `http://localhost:3002/admin/dashboard`
- **Queue Monitor**: `http://localhost:3002/admin/queues`
- **Stats API**: `http://localhost:3002/admin/stats` (JSON)

### Authentication

Set credentials in `.env`:

\`\`\`bash
# Generate secure password
ADMIN_PASSWORD=$(openssl rand -hex 32)

# Add to .env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-generated-password-here
BULL_BOARD_PORT=3002
\`\`\`

Browser will prompt for username/password (Basic Auth).

### Dashboard Features

**Main Dashboard** (`/admin/dashboard`):
- Upload statistics (all-time, today, this week)
- x402 payment breakdown by network
- Top payers and recent transactions
- System health indicators
- 30-second auto-refresh with caching

**Queue Monitor** (`/admin/queues`):
- Real-time job queue monitoring
- Search and filter jobs
- Manual job retry/cleanup
- Job logs and error details
- Pause/resume queues

### API Endpoint

The stats API provides programmatic access to dashboard data:

\`\`\`bash
curl -u admin:your-password http://localhost:3002/admin/stats | jq
\`\`\`

Response includes:
- `upload` - Upload statistics
- `x402` - Payment statistics
- `bundles` - Bundle statistics
- `system` - Health metrics
- `queues` - Queue status

---

## 📚 API Reference

### Core Upload Endpoints

#### Upload Data Item

\`\`\`http
POST /v1/tx
Content-Type: application/octet-stream
X-PAYMENT: <optional-x402-payment-header>
Content-Length: <bytes>

<binary ANS-104 data item>
\`\`\`

**Without X-PAYMENT header**: Returns 402 Payment Required with x402 payment requirements

**With X-PAYMENT header**: Returns 200 OK with receipt and payment confirmation

**Response (without payment)**:
\`\`\`http
HTTP/1.1 402 Payment Required
X-Payment-Required: x402-1
Content-Type: application/json

{
  "x402Version": 1,
  "accepts": [...]
}
\`\`\`

**Response (with payment)**:
\`\`\`json
{
  "id": "dataItemId123",
  "timestamp": 1699123456789,
  "owner": "0xYourAddress",
  "signature": "...",
  "deadlineHeight": 1234567,
  "version": "1.0.0",
  "x402Payment": {
    "paymentId": "x402_...",
    "txHash": "0x...",
    "network": "base-sepolia",
    "mode": "payg"
  }
}
\`\`\`

#### Get Data Item Status

\`\`\`http
GET /v1/tx/{dataItemId}/status
\`\`\`

**Response**:
\`\`\`json
{
  "id": "dataItemId123",
  "status": "permanent",
  "bundleId": "bundleTxId456",
  "blockHeight": 1234567
}
\`\`\`

Statuses:
- \`new\` - Uploaded, awaiting bundling
- \`pending\` - In bundling pipeline
- \`finalized\` - Bundle posted, awaiting confirmation
- \`permanent\` - Confirmed on Arweave blockchain

#### Get Data Item Offsets

\`\`\`http
GET /v1/tx/{dataItemId}/offsets
\`\`\`

**Response**:
\`\`\`json
{
  "dataItemId": "dataItemId123",
  "bundleId": "bundleTxId456",
  "offset": 1024,
  "size": 2048
}
\`\`\`

### x402 Payment Endpoints

#### Get Price Quote

\`\`\`http
GET /v1/x402/price/{signatureType}/{address}?bytes={byteCount}
\`\`\`

**Parameters**:
- \`signatureType\`: \`1\` (Arweave), \`3\` (Ethereum), \`4\` (Solana)
- \`address\`: Wallet address (Arweave/Ethereum/Solana format)
- \`bytes\`: Data size in bytes (query parameter)

**Response**: 200 OK with x402 payment requirements

#### Verify and Settle Payment (Advanced)

\`\`\`http
POST /v1/x402/payment/{signatureType}/{address}
Content-Type: application/json

{
  "paymentHeader": "<base64-payment-payload>",
  "dataItemId": "optional-existing-id",
  "byteCount": 1024,
  "mode": "payg"
}
\`\`\`

**Payment Modes**:
- \`payg\` - Pay-as-you-go (pay only for this upload)
- \`topup\` - Credit account balance (requires account)
- \`hybrid\` - Pay for upload + excess tops up balance (default)

#### Finalize Payment (Advanced)

\`\`\`http
POST /v1/x402/finalize
Content-Type: application/json

{
  "dataItemId": "dataItemId123",
  "actualByteCount": 1024
}
\`\`\`

**Fraud Detection**: Compares declared vs actual byte count
- ✅ **Within ±5%**: Payment confirmed
- ⬇️ **Under -5%**: Partial refund issued
- ⬆️ **Over +5%**: Fraud penalty (payment kept, upload rejected)

### Service Info Endpoints

#### Get Service Info

\`\`\`http
GET /v1/info
\`\`\`

#### Health Check

\`\`\`http
GET /health
\`\`\`

#### Prometheus Metrics

\`\`\`http
GET /bundler_metrics
\`\`\`

---

## 🔐 Security

### Payment Security

- **EIP-712 Signatures**: Cryptographically signed USDC authorizations
- **EIP-3009 Transfers**: Gasless USDC transfers via \`receiveWithAuthorization\`
- **Timeout Protection**: Payment authorizations expire after \`maxTimeoutSeconds\` (default: 5 minutes)
- **Nonce Prevention**: Each authorization uses a unique nonce to prevent replay attacks
- **Fraud Detection**: Automatic byte-count verification with ±5% tolerance
- **Amount Validation**: Server verifies payment amount matches pricing requirements

### Data Security

- **Signature Verification**: All ANS-104 data items verified against owner public key
- **ANS-104 Standard**: Full compliance with Arweave data item specification
- **Arweave Permanence**: Data posted to Arweave blockchain for permanent storage
- **S3 Encryption**: Optional server-side encryption for MinIO/S3 storage
- **PostgreSQL**: Transaction logs for audit trails and payment verification

---

## 🌐 Networks & Standards

### x402 Payment Networks

- **Base Mainnet** (chainId: 8453)
  - USDC: \`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\`
  - RPC: \`https://mainnet.base.org\`
  - Facilitator: Coinbase CDP (requires credentials)

- **Base Sepolia Testnet** (chainId: 84532) ⭐ **Default**
  - USDC: \`0x036CbD53842c5426634e7929541eC2318f3dCF7e\`
  - RPC: \`https://sepolia.base.org\`
  - Facilitator: Public (https://x402.org/facilitator)

- **Ethereum Mainnet** (chainId: 1)
  - USDC: \`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48\`

- **Polygon Mainnet** (chainId: 137)
  - USDC: \`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359\`

### Data Item Signatures (ANS-104)

- **Arweave** (\`signatureType: 1\`) - RSA-PSS 4096-bit keys
- **Ethereum** (\`signatureType: 3\`) - ECDSA secp256k1
- **Solana** (\`signatureType: 4\`) - Ed25519

### Standards & Protocols

- **ANS-104**: Arweave Bundled Data Item standard
- **x402**: Coinbase HTTP 402 Payment Required protocol
- **EIP-712**: Typed Structured Data Hashing and Signing
- **EIP-3009**: USDC TransferWithAuthorization (gasless transfers)
- **BullMQ**: Redis-based distributed job queues
- **Knex.js**: SQL query builder and migration system

---

## 🐛 Troubleshooting

### Build Errors

**Issue**: \`Cannot find module '@dha-team/arbundles'\`

**Solution**: Install dependencies
\`\`\`bash
rm -rf node_modules yarn.lock
yarn install
\`\`\`

**Issue**: \`error TS2307: Cannot find module\`

**Solution**: Rebuild TypeScript
\`\`\`bash
yarn clean
yarn build
\`\`\`

### Database Errors

**Issue**: \`relation "new_data_item" does not exist\`

**Solution**: Run migrations
\`\`\`bash
# Ensure PostgreSQL is running
docker-compose up postgres -d

# Run migrations
yarn db:migrate
\`\`\`

**Issue**: \`ECONNREFUSED connecting to PostgreSQL\`

**Solution**: Check database configuration and connectivity
\`\`\`bash
# Verify PostgreSQL is running
docker-compose ps postgres

# Check connection
psql -h localhost -U bundler -d bundler_lite
\`\`\`

### x402 Payment Errors

**Issue**: \`Invalid EIP-712 signature\`

**Solution**: Verify domain, types, and signer match exactly
\`\`\`typescript
// Domain MUST match USDC contract exactly
domain.chainId === networkConfig.chainId  // MUST match
domain.verifyingContract === usdcContractAddress  // MUST match
domain.name === "USD Coin"  // MUST match
domain.version === "2"  // MUST match
\`\`\`

**Issue**: \`Facilitator verification failed\`

**Solution**: Check facilitator URL and network configuration
\`\`\`bash
# Testnet (works without CDP credentials)
X402_FACILITATOR_URL_BASE_TESTNET=https://x402.org/facilitator

# Mainnet (requires CDP credentials)
X402_FACILITATOR_URL_BASE=https://facilitator.base.coinbasecloud.net
CDP_API_KEY_ID=your-key-id
CDP_API_KEY_SECRET=your-secret
\`\`\`

**Issue**: \`Fraud penalty - declared vs actual byte count mismatch\`

**Solution**: Ensure \`Content-Length\` header matches actual data size
\`\`\`bash
# Content-Length MUST match actual data size exactly
curl -X POST "http://localhost:3001/v1/tx" \\
  -H "Content-Length: $(wc -c < myfile.bin)" \\
  --data-binary @myfile.bin
\`\`\`

### Wallet Errors

**Issue**: \`ENOENT: no such file or directory, open './wallet.json'\`

**Solution**: Use absolute path for Arweave wallet
\`\`\`bash
# WRONG (relative path)
TURBO_JWK_FILE=./wallet.json

# CORRECT (absolute path)
TURBO_JWK_FILE=/home/user/ar-io-x402-bundler/wallet.json
\`\`\`

### Port Conflicts

**Issue**: \`EADDRINUSE: address already in use :::3001\`

**Solution**: Change port or kill existing process
\`\`\`bash
# Change port
PORT=3002 yarn start

# OR kill existing process
lsof -ti:3001 | xargs kill -9
\`\`\`

### Object Storage Errors

**Issue**: \`S3 connection refused\`

**Solution**: Verify MinIO is running
\`\`\`bash
docker-compose up minio -d
curl http://localhost:9000/minio/health/live
\`\`\`

---

## 🚦 Production Deployment

### Environment Checklist

- [ ] \`NODE_ENV=production\`
- [ ] \`TURBO_JWK_FILE\` set to absolute path
- [ ] \`X402_PAYMENT_ADDRESS\` configured
- [ ] CDP credentials set (if using mainnet)
- [ ] PostgreSQL database configured
- [ ] Redis cache and queue configured
- [ ] Object storage (S3/MinIO) configured
- [ ] Arweave gateway endpoint set
- [ ] Database migrations run
- [ ] PM2 or systemd service configured

### Recommended Setup

\`\`\`bash
# Use PM2 for process management
npm install -g pm2

# Start service
pm2 start lib/server.js --name bundler-lite

# Monitor
pm2 logs bundler-lite
pm2 monit

# Auto-restart on reboot
pm2 startup
pm2 save
\`\`\`

### Performance Tuning

- **Worker Concurrency**: Adjust BullMQ worker concurrency based on CPU cores
- **Database Pool Size**: Configure PostgreSQL connection pooling
- **Redis Memory**: Allocate sufficient memory for queue data
- **Object Storage**: Use local MinIO or regional S3 for low latency

---

## 📝 License

AGPL-3.0 - See LICENSE file for details

---

## 🤝 Contributing

Contributions welcome! This is a production-ready bundler with x402 support.

### Development Workflow

1. Fork the repository
2. Create a feature branch (\`git checkout -b feature/amazing-feature\`)
3. Make your changes with tests
4. Run code quality checks:
   \`\`\`bash
   yarn lint:fix
   yarn format
   yarn typecheck
   yarn test
   \`\`\`
5. Commit your changes (\`git commit -m 'Add amazing feature'\`)
6. Push to the branch (\`git push origin feature/amazing-feature\`)
7. Open a Pull Request

### Code Style

- **TypeScript**: Strict mode enabled
- **ESLint**: Enforce code quality
- **Prettier**: Consistent formatting
- **Tests**: Unit + integration tests for new features

---

## 📞 Support

- **Issues**: https://github.com/ar-io/ar-io-x402-bundler/issues
- **Discussions**: https://github.com/ar-io/ar-io-x402-bundler/discussions
- **Discord**: https://discord.gg/ario
- **Documentation**: https://docs.ar.io

---

## 🙏 Acknowledgments

- **AR.IO Network** - Arweave gateway infrastructure and bundler architecture
- **Coinbase** - x402 payment protocol and Base chain
- **Permanent Data Solutions** - Original AR.IO bundler design
- **Arweave** - Permanent data storage protocol
- **BullMQ** - Robust job queue system
- **Community Contributors** - Thank you! 🎉

---

**Built with ❤️ for the decentralized web**

*Making Arweave accessible for AI agents, developers, and stateless applications.*
