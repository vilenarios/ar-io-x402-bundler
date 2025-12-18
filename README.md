# AR.IO x402 Bundler

**Lightweight Arweave ANS-104 bundler with x402 USDC payments - designed for AI agents and stateless applications.**

No account management required. Pay per upload with USDC via the x402 protocol.

## Quick Start

### Prerequisites

- **Docker** & **Docker Compose**
- **Arweave Wallet** (JWK file for bundle signing)
- **EVM Address** (for receiving USDC payments)

### Setup

```bash
# Interactive setup (recommended)
./setup-bundler.sh

# Or manual setup
cp .env.sample .env
# Edit .env: set ARWEAVE_WALLET_FILE (absolute path) and X402_PAYMENT_ADDRESS
./start-bundler.sh
```

**Services:**
| Service | URL |
|---------|-----|
| Bundler API | http://localhost:3001 |
| Admin Dashboard | http://localhost:3002/admin/dashboard |
| Queue Monitor | http://localhost:3002/admin/queues |
| API Docs (Swagger) | http://localhost:3001/api-docs |
| MinIO Console | http://localhost:9001 |

```bash
./stop-bundler.sh              # Stop (keep data)
./stop-bundler.sh --clean      # Stop and delete all data
```

## Configuration

### Required Environment Variables

```bash
# Arweave wallet - MUST be absolute path
ARWEAVE_WALLET_FILE=/absolute/path/to/wallet.json

# Your Ethereum address to receive USDC payments
X402_PAYMENT_ADDRESS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1

# REQUIRED FOR PRODUCTION: Public URL of your bundler
# Payment flows require this to generate correct payment requests
UPLOAD_SERVICE_PUBLIC_URL=https://upload.yourdomain.com

# Admin dashboard password (generate with: openssl rand -hex 32)
ADMIN_PASSWORD=your-secure-password
```

### x402 Network Configuration

```bash
# Base mainnet (default) - requires CDP credentials
CDP_API_KEY_ID=your-cdp-key-id
CDP_API_KEY_SECRET=your-cdp-secret

# Base Sepolia testnet - works without CDP credentials
X402_BASE_TESTNET_ENABLED=true
```

See [.env.sample](./.env.sample) for all configuration options.

## API Reference

### Upload Endpoints

All endpoints support both root and `/v1` prefix.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/x402/upload/signed` | Upload pre-signed ANS-104 data item |
| POST | `/v1/x402/upload/unsigned` | Upload raw data (server signs) |
| POST | `/v1/tx` | Legacy endpoint with auto-detection |

### Pricing Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/price/x402/data-item/:token/:byteCount` | Price for signed data item |
| GET | `/v1/price/x402/data/:token/:byteCount` | Price for unsigned raw data |
| GET | `/v1/x402/price/:signatureType/:address` | Legacy price quote |

### Status & Info

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/tx/:id/status` | Data item status |
| GET | `/v1/info` | Service info |
| GET | `/health` | Health check |
| GET | `/bundler_metrics` | Prometheus metrics |
| GET | `/api-docs` | Swagger UI |

### x402 Payment Flow

1. **Request without payment** → Returns `402 Payment Required` with pricing
2. **Create EIP-712 signature** for USDC `transferWithAuthorization`
3. **Retry with `X-PAYMENT` header** (base64-encoded payment payload)
4. **Success** → Returns receipt with data item ID

See [docs/UNSIGNED_UPLOAD_TECHNICAL_BRIEF.md](./docs/UNSIGNED_UPLOAD_TECHNICAL_BRIEF.md) for detailed implementation.

### Example: Upload with x402

```bash
# 1. Get price quote (returns 402 with payment requirements)
curl -X POST "http://localhost:3001/v1/tx" \
  -H "Content-Type: application/octet-stream" \
  -H "Content-Length: 1024" \
  --data-binary @mydata.bin

# 2. Upload with payment
curl -X POST "http://localhost:3001/v1/tx" \
  -H "Content-Type: application/octet-stream" \
  -H "X-PAYMENT: <base64-payment-payload>" \
  --data-binary @mydata.bin
```

## Development

```bash
yarn install
yarn docker:up          # Start infrastructure
yarn build
yarn db:migrate
yarn dev                # Development mode with hot reload
```

### Commands

| Command | Description |
|---------|-------------|
| `yarn build` | Build TypeScript |
| `yarn dev` | Development mode |
| `yarn test` | Run all tests |
| `yarn test:unit` | Unit tests only |
| `yarn test:unit --grep "name"` | Single test by name |
| `yarn lint` | Linting |
| `yarn typecheck` | Type checking |
| `yarn db:migrate` | Run migrations |

### PM2 Deployment

```bash
yarn docker:up && yarn build && yarn db:migrate
pm2 start ecosystem.config.js
```

## Architecture

- **x402-only** - No traditional payment service or account balances
- **BullMQ** - Job queue for async bundling pipeline
- **PostgreSQL** - Data item and payment tracking
- **Redis** - Caching (port 6379) and job queues (port 6381)
- **S3/MinIO** - Object storage with tiered cleanup

See [CLAUDE.md](./CLAUDE.md) for detailed architecture documentation.

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Wallet path errors | `ARWEAVE_WALLET_FILE` must be **absolute path** |
| Database name error | Must be `bundler_lite` (not `bundler`) |
| EIP-712 signature invalid | Domain must match USDC contract exactly |
| Payment flow fails | Set `UPLOAD_SERVICE_PUBLIC_URL` for production |

See [ADMIN.md](./ADMIN.md) for complete troubleshooting guide.

## Documentation

| Document | Description |
|----------|-------------|
| [ADMIN.md](./ADMIN.md) | Operations, monitoring, troubleshooting |
| [CLAUDE.md](./CLAUDE.md) | Architecture and code navigation |
| [docs/UNSIGNED_UPLOAD_TECHNICAL_BRIEF.md](./docs/UNSIGNED_UPLOAD_TECHNICAL_BRIEF.md) | Unsigned upload implementation |
| [.env.sample](./.env.sample) | All environment variables |

## Support

- **Issues**: https://github.com/ar-io/ar-io-x402-bundler/issues
- **Discord**: https://discord.gg/ario
- **Docs**: https://docs.ar.io

## License

AGPL-3.0 - See [LICENSE](./LICENSE)
