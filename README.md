# AR.IO x402 Bundler

**Lightweight Arweave ANS-104 bundler with x402 USDC payments - designed for AI agents and stateless applications.**

Perfect for **AI agents**, **CLI tools**, **stateless clients**, and **developers** who want programmable Arweave uploads without managing user accounts.

## 🌟 Features

- **✅ x402 USDC Payments** - Pay with USDC using Coinbase's x402 protocol (EIP-3009)
- **✅ Multi-Facilitator Fallback** - Automatic failover between payment facilitators
- **✅ Stateless Operation** - No account creation required
- **✅ ANS-104 Bundling** - Efficient data item bundling for Arweave
- **✅ Multi-Signature Support** - Arweave, Ethereum, Solana wallets
- **✅ Fraud Detection** - Automatic byte-count verification with ±5% tolerance
- **✅ Auto Storage Cleanup** - Tiered retention (filesystem → MinIO → Arweave)
- **✅ Job Queue System** - BullMQ-powered async bundling pipeline
- **✅ S3-Compatible Storage** - MinIO or AWS S3 for data item storage
- **✅ Production Ready** - Built on AR.IO's battle-tested bundler architecture

---

## 🚀 Quick Start

### Prerequisites

- **Docker** & **Docker Compose** (recommended)
- **Arweave Wallet** (JWK file for bundle signing)
- **EVM Address** (for receiving USDC payments)

### Option 1: Interactive Setup (Easiest)

```bash
./setup-bundler.sh
```

The script will guide you through wallet configuration, payment setup, and network selection.

### Option 2: Manual Setup

```bash
# 1. Configure
cp .env.sample .env
# Edit .env: set ARWEAVE_WALLET_FILE and X402_PAYMENT_ADDRESS

# 2. Start everything
./start-bundler.sh
```

**Services:**
- Bundler API: http://localhost:3001
- Admin Dashboard: http://localhost:3002/admin/dashboard
- Queue Monitor: http://localhost:3002/admin/queues
- MinIO Console: http://localhost:9001

**Stop everything:**
```bash
./stop-bundler.sh              # Stop (keep data)
./stop-bundler.sh --clean      # Stop and delete all data
```

### Option 3: PM2 Deployment (Development)

For development or debugging:

```bash
yarn install
cp .env.sample .env
# Edit .env with your settings

yarn docker:up       # Start infrastructure
yarn build
yarn db:migrate

pm2 start ecosystem.config.js
pm2 logs
```

**📖 Full deployment guide:** [ADMIN.md](./ADMIN.md)

---

## ⚙️ Configuration

### Critical Environment Variables

Edit `.env` with these required settings:

```bash
# REQUIRED: Arweave wallet for signing bundles
# MUST be absolute path (not relative)
ARWEAVE_WALLET_FILE=/absolute/path/to/wallet.json

# REQUIRED: Your Ethereum address to receive USDC payments
X402_PAYMENT_ADDRESS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1

# REQUIRED FOR PRODUCTION: Public URL of your bundler
# Payment flows require this to generate correct payment requests
UPLOAD_SERVICE_PUBLIC_URL=https://upload.yourdomain.com

# OPTIONAL: Coinbase CDP credentials (required for Base mainnet only)
# Get from: https://portal.cdp.coinbase.com/
# Testnet (Base Sepolia) works without CDP credentials
CDP_API_KEY_ID=your-cdp-key-id
CDP_API_KEY_SECRET=your-cdp-secret

# REQUIRED: Admin dashboard password
# Generate with: openssl rand -hex 32
ADMIN_PASSWORD=your-secure-password-here
```

### Multi-Facilitator Configuration

The bundler supports automatic fallback between multiple payment facilitators:

```bash
# Base mainnet facilitators (tries in order)
# Default: Coinbase (primary) → Mogami (fallback)
X402_FACILITATORS_BASE=https://api.cdp.coinbase.com/platform/v2/x402,https://facilitator.mogami.tech

# Base Sepolia testnet facilitators
# Default: Mogami (no CDP credentials required)
X402_FACILITATORS_BASE_TESTNET=https://facilitator.mogami.tech
```

**Network Defaults:**
- **Base Mainnet** - Enabled by default
- **Base Sepolia (testnet)** - Disabled by default (enable with `X402_BASE_TESTNET_ENABLED=true`)
- **Ethereum/Polygon** - Disabled (must configure facilitators to enable)

### Storage Cleanup Configuration

The bundler uses tiered storage with automatic cleanup:

```bash
# Filesystem cleanup (hot cache for bundling)
FILESYSTEM_CLEANUP_DAYS=7       # Keep for 7 days

# MinIO cleanup (cold storage for disaster recovery)
MINIO_CLEANUP_DAYS=90           # Keep for 90 days

# Cleanup schedule (cron format)
CLEANUP_CRON=0 2 * * *          # Daily at 2 AM UTC
```

**Storage Tiers:**
1. **Filesystem** (7 days) - Fast bundling cache
2. **MinIO** (90 days) - Disaster recovery & re-bundling
3. **Arweave** (permanent) - Immutable decentralized storage

**📖 Storage management guide:** [ADMIN.md#storage-management](./ADMIN.md#storage-management)

---

## 📡 x402 Payment Flow

### How It Works

The x402 protocol enables stateless, pay-per-upload payments:

```
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
     │                                │                                  │
     │ 4. POST /v1/tx                 │                                  │
     │   X-PAYMENT: <signature>       │                                  │
     ├───────────────────────────────>│                                  │
     │                                │ 5. Verify & settle payment       │
     │                                ├─────────────────────────────────>│
     │                                │<─────────────────────────────────┤
     │                                │                                  │
     │ 6. 200 OK with receipt         │                                  │
     │<───────────────────────────────┤                                  │
```

### Example: Upload with x402

#### Step 1: Get Price Quote

```bash
curl -X GET "http://localhost:3001/v1/x402/price/3/0xYourAddress?bytes=1024"
```

**Response: 200 OK**

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",
      "maxAmountRequired": "150000",
      "resource": "/v1/tx",
      "payTo": "0xYourPaymentAddress",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "extra": {
        "name": "USD Coin",
        "version": "2"
      }
    }
  ]
}
```

#### Step 2: Create EIP-712 Signature

```typescript
import { ethers } from 'ethers';

// EIP-712 domain for USDC contract
const domain = {
  name: "USD Coin",
  version: "2",
  chainId: 8453,  // Base Mainnet
  verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
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
  value: "150000",  // USDC atomic units (6 decimals)
  validAfter: 0,
  validBefore: Math.floor(Date.now() / 1000) + 3600,  // 1 hour
  nonce: ethers.hexlify(ethers.randomBytes(32))
};

// Sign with your wallet
const signer = new ethers.Wallet(privateKey);
const signature = await signer.signTypedData(domain, types, authorization);

// Create x402 payment header
const paymentPayload = {
  x402Version: 1,
  scheme: "exact",
  network: "base",
  payload: { signature, authorization }
};

const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
```

#### Step 3: Upload with Payment

```bash
curl -X POST "http://localhost:3001/v1/tx" \
  -H "Content-Type: application/octet-stream" \
  -H "X-PAYMENT: <base64-payment-payload>" \
  -H "Content-Length: 1024" \
  --data-binary @mydata.bin
```

**Response: 200 OK**

```json
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
    "network": "base",
    "mode": "payg"
  }
}
```

---

## 📚 API Reference

### Core Upload Endpoints

#### Upload Data Item

```http
POST /v1/tx
Content-Type: application/octet-stream
X-PAYMENT: <optional-x402-payment-header>
Content-Length: <bytes>

<binary ANS-104 data item>
```

**Without X-PAYMENT**: Returns 402 Payment Required with payment requirements
**With X-PAYMENT**: Returns 200 OK with receipt and payment confirmation

#### Get Data Item Status

```http
GET /v1/tx/{dataItemId}/status
```

**Response:**
```json
{
  "id": "dataItemId123",
  "status": "permanent",
  "bundleId": "bundleTxId456",
  "blockHeight": 1234567
}
```

**Statuses:**
- `new` - Uploaded, awaiting bundling
- `pending` - In bundling pipeline
- `finalized` - Bundle posted, awaiting confirmation
- `permanent` - Confirmed on Arweave

### x402 Payment Endpoints

#### Get Price Quote

```http
GET /v1/x402/price/{signatureType}/{address}?bytes={byteCount}
```

**Parameters:**
- `signatureType`: `1` (Arweave), `3` (Ethereum), `4` (Solana)
- `address`: Wallet address
- `bytes`: Data size in bytes (query parameter)

**Response**: 200 OK with x402 payment requirements

### Service Info Endpoints

- **Service Info**: `GET /v1/info`
- **Health Check**: `GET /health`
- **Prometheus Metrics**: `GET /bundler_metrics`

---

## 📊 Admin Dashboard

Access the admin dashboard at: http://localhost:3002/admin/dashboard

**Features:**
- Real-time upload statistics
- x402 payment metrics by network
- Bundle posting statistics
- System health indicators
- BullMQ job queue monitoring

**Authentication**: Basic Auth using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`

**Queue Monitor**: http://localhost:3002/admin/queues
- View all 11 job queues
- Monitor job status (waiting, active, completed, failed)
- Retry failed jobs manually
- Inspect job details and errors

**📖 Monitoring guide:** [ADMIN.md#monitoring](./ADMIN.md#monitoring)

---

## 🧪 Testing

```bash
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
```

---

## 🔧 Development

```bash
# Development mode with hot reload
yarn dev

# Watch mode (rebuild on changes)
yarn start:watch

# Build TypeScript to JavaScript
yarn build

# Clean build artifacts
yarn clean
```

### Database Operations

```bash
# Run all migrations
yarn db:migrate

# Rollback last migration
yarn db:migrate:rollback

# Create new migration
yarn db:migrate:new migration_name
```

**Important**: Migration files are created in `src/migrations/*.ts` and compiled to `lib/migrations/*.js`.

---

## 🌐 Networks & Standards

### x402 Payment Networks

- **Base Mainnet** (chainId: 8453) ⭐ **Default**
  - USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  - Facilitators: Coinbase (primary) → Mogami (fallback)
  - Requires: CDP credentials

- **Base Sepolia Testnet** (chainId: 84532)
  - USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
  - Facilitator: Mogami (no CDP needed)

- **Ethereum Mainnet** (chainId: 1)
  - USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
  - Must configure facilitators to enable

- **Polygon Mainnet** (chainId: 137)
  - USDC: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
  - Must configure facilitators to enable

### Data Item Signatures (ANS-104)

- **Arweave** (`signatureType: 1`) - RSA-PSS 4096-bit keys
- **Ethereum** (`signatureType: 3`) - ECDSA secp256k1
- **Solana** (`signatureType: 4`) - Ed25519

### Standards & Protocols

- **ANS-104**: Arweave Bundled Data Item standard
- **x402**: Coinbase HTTP 402 Payment Required protocol
- **EIP-712**: Typed Structured Data Hashing and Signing
- **EIP-3009**: USDC TransferWithAuthorization (gasless transfers)

---

## 🐛 Troubleshooting

### Build Errors

**Issue**: `Cannot find module '@dha-team/arbundles'`

```bash
rm -rf node_modules yarn.lock
yarn install
```

**Issue**: `error TS2307: Cannot find module`

```bash
yarn clean && yarn build
```

### Database Errors

**Issue**: `relation "new_data_item" does not exist`

```bash
# Ensure PostgreSQL is running
docker-compose up -d postgres

# Run migrations
yarn db:migrate
```

**Issue**: `database "bundler_lite" does not exist`

```bash
docker-compose exec postgres psql -U postgres -c "CREATE DATABASE bundler_lite;"
yarn db:migrate
```

### x402 Payment Errors

**Issue**: `Invalid EIP-712 signature`

**Solution**: Verify domain parameters match exactly:

```javascript
const domain = {
  name: "USD Coin",               // MUST match
  version: "2",                   // MUST match
  chainId: 8453,                  // MUST match network
  verifyingContract: "0x833..."   // MUST match USDC contract
};
```

**Issue**: `Facilitator verification failed`

**Solution**: Check facilitator configuration and CDP credentials

```bash
# For Base Mainnet (requires CDP)
CDP_API_KEY_ID=your-key-id
CDP_API_KEY_SECRET=your-secret

# For Base Sepolia Testnet (no CDP needed)
X402_BASE_TESTNET_ENABLED=true
X402_FACILITATORS_BASE_TESTNET=https://facilitator.mogami.tech
```

**Issue**: `Fraud penalty - byte count mismatch`

**Solution**: Ensure Content-Length matches actual data size (±5% tolerance)

```bash
curl -X POST "http://localhost:3001/v1/tx" \
  -H "Content-Length: $(wc -c < myfile.bin)" \
  --data-binary @myfile.bin
```

### Wallet Errors

**Issue**: `ENOENT: no such file or directory, open './wallet.json'`

**Solution**: Use absolute path for Arweave wallet

```bash
# ❌ WRONG (relative path)
ARWEAVE_WALLET_FILE=./wallet.json

# ✅ CORRECT (absolute path)
ARWEAVE_WALLET_FILE=/home/user/ar-io-x402-bundler/wallet.json
```

### Port Conflicts

**Issue**: `EADDRINUSE: address already in use :::3001`

```bash
# Change port
PORT=3002 yarn start

# OR kill existing process
lsof -ti:3001 | xargs kill -9
```

### Docker Issues

**Issue**: `no space left on device`

```bash
# Remove unused images and volumes
docker system prune -a --volumes

# Check space saved
df -h
```

**📖 Complete troubleshooting guide:** [ADMIN.md#troubleshooting](./ADMIN.md#troubleshooting)

---

## 🔐 Security

### Payment Security

- **EIP-712 Signatures**: Cryptographically signed USDC authorizations
- **EIP-3009 Transfers**: Gasless USDC transfers
- **Timeout Protection**: Payment authorizations expire (default: 1 hour)
- **Nonce Prevention**: Unique nonce prevents replay attacks
- **Fraud Detection**: Automatic byte-count verification (±5% tolerance)

### Data Security

- **Signature Verification**: All ANS-104 data items verified
- **ANS-104 Standard**: Full compliance with Arweave specification
- **Arweave Permanence**: Data posted to blockchain for permanent storage
- **S3 Encryption**: Optional server-side encryption for MinIO/S3

### Production Security

```bash
# Generate strong admin password
ADMIN_PASSWORD=$(openssl rand -hex 32)

# Set proper wallet permissions
chmod 600 /path/to/wallet.json

# Use HTTPS with reverse proxy (nginx/caddy)
# Firewall: Allow 3001 (API), restrict 3002 (admin)
```

**📖 Security guide:** [ADMIN.md#security](./ADMIN.md#security)

---

## 📦 Docker Commands

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Stop and remove all data
docker-compose down -v

# View logs
docker-compose logs -f bundler
docker-compose logs -f workers

# Rebuild after code changes
docker-compose up -d --build

# Access container shell
docker-compose exec bundler sh
```

**Docker runs:**
- ✅ Bundler API (port 3001)
- ✅ Workers (11 BullMQ queues)
- ✅ Admin Dashboard (port 3002)
- ✅ PostgreSQL (port 5432)
- ✅ Redis Cache (port 6379)
- ✅ Redis Queue (port 6381)
- ✅ MinIO (ports 9000, 9001)

---

## 🚦 Production Deployment

### Checklist

- [ ] `NODE_ENV=production`
- [ ] `ARWEAVE_WALLET_FILE` set to absolute path
- [ ] `X402_PAYMENT_ADDRESS` configured
- [ ] `UPLOAD_SERVICE_PUBLIC_URL` set to public URL
- [ ] CDP credentials set (for mainnet)
- [ ] `ADMIN_PASSWORD` generated and secured
- [ ] PostgreSQL database configured
- [ ] Redis cache and queue configured
- [ ] Object storage (S3/MinIO) configured
- [ ] Database migrations run
- [ ] HTTPS/TLS configured (reverse proxy)
- [ ] Firewall rules configured
- [ ] Monitoring and alerting setup

### Recommended Stack

```bash
# Reverse proxy (nginx/caddy) for HTTPS/TLS
# Docker for bundler services
# Managed PostgreSQL (AWS RDS, DigitalOcean, etc.)
# Managed Redis (AWS ElastiCache, Redis Cloud, etc.)
# S3 or MinIO for object storage
# Prometheus + Grafana for monitoring
```

**📖 Production deployment guide:** [ADMIN.md#deployment](./ADMIN.md#deployment)

---

## 📝 Documentation

- **[ADMIN.md](./ADMIN.md)** - Complete administration and operations guide
- **[CLAUDE.md](./CLAUDE.md)** - Architecture guide for AI assistants
- **[.env.sample](./.env.sample)** - Environment configuration reference

---

## 📞 Support

- **Issues**: https://github.com/ar-io/ar-io-x402-bundler/issues
- **Discussions**: https://github.com/ar-io/ar-io-x402-bundler/discussions
- **Discord**: https://discord.gg/ario
- **Documentation**: https://docs.ar.io

---

## 🙏 Acknowledgments

- **AR.IO Network** - Arweave gateway infrastructure
- **Coinbase** - x402 payment protocol and Base chain
- **Permanent Data Solutions** - Original AR.IO bundler design
- **Arweave** - Permanent data storage protocol
- **BullMQ** - Robust job queue system

---

## 📄 License

AGPL-3.0 - See [LICENSE](./LICENSE) file for details

---

**Built with ❤️ for the decentralized web**

*Making Arweave accessible for AI agents, developers, and stateless applications.*
