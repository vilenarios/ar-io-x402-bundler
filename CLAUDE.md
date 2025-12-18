# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

AR.IO Bundler Lite is a lightweight Arweave ANS-104 bundler with x402 USDC payment support. It's designed for AI agents and stateless applications, requiring no account management. The service accepts data items, bundles them, posts to Arweave, and accepts x402 USDC payments.

**Key Distinction**: This is an **x402-only bundler** - there is no traditional payment service or account balance system. All payments are handled via the x402 protocol using USDC transfers with EIP-712 signatures.

## Development Commands

### Build & Run
```bash
yarn build          # Build TypeScript to JavaScript
yarn clean          # Clean build artifacts
yarn dev            # Development mode with hot reload
yarn start          # Production mode
yarn start:watch    # Watch mode (rebuild on changes)
yarn admin          # Admin dashboard (port 3002)
```

### Testing
```bash
yarn test                              # All tests
yarn test:unit                         # Unit tests only
yarn test:integration                  # Integration tests (requires Docker)
yarn test:unit --grep "pattern"        # Run tests matching pattern (case-sensitive)
yarn test:unit --grep "x402"           # Example: run all x402-related tests
yarn typecheck                         # Type checking (strict mode enabled)
```

### Code Quality
```bash
yarn lint           # Linting
yarn lint:fix       # Auto-fix lint issues
yarn format         # Format code
yarn format:check   # Check formatting
```

### Database Operations
```bash
yarn db:migrate                       # Run all migrations
yarn db:migrate:rollback              # Rollback last migration
yarn db:migrate:new migration_name    # Create new migration
```

**Important**: Migration files are created in `src/migrations/` as `.ts` files. The build process compiles them to `lib/migrations/*.js`. Always run `yarn build` before `yarn db:migrate`.

### Docker Infrastructure
```bash
yarn docker:up      # Start infrastructure (PostgreSQL, Redis, MinIO)
yarn docker:down    # Stop all services

# View logs
docker-compose logs -f bundler    # API server
docker-compose logs -f workers    # BullMQ workers
docker-compose logs -f admin      # Admin dashboard
```

## Deployment

### All-Docker Deployment (Recommended)
```bash
cp .env.sample .env
# Edit .env with ARWEAVE_WALLET_FILE (absolute path) and X402_PAYMENT_ADDRESS
./start-bundler.sh
```

**Services:**
- Bundler API: `http://localhost:3001`
- Admin Dashboard: `http://localhost:3002/admin/dashboard`
- Queue Monitor: `http://localhost:3002/admin/queues`
- MinIO Console: `http://localhost:9001`

### PM2 Deployment (Development)
```bash
yarn docker:up && yarn build && yarn db:migrate
pm2 start ecosystem.config.js
```

## Architecture Overview

### Dependency Injection Pattern

The entire architecture uses a central `Architecture` interface (`src/arch/architecture.ts`) for dependency injection. All major services receive this instance via Koa middleware (`src/middleware/architecture.ts`), enabling testability and modular component swapping.

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

**Payment Flow**:
1. **Check Free Eligibility** - If upload size ≤ `FREE_UPLOAD_LIMIT`, no payment required
2. **Get Price Quote** - POST without `X-PAYMENT` header returns 402 with payment requirements
3. **Create Payment** - Client creates EIP-712 USDC transfer signature
4. **Submit with Payment** - POST with `X-PAYMENT` header (base64-encoded JSON)
5. **Settlement** - Facilitator executes `transferWithAuthorization` on USDC contract
6. **Fraud Detection** - Byte count verification with ±5% tolerance

**Free Upload Flow** (when `FREE_UPLOAD_LIMIT > 0`):
1. Client calls `GET /v1/info` to discover `freeUploadLimitBytes`
2. If upload size ≤ `freeUploadLimitBytes`, client uploads without `X-PAYMENT` header
3. Response includes `freeUpload: true` to confirm free tier was used
4. If upload size > limit, returns 402 with payment requirements

**Payment Mode**: `payg` (pay-as-you-go) - pay only for each upload, no account balances.

**Network Support**: Base Mainnet (default), Base Sepolia (testnet), Ethereum, Polygon

### Upload API

The bundler supports two upload modes:

**Signed Uploads** (`/v1/x402/upload/signed` or `/v1/tx`):
- Client provides pre-signed ANS-104 data item
- Supports Arweave (type 1), Ethereum (type 3), Solana (type 4) signatures

**Unsigned Uploads** (`/v1/x402/upload/unsigned`):
- Client sends raw data + optional tags
- Server creates and signs ANS-104 data item using `RAW_DATA_ITEM_JWK_FILE` wallet
- Supports free uploads if size ≤ `FREE_UPLOAD_LIMIT` (no whitelist exemption)
- Supports binary upload with `X-Tag-*` headers or JSON envelope format
- See `docs/UNSIGNED_UPLOAD_TECHNICAL_BRIEF.md` for implementation details

**Request Formats for Unsigned**:
```bash
# Binary with header tags
curl -X POST /v1/x402/upload/unsigned \
  -H "Content-Type: image/png" \
  -H "X-Tag-App-Name: MyApp" \
  --data-binary @file.png

# JSON envelope
curl -X POST /v1/x402/upload/unsigned \
  -H "Content-Type: application/json" \
  -d '{"data":"<base64>","contentType":"image/png","tags":[{"name":"App-Name","value":"MyApp"}]}'
```

Enable with: `RAW_DATA_UPLOADS_ENABLED=true`

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

**Queue Configuration**:
- Redis-backed queues (separate Redis instance on port 6381)
- Job retry with exponential backoff
- Configuration in `src/arch/queues/config.ts`
- Worker concurrency tunable via `WORKER_CONCURRENCY_*` env vars (see `.env.sample`)

**Storage Cleanup**:
- `cleanup-fs` job runs on cron schedule (default: daily at 2 AM UTC)
- Tiered cleanup: filesystem (7 days), MinIO (90 days), Arweave (permanent)
- Configure via `FILESYSTEM_CLEANUP_DAYS`, `MINIO_CLEANUP_DAYS`, `CLEANUP_CRON`

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

**ANS-104 Signature Types**:
- `signatureType: 1` - Arweave (RSA-PSS 4096-bit)
- `signatureType: 3` - Ethereum (ECDSA secp256k1)
- `signatureType: 4` - Solana (Ed25519)

### x402 Network Configuration

Configured via `X402_*_ENABLED` and `X402_FACILITATORS_*` env vars:
- **Base Mainnet** - Default enabled, requires CDP credentials for Coinbase facilitator
- **Base Sepolia (testnet)** - Disabled by default, uses Mogami facilitator (no CDP needed)
- **Ethereum/Polygon Mainnet** - Disabled, must configure facilitators to enable

Each network config: `chainId`, `rpcUrl`, `usdcAddress`, `facilitatorUrls` (array for fallback)

## Code Navigation

### Entry Points
- `src/server.ts` - HTTP server bootstrap
- `src/router.ts` - Route definitions and middleware setup
- `src/jobs/allWorkers.ts` - BullMQ worker processes
- `admin-server.js` - Admin dashboard server

### API Routes (`src/router.ts`)

All routes support both root and `/v1` prefix (e.g., `/tx` and `/v1/tx`).

**Upload Endpoints (x402-only)**:
- `POST /v1/x402/upload/signed` - Explicit signed ANS-104 data item upload
- `POST /v1/x402/upload/unsigned` - Explicit unsigned raw data upload (server signs)
- `POST /v1/tx` - Legacy endpoint with auto-detection (signed vs unsigned)

**Pricing Endpoints**:
- `GET /v1/x402/price/:signatureType/:address` - Legacy price quote
- `GET /v1/price/x402/data-item/:token/:byteCount` - Turbo-style signed data item pricing
- `GET /v1/price/x402/data/:token/:byteCount` - Turbo-style unsigned data pricing

**Multipart Uploads**:
- `GET /v1/chunks/:token/-1/-1` - Create multipart upload
- `POST /v1/chunks/:token/:uploadId/:chunkOffset` - Upload chunk
- `POST /v1/chunks/:token/:uploadId/-1` - Finalize upload

**Status & Info**:
- `GET /v1/tx/:id/status` - Data item status
- `GET /v1/tx/:id/offsets` - Data item offsets
- `GET /v1/info` - Service info
- `GET /health` - Health check
- `GET /bundler_metrics` - Prometheus metrics
- `GET /api-docs` - Swagger UI (interactive API documentation)

### Route Handlers (`src/routes/`)
- `dataItemPost.ts` - Upload handlers (`signedDataItemRoute`, `unsignedDataItemRoute`, `dataItemRoute`)
- `rawDataPost.ts` - Raw data processing utilities
- `multiPartUploads.ts` - Multipart upload handling
- `status.ts`, `offsets.ts`, `info.ts` - Status/info endpoints

### x402 Routes (`src/routes/x402/`)
- `x402Price.ts` - Legacy price quote endpoint
- `x402DataItemPrice.ts` - Turbo-style signed data item pricing
- `x402RawDataPrice.ts` - Turbo-style unsigned data pricing
- `x402Payment.ts` - Payment verification
- `x402Finalize.ts` - Fraud detection with ±5% byte tolerance
- `x402PricingHelpers.ts` - Shared pricing utilities

### Job Handlers (`src/jobs/`)
All job handlers named by type: `plan.ts`, `prepare.ts`, `post.ts`, `verify.ts`, `optical-post.ts`, etc.

### Key Utilities (`src/utils/`)
- `createDataItem.ts` - ANS-104 data item creation for unsigned uploads
- `rawDataUtils.ts` - Request parsing, tag extraction from headers
- `dataItemUtils.ts` - Data item storage/retrieval
- `opticalUtils.ts` - AR.IO Gateway optimistic caching
- `signReceipt.ts` - Receipt signing (JWK-based)
- `x402Pricing.ts` - Winston ↔ USDC conversion

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
- Unit tests colocated with source: `*.test.ts` files in `src/` (e.g., `bundlePacker.test.ts` next to `bundlePacker.ts`)
- Integration tests in `tests/` directory
- Mocha + Chai for assertions
- Tests require ts-node for TypeScript execution
- Run single test: `yarn test:unit --grep "pattern"` (case-sensitive regex match on test description)

### Migrations
- Knex migrations in `src/migrations/` (TypeScript)
- Migration config in `src/arch/db/knexfile.ts`
- Migrations compile to `lib/migrations/*.js`
- Run on startup if `MIGRATE_ON_STARTUP=true`
- **Important**: Only load `.js` migration files (TypeScript files are excluded via filter)
- Create new migration: `yarn db:migrate:new migration_name` (creates TypeScript file in `src/migrations/`)
- Always `yarn build` before `yarn db:migrate` (migrations run from compiled `lib/` directory)

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
- Uploads ≤ `FREE_UPLOAD_LIMIT` are free; larger uploads require x402 payment
- Default `FREE_UPLOAD_LIMIT=0` in docker-compose.yml means all uploads require payment
- Facilitator URLs differ: testnet uses public facilitator, mainnet requires CDP credentials
- USDC has 6 decimals; pricing oracle converts from Winston (12 decimals)

### Security
- All ANS-104 data items are signature-verified
- x402 payments use EIP-712 cryptographic signatures
- ERC-1271 smart contract wallet signature verification supported
- Fraud detection prevents byte-count manipulation (±5% tolerance)
- Nonce-based replay attack prevention

### Performance
- BullMQ enables horizontal scaling of job workers
- PostgreSQL reader/writer separation for read scalability
- S3-compatible storage for distributed data access
- Redis caching reduces database load

### Redis Architecture
Two separate Redis instances:
- **Cache Redis** (port 6379) - Used by `CacheService` for caching
- **Queue Redis** (port 6381) - Used by BullMQ for job queues

This separation prevents cache eviction from affecting job queue data.

## TypeScript Configuration

- **Strict mode enabled** - All strict checks are on (`strict: true` in tsconfig.json)
- **Target**: ES2022 with CommonJS module output
- **Output**: Compiled to `lib/` directory
- **Path aliases**: None - use relative imports

## Documentation References

- `README.md` - Quick start, API examples, troubleshooting
- `ADMIN.md` - Complete administration and operations guide (deployment, monitoring, scaling, storage management)
- `docs/UNSIGNED_UPLOAD_TECHNICAL_BRIEF.md` - Detailed unsigned upload implementation
- `.env.sample` - All environment variables with descriptions
