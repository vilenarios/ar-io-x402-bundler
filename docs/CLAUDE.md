# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

AR.IO Bundler Lite is a lightweight Arweave ANS-104 bundler with x402 USDC payment support. It's designed for AI agents and stateless applications, requiring no account management. The service accepts data items, bundles them, posts to Arweave, and accepts x402 USDC payments.

## Deployment

### Quick Start (Recommended)

**All-Docker deployment (simplest):**
```bash
cp .env.sample .env
# Edit .env with ARWEAVE_WALLET_FILE and X402_PAYMENT_ADDRESS
./start-bundler.sh
```

This starts everything: PostgreSQL, Redis, MinIO, Bundler API, Workers, and Admin Dashboard.

**Alternative methods:**
- `quick-start.sh --wallet <path> --x402-address <addr>` - CLI with flags
- PM2 deployment - See `scripts/start.sh` for PM2-based deployment

**Full guides:**
- **DOCKER_DEPLOYMENT.md** - Complete Docker deployment guide
- **DEPLOYMENT_OPTIONS.md** - Compare deployment methods (All-Docker vs PM2)

## Development Commands

### Build & Run
```bash
# Build TypeScript to JavaScript
yarn build

# Development mode with hot reload
yarn dev

# Production mode
yarn start

# Watch mode (rebuild on changes)
yarn start:watch

# Admin dashboard
yarn admin
```

### Testing
```bash
# All tests
yarn test

# Unit tests only
yarn test:unit

# Integration tests (requires Docker infrastructure)
yarn test:integration

# Type checking
yarn typecheck
```

### Code Quality
```bash
# Linting
yarn lint
yarn lint:fix

# Formatting
yarn format
yarn format:check
```

### Database
```bash
# Run all migrations
yarn db:migrate

# Rollback last migration
yarn db:migrate:rollback

# Create new migration
yarn db:migrate:new migration_name
```

### Docker Infrastructure
```bash
# Start all infrastructure (PostgreSQL, Redis, MinIO)
yarn docker:up

# Stop all services
yarn docker:down
```

## Architecture Overview

### Core Components

**Server & Routing** (`src/server.ts`, `src/router.ts`)
- Koa-based HTTP server with middleware architecture
- Routes handle uploads, x402 payments, status checks, and multipart uploads
- Architecture pattern: dependency injection via `Architecture` interface

**Architecture Pattern** (`src/arch/architecture.ts`)
- Central `Architecture` interface defines all system dependencies
- `defaultArchitecture` provides production implementations
- All major components (database, objectStore, x402Service, etc.) injected via middleware
- Enables testability and modular component swapping

**Database Layer** (`src/arch/db/`)
- PostgreSQL with Knex.js for migrations and queries
- Two DB instances: `database` (upload data) and `dataItemOffsetsDB` (offsets tracking)
- Reader/writer separation for read scalability
- Key tables:
  - `new_data_item` - Uploaded items awaiting bundling
  - `planned_data_item` - Items queued for bundling
  - `permanent_data_item` - Successfully bundled items
  - `posted_bundle` - Bundle transaction records
  - `x402_payments` - x402 payment tracking with fraud detection

**Object Storage** (`src/arch/objectStore.ts`, `src/arch/s3ObjectStore.ts`)
- S3-compatible storage (MinIO or AWS S3)
- Two buckets: `raw-data-items` (uploaded data), `backup-data-items` (backups)
- Abstractions: `ObjectStore` interface with S3 and FileSystem implementations

**x402 Payment System** (`src/arch/x402Service.ts`, `src/x402/`)
- Handles Coinbase x402 protocol (HTTP 402 Payment Required)
- EIP-712 signature verification for USDC transfers
- `X402Service`: verifies payments, settles USDC via facilitator
- `X402PricingOracle`: converts Winston (AR pricing) to USDC atomic units
- Two-stage payment: estimate → finalize with fraud detection (±5% tolerance)
- Network configs support Base Mainnet, Base Sepolia, Ethereum, Polygon

### Job Queue System

**BullMQ Pipeline** (`src/jobs/`, `src/arch/queues.ts`)

The bundler uses BullMQ for async job processing. Jobs flow through this pipeline:

```
Upload → new-data-item → plan-bundle → prepare-bundle → post-bundle → verify-bundle
              ↓              ↓
        optical-post   unbundle-bdi
                           ↓
                      cleanup-fs
```

**Key Jobs:**
- `new-data-item` (`src/jobs/newDataItemBatchInsert.ts`) - Process uploads, store in S3
- `plan-bundle` (`src/jobs/plan.ts`) - Group data items into bundles using `BundlePacker`
- `prepare-bundle` (`src/jobs/prepare.ts`) - Download items, assemble ANS-104 bundles
- `post-bundle` (`src/jobs/post.ts`) - Post bundles to Arweave network
- `verify-bundle` (`src/jobs/verify.ts`) - Confirm bundle posting
- `optical-post` (`src/jobs/optical-post.ts`) - Optional AR.IO Gateway optimistic caching
- `unbundle-bdi` (`src/jobs/unbundle-bdi.ts`) - Extract nested bundle data items
- `cleanup-fs` (`src/jobs/cleanup-fs.ts`) - Remove temporary filesystem artifacts

**Queue Configuration:**
- Redis-backed queues (separate cache and queue Redis instances)
- Job retry logic with exponential backoff
- Jobs configured in `src/arch/queues/config.ts`

### Bundle Packing Strategy

**BundlePacker** (`src/bundles/bundlePacker.ts`)
- Packs data items into ANS-104 bundles
- Target size: 2 GiB (configurable via `MAX_BUNDLE_SIZE`)
- Max items per bundle: 10,000 (configurable via `MAX_DATA_ITEM_LIMIT`)
- Separates bundles by "premium feature type" (dedicated bundle types)
- Handles overdue items separately for expedited processing
- "Underweight" bundles held back until more items arrive

### Data Flow

**Upload Flow** (`src/routes/dataItemPost.ts`)
1. Client POSTs ANS-104 data item to `/v1/tx`
2. If no `X-PAYMENT` header → return 402 with payment requirements
3. If `X-PAYMENT` header → verify x402 payment signature
4. Store data item in S3 object storage
5. Insert record into `new_data_item` table
6. Enqueue `new-data-item` job
7. Return signed receipt with data item ID

**Bundling Flow**
1. `plan-bundle` job fetches unbundled items from DB
2. `BundlePacker` groups items into optimal bundle plans
3. `prepare-bundle` downloads items from S3, assembles ANS-104 bundle
4. `post-bundle` posts bundle transaction to Arweave
5. `verify-bundle` confirms bundle on Arweave blockchain
6. Items transition: `new` → `pending` → `finalized` → `permanent`

**x402 Payment Flow** (`src/routes/x402/`)
1. **Price Quote** (`x402Price.ts`): Client GETs `/v1/x402/price/{signatureType}/{address}?bytes=X`
   - Returns 200 OK with x402 payment requirements (not 402)
   - Calculates price using `X402PricingOracle` (Winston → USDC conversion)
2. **Payment Verification** (`x402Payment.ts`): Client POSTs payment header
   - Verifies EIP-712 signature
   - Settles USDC transfer via facilitator
   - Records payment in `x402_payments` table
3. **Finalization** (`x402Finalize.ts`): After upload, verify actual byte count
   - Fraud detection: compare declared vs actual bytes (±5% tolerance)
   - If mismatch > 5%: fraud penalty (payment kept, upload rejected)

### Important Configuration

**Environment Variables** (see `.env.sample`)
- `TURBO_JWK_FILE` - **MUST be absolute path** to Arweave wallet (for bundle signing)
- `X402_PAYMENT_ADDRESS` - Your Ethereum address for receiving USDC
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` - Coinbase CDP credentials (required for mainnet)
- Database: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- Redis: `REDIS_CACHE_HOST`, `REDIS_QUEUE_HOST` (two separate instances)
- Object Storage: `AWS_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

**Network Constants** (`src/constants.ts`)
- `maxBundleDataItemsByteCount` - Target bundle size (default: 2 GiB)
- `maxSingleDataItemByteCount` - Max upload size (default: 4 GiB)
- `maxDataItemsPerBundle` - Max items per bundle (default: 10,000)
- `deadlineHeightIncrement` - Arweave block height deadline (default: 200 blocks)
- `gatewayUrl` - Arweave gateway for verification (default: arweave.net)
- `arweaveUploadNode` - Upload node for chunks (default: arweave.net)

**x402 Network Config** (`src/constants.ts`, injected from env)
- Supports Base Sepolia (testnet), Base Mainnet, Ethereum, Polygon
- Each network has: `chainId`, `rpcUrl`, `usdcAddress`, `facilitatorUrl`
- Configuration injected via `X402_NETWORKS` JSON or individual env vars

## Key Patterns & Conventions

### Testing
- Unit tests colocated with source: `*.test.ts` files in `src/`
- Integration tests in `tests/` directory
- Use Mocha + Chai for assertions
- Tests require ts-node for TypeScript execution

### Logging
- Winston logger exported from `src/logger.ts`
- Child loggers created with context: `logger.child({ job: 'plan-bundle-job' })`
- All logs include trace IDs (via `loggerMiddleware`)

### Error Handling
- Custom error classes in `src/utils/errors.ts`
- Metrics tracked via `MetricRegistry` (Prometheus format)
- Uncaught exceptions logged and counted

### Migrations
- Knex migrations in `src/migrations/`
- Migration config in `src/arch/db/knexfile.ts`
- Migrations run on startup if `MIGRATE_ON_STARTUP=true`

### Signature Support (ANS-104)
- `signatureType: 1` - Arweave (RSA-PSS)
- `signatureType: 3` - Ethereum (ECDSA secp256k1)
- `signatureType: 4` - Solana (Ed25519)
- Signature configs in `src/constants.ts` (`signatureTypeInfo`)

## Recent Architecture Updates (November 2024)

**BullMQ Workers Implementation:**
- Created `src/jobs/allWorkers.ts` - Complete worker implementation for all 11 job queues
- Workers run in separate Docker container (`workers` service in docker-compose.yml)
- Supports independent scaling, restart, and graceful shutdown
- Each worker configured with appropriate concurrency levels

**Simplified Deployment:**
- New all-Docker option: `./start-bundler.sh` (one command startup)
- Added `workers` service to docker-compose.yml
- Fixed configuration bugs (database name consistency)
- Updated `.env.sample` with clear instructions
- Both Docker and PM2 deployments fully supported

**Configuration Fixes:**
- Fixed `ecosystem.config.js` database names (bundler_lite)
- Fixed `scripts/start.sh` migration command
- Standardized all database references

## Development Tips

### Running Locally
1. Start infrastructure: `yarn docker:up`
2. Configure `.env` (copy from `.env.sample`)
3. Set `TURBO_JWK_FILE` to **absolute path** of Arweave wallet
4. Run migrations: `yarn db:migrate`
5. Build: `yarn build`
6. Start bundler: `yarn start` (port 3001)
7. Start admin dashboard: `yarn admin` (port 3002)

### Admin Dashboard
- Dashboard: `http://localhost:3002/admin/dashboard`
- Queue Monitor: `http://localhost:3002/admin/queues` (Bull Board)
- Authentication: Basic Auth (ADMIN_USERNAME/ADMIN_PASSWORD from .env)
- Real-time stats: uploads, x402 payments, bundles, system health

### Debugging x402 Payments
- Check payment records: `SELECT * FROM x402_payments ORDER BY created_at DESC;`
- Payment modes: `payg` (pay-per-upload), `topup` (credit balance), `hybrid`
- Fraud detection tolerance: `X402_FRAUD_TOLERANCE_PERCENT` (default: 5%)
- Pricing buffer: `X402_PRICING_BUFFER_PERCENT` (default: 15% overcharge)

### Common Issues
- **Wallet path errors**: `TURBO_JWK_FILE` must be absolute, not relative
- **Migration errors**: Ensure PostgreSQL is running before `yarn db:migrate`
- **x402 signature errors**: Verify EIP-712 domain exactly matches USDC contract
- **BullMQ errors**: Ensure Redis queue instance is running on correct port

## Code Navigation

**Entry Points:**
- `src/server.ts` - HTTP server bootstrap
- `src/router.ts` - Route definitions
- `admin-server.js` - Admin dashboard server

**Core Routes:**
- Upload: `src/routes/dataItemPost.ts`
- x402: `src/routes/x402/x402Price.ts`, `x402Payment.ts`, `x402Finalize.ts`
- Status: `src/routes/status.ts`
- Multipart: `src/routes/multiPartUploads.ts`

**Job Handlers:**
- All in `src/jobs/` directory
- Named by job type: `plan.ts`, `prepare.ts`, `post.ts`, `verify.ts`

**Utilities:**
- `src/utils/common.ts` - Common helper functions
- `src/utils/dataItemUtils.ts` - Data item storage/retrieval
- `src/utils/opticalUtils.ts` - AR.IO Gateway optimistic caching
- `src/utils/signReceipt.ts` - Receipt signing (JWK-based)

## Critical Considerations

### Security
- All ANS-104 data items are signature-verified
- x402 payments use EIP-712 cryptographic signatures
- Fraud detection prevents byte-count manipulation
- Nonce-based replay attack prevention

### Performance
- BullMQ enables horizontal scaling of job workers
- PostgreSQL reader/writer separation for read scalability
- S3-compatible storage for distributed data access
- Redis caching reduces database load

### Data Integrity
- Arweave permanence guarantees immutable storage
- Bundle verification confirms on-chain posting
- Data item offsets tracked for retrieval
- Backup data items stored separately

### x402-Specific
- This is an **x402-only bundler** - no traditional payment service code
- All uploads require x402 payment (no account balances or credits)
- Facilitator URLs differ: testnet uses public facilitator, mainnet requires CDP credentials
- USDC has 6 decimals; pricing oracle converts Winston (12 decimals)
