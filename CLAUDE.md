# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

AR.IO Bundler Lite is a lightweight Arweave ANS-104 bundler with x402 USDC payment support. It's designed for AI agents and stateless applications, requiring no account management. The service accepts data items, bundles them, posts to Arweave, and accepts x402 USDC payments.

**Key Distinction**: This is an **x402-only bundler** - there is no traditional payment service or account balance system. All payments are handled via the x402 protocol using USDC transfers with EIP-712 signatures.

## Development Commands

### Build & Run
```bash
# Build TypeScript to JavaScript
yarn build

# Clean build artifacts
yarn clean

# Development mode with hot reload
yarn dev

# Production mode
yarn start

# Watch mode (rebuild on changes)
yarn start:watch

# Admin dashboard (port 3002)
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

### Database Operations
```bash
# Run all migrations
yarn db:migrate

# Rollback last migration
yarn db:migrate:rollback

# Create new migration (creates .ts file in src/migrations/)
yarn db:migrate:new migration_name
```

**Important**: Migration files are created in `src/migrations/` as `.ts` files. The build process compiles them to `lib/migrations/*.js`. The knexfile references the compiled JS migrations in `lib/migrations/`.

### Docker Infrastructure
```bash
# Start infrastructure (PostgreSQL, Redis, MinIO)
yarn docker:up

# Stop all services
yarn docker:down
```

## Deployment

### All-Docker Deployment (Recommended)
```bash
cp .env.sample .env
# Edit .env with ARWEAVE_WALLET_FILE (absolute path) and X402_PAYMENT_ADDRESS
./start-bundler.sh
```

This starts everything: PostgreSQL, Redis (cache + queue), MinIO, Bundler API, Workers, and Admin Dashboard.

**Services:**
- Bundler API: `http://localhost:3001`
- Admin Dashboard: `http://localhost:3002/admin/dashboard`
- Queue Monitor: `http://localhost:3002/admin/queues`
- MinIO Console: `http://localhost:9001`

### PM2 Deployment (Development)
```bash
yarn docker:up     # Start infrastructure
yarn build         # Compile TypeScript
yarn db:migrate    # Run migrations
pm2 start ecosystem.config.js
```

**PM2 Services** (defined in `ecosystem.config.js`):
- `upload-api` - HTTP API server (2 cluster instances)
- `upload-workers` - BullMQ job workers (all 11 queues)
- `bull-board` - Admin dashboard and Bull Board UI

## Architecture Overview

### Dependency Injection Pattern

The entire architecture uses a central `Architecture` interface (`src/arch/architecture.ts`) for dependency injection:

```typescript
export interface Architecture {
  objectStore: ObjectStore;           // S3-compatible storage
  database: Database;                  // PostgreSQL for data items
  dataItemOffsetsDB: DataItemOffsetsDB; // Offsets tracking
  cacheService: CacheService;          // Redis cache
  x402Service: X402Service;            // x402 payment handling
  logger: winston.Logger;              // Winston logger
  arweaveGateway: ArweaveGateway;     // Arweave API client
  getArweaveWallet: () => Promise<JWKInterface>;
  getRawDataItemWallet: () => Promise<JWKInterface>;
  tracer?: Tracer;                     // OpenTelemetry tracing
}
```

All major services receive the `Architecture` instance via Koa middleware (`src/middleware/architecture.ts`), enabling testability and modular component swapping.

### Database Layer

**PostgreSQL with Knex.js** (`src/arch/db/`)
- Two database instances: `database` (data items) and `dataItemOffsetsDB` (offsets)
- Reader/writer separation for read scalability
- Migrations in `src/migrations/*.ts` (compiled to `lib/migrations/*.js`)

**Key Tables**:
- `new_data_item` - Uploaded items awaiting bundling
- `planned_data_item` - Items queued for bundling
- `permanent_data_item` - Successfully bundled items (partitioned by upload_date)
- `bundle_plan` - Bundle planning records
- `posted_bundle` - Bundle transaction records
- `x402_payments` - Payment tracking with fraud detection
- `data_item_offsets` - Byte offsets for data item retrieval

**Important**: The database name is `bundler_lite` (not `bundler`). This is configured in `.env` as `DB_DATABASE=bundler_lite`.

### Object Storage

**S3-Compatible Storage** (`src/arch/objectStore.ts`, `src/arch/s3ObjectStore.ts`)
- Abstraction: `ObjectStore` interface with S3 and FileSystem implementations
- Two buckets: `raw-data-items` (uploaded data), `backup-data-items` (backups)
- MinIO for local development, AWS S3 for production

### x402 Payment System

**Core Components**:
- `X402Service` (`src/arch/x402Service.ts`) - Verifies payments, settles USDC via facilitator
- `X402PricingOracle` (`src/x402/x402PricingOracle.ts`) - Converts Winston (AR pricing) to USDC atomic units

**Getting Price Quotes** (Two Methods):
1. **Dedicated Pricing Endpoint** (`src/routes/x402/x402Price.ts`) - GET request returns 200 OK with payment requirements
   - Example: `GET /v1/x402/price/3/0xAddress?bytes=1024`
   - No data upload needed, just query parameters
2. **Upload Endpoint Without Payment** (`src/routes/dataItemPost.ts`) - POST request returns 402 with payment requirements
   - Example: `POST /v1/tx` with `Content-Length` header but no `X-PAYMENT` header
   - Returns 402 Payment Required with full pricing details
   - Pricing calculated from `Content-Length` header

**Payment Flow**:
1. **Get Price Quote** - Use either method above to get payment requirements
2. **Payment Verification** (`src/routes/x402/x402Payment.ts`) - Verifies EIP-712 signature, settles USDC
3. **Finalization** (`src/routes/x402/x402Finalize.ts`) - Fraud detection with ±5% byte count tolerance

**Payment Modes**:
- `payg` - Pay-as-you-go (pay only for this upload)
- `topup` - Credit account balance (requires account - not used in lite version)
- `hybrid` - Pay for upload + excess tops up balance (not used in lite version)

**Network Support**: Base Sepolia (testnet - default), Base Mainnet, Ethereum, Polygon

### Job Queue System

**BullMQ Pipeline** (`src/jobs/`, `src/arch/queues.ts`)

```
Upload → new-data-item → plan-bundle → prepare-bundle → post-bundle → verify-bundle
              ↓              ↓
        optical-post   unbundle-bdi
                           ↓
                      cleanup-fs
```

**Job Workers** (`src/jobs/allWorkers.ts`):
- `new-data-item` - Process uploads, store in S3
- `plan-bundle` - Group data items using `BundlePacker`
- `prepare-bundle` - Download items, assemble ANS-104 bundles
- `post-bundle` - Post bundles to Arweave network
- `verify-bundle` - Confirm bundle posting
- `optical-post` - AR.IO Gateway optimistic caching
- `unbundle-bdi` - Extract nested bundle data items
- `cleanup-fs` - Remove temporary filesystem artifacts
- `put-offsets` - Write data item offset information
- `finalize-upload` - Complete multipart upload flow
- `seed` - Seeding job for initial data

**Queue Configuration**:
- Redis-backed queues (separate Redis instance on port 6381)
- Job retry with exponential backoff
- Configuration in `src/arch/queues/config.ts`

### Bundle Packing Strategy

**BundlePacker** (`src/bundles/bundlePacker.ts`)
- Target size: 2 GiB (configurable via `MAX_BUNDLE_SIZE`)
- Max items per bundle: 10,000 (configurable via `MAX_DATA_ITEM_LIMIT`)
- Separates bundles by "premium feature type" (dedicated bundle types)
- Handles overdue items separately for expedited processing
- "Underweight" bundles held back until more items arrive

### Data Flow

**Upload Flow** (`src/routes/dataItemPost.ts`):
1. Client POSTs ANS-104 data item to `/v1/tx` with `Content-Length` header
2. If no `X-PAYMENT` header → return 402 with **full payment requirements** (USDC amount, networks, etc.)
   - Pricing calculated from `Content-Length` header
   - Client can use this response to create payment signature
3. If `X-PAYMENT` header → verify x402 payment signature
4. Store data item in S3 object storage
5. Insert record into `new_data_item` table
6. Enqueue `new-data-item` job
7. Return signed receipt with data item ID and payment confirmation

**Bundling Flow**:
1. `plan-bundle` job fetches unbundled items from DB
2. `BundlePacker` groups items into optimal bundle plans
3. `prepare-bundle` downloads items from S3, assembles ANS-104 bundle
4. `post-bundle` posts bundle transaction to Arweave
5. `verify-bundle` confirms bundle on Arweave blockchain
6. Items transition: `new` → `pending` → `finalized` → `permanent`

## Key Configuration

### Critical Environment Variables

**Arweave** (see `.env.sample`):
- `ARWEAVE_WALLET_FILE` - **MUST be absolute path** to Arweave wallet JWK (for bundle signing)
- `ARWEAVE_GATEWAY` - Gateway for posting bundles (default: https://arweave.net)
- `PUBLIC_ACCESS_GATEWAY` - Gateway advertised to users (shown in info endpoint)

**x402 Payment**:
- `X402_PAYMENT_ADDRESS` - Your Ethereum address for receiving USDC (required)
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` - Coinbase CDP credentials (required for mainnet, optional for testnet)
- `X402_FRAUD_TOLERANCE_PERCENT` - Byte count tolerance for fraud detection (default: 5%)
- `X402_FEE_PERCENT` - Bundler fee / profit margin on top of Arweave costs (default: 30%)

**Database**:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` - PostgreSQL connection
- `DB_DATABASE` - Database name (must be `bundler_lite`)

**Redis**:
- `ELASTICACHE_HOST`, `ELASTICACHE_PORT` - Redis for caching (default: port 6379)
- `REDIS_HOST`, `REDIS_PORT_QUEUES` - Redis for BullMQ (default: port 6381)

**Object Storage**:
- `AWS_ENDPOINT` - MinIO/S3 endpoint (default: http://localhost:9000)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` - S3 credentials
- `DATA_ITEM_BUCKET` - S3 bucket name (default: bundler-data-items)

### Important Constants (`src/constants.ts`)

**Size Limits**:
- `maxBundleDataItemsByteCount` - Target bundle size (default: 2 GiB)
- `maxSingleDataItemByteCount` - Max upload size (default: 4 GiB)
- `maxDataItemsPerBundle` - Max items per bundle (default: 10,000)
- `freeUploadLimitBytes` - Free upload limit (default: ~505 KiB)

**Arweave Configuration**:
- `deadlineHeightIncrement` - Block height deadline (default: 200 blocks)
- `gatewayUrl` - Arweave gateway for verification
- `arweaveUploadNode` - Upload node for chunks (separate from gateway)

**ANS-104 Signature Types**:
- `signatureType: 1` - Arweave (RSA-PSS 4096-bit)
- `signatureType: 3` - Ethereum (ECDSA secp256k1)
- `signatureType: 4` - Solana (Ed25519)

### x402 Network Configuration

Configured via environment variables or `X402_NETWORKS` JSON:
- **Base Sepolia (testnet)** - Default, uses public facilitator (https://x402.org/facilitator)
- **Base Mainnet** - Requires CDP credentials
- **Ethereum Mainnet** - Supports USDC payments
- **Polygon Mainnet** - Supports USDC payments

Each network has: `chainId`, `rpcUrl`, `usdcAddress`, `facilitatorUrls` (array for multi-facilitator fallback support)

## Code Navigation

### Entry Points
- `src/server.ts` - HTTP server bootstrap
- `src/router.ts` - Route definitions and middleware setup
- `src/jobs/allWorkers.ts` - BullMQ worker processes
- `admin-server.js` - Admin dashboard server

### Core Routes (`src/routes/`)
- `dataItemPost.ts` - Upload endpoint (`POST /v1/tx`)
- `rawDataPost.ts` - Raw data upload endpoint
- `multiPartUploads.ts` - Multipart upload handling
- `status.ts` - Data item status endpoint
- `offsets.ts` - Data item offset endpoint
- `info.ts` - Service info endpoint

### x402 Routes (`src/routes/x402/`)
- `x402Price.ts` - Price quote endpoint (`GET /v1/x402/price/{signatureType}/{address}`)
- `x402Payment.ts` - Payment verification endpoint
- `x402Finalize.ts` - Payment finalization with fraud detection

### Job Handlers (`src/jobs/`)
All job handlers are in the `src/jobs/` directory, named by job type: `plan.ts`, `prepare.ts`, `post.ts`, `verify.ts`, etc.

### Utilities (`src/utils/`)
- `common.ts` - Common helper functions
- `dataItemUtils.ts` - Data item storage/retrieval
- `opticalUtils.ts` - AR.IO Gateway optimistic caching
- `signReceipt.ts` - Receipt signing (JWK-based)
- `x402Pricing.ts` - x402 pricing calculations

## Development Patterns

### Logging
- Winston logger exported from `src/logger.ts`
- Child loggers with context: `logger.child({ job: 'plan-bundle-job' })`
- All logs include trace IDs (via `loggerMiddleware`)
- Log levels: error, warn, info, debug

### Error Handling
- Custom error classes in `src/utils/errors.ts`
- Metrics tracked via `MetricRegistry` (Prometheus format)
- Uncaught exceptions logged and counted

### Testing
- Unit tests colocated with source: `*.test.ts` files in `src/`
- Integration tests in `tests/` directory
- Mocha + Chai for assertions
- Tests require ts-node for TypeScript execution

### Migrations
- Knex migrations in `src/migrations/` (TypeScript)
- Migration config in `src/arch/db/knexfile.ts`
- Migrations compile to `lib/migrations/*.js`
- Run on startup if `MIGRATE_ON_STARTUP=true`
- **Important**: Only load `.js` migration files (TypeScript files are excluded via filter)

## Common Development Tasks

### Running Locally
1. Start infrastructure: `yarn docker:up`
2. Configure `.env` (copy from `.env.sample`)
3. Set `ARWEAVE_WALLET_FILE` to **absolute path** of Arweave wallet
4. Set `X402_PAYMENT_ADDRESS` to your Ethereum address
5. Run migrations: `yarn db:migrate`
6. Build: `yarn build`
7. Start bundler: `yarn start` (port 3001)
8. Start admin dashboard: `yarn admin` (port 3002)

### Admin Dashboard
- Dashboard: `http://localhost:3002/admin/dashboard`
- Queue Monitor: `http://localhost:3002/admin/queues` (Bull Board)
- Authentication: Basic Auth (`ADMIN_USERNAME`/`ADMIN_PASSWORD` from .env)
- Real-time stats: uploads, x402 payments, bundles, system health

### Debugging x402 Payments
- Check payment records: `SELECT * FROM x402_payments ORDER BY created_at DESC;`
- Check payment by data item: `SELECT * FROM x402_payments WHERE upload_id = 'data_item_id';`
- Verify fraud detection: Check `actual_byte_count` vs `declared_byte_count` in `x402_payments` table

### Adding New Migrations
```bash
# Create new migration file
yarn db:migrate:new add_new_feature

# Edit the generated file in src/migrations/
# Run migration
yarn build && yarn db:migrate
```

### Monitoring BullMQ Jobs
- Access Bull Board: `http://localhost:3002/admin/queues`
- View job status: waiting, active, completed, failed
- Retry failed jobs manually
- Inspect job data and error logs

## Common Issues

### Build & Configuration
- **Wallet path errors**: `ARWEAVE_WALLET_FILE` must be absolute path, not relative
- **Database name**: Must be `bundler_lite` in all configs (`.env`, `ecosystem.config.js`)
- **Migration errors**: Ensure PostgreSQL is running before `yarn db:migrate`
- **TypeScript errors**: Run `yarn clean && yarn build` to rebuild

### x402 Payments
- **EIP-712 signature errors**: Verify domain exactly matches USDC contract (name, version, chainId, verifyingContract)
- **Facilitator errors**: Testnet uses public facilitator (no CDP needed), mainnet requires CDP credentials
- **Fraud penalties**: Ensure `Content-Length` header matches actual data size (±5% tolerance)

### Infrastructure
- **Redis errors**: Ensure both Redis instances are running (cache on 6379, queue on 6381)
- **MinIO errors**: Verify MinIO is running on port 9000
- **PostgreSQL errors**: Check connection settings in `.env`

### Docker
- **Port conflicts**: Check if ports 3001, 3002, 5432, 6379, 6381, 9000, 9001 are available
- **Volume issues**: Use `docker-compose down -v` to clean volumes
- **Build errors**: Use `docker-compose up -d --build` to rebuild images

## Critical Architectural Notes

### x402-Specific Considerations
- This bundler is **x402-only** - no traditional payment service or account balances
- All uploads require x402 payment (no free uploads except within `FREE_UPLOAD_LIMIT`)
- Facilitator URLs differ: testnet uses public facilitator, mainnet requires CDP credentials
- USDC has 6 decimals; pricing oracle converts from Winston (12 decimals)

### Security
- All ANS-104 data items are signature-verified
- x402 payments use EIP-712 cryptographic signatures
- Fraud detection prevents byte-count manipulation (±5% tolerance)
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
- Backup data items stored separately in S3

### Redis Architecture
Two separate Redis instances:
- **Cache Redis** (port 6379) - Used by `CacheService` for caching
- **Queue Redis** (port 6381) - Used by BullMQ for job queues

This separation prevents cache eviction from affecting job queue data.
