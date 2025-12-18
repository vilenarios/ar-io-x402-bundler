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

Each network must be explicitly enabled. By default, only Base mainnet is enabled.

```bash
# Network Enable/Disable (set to "true" or "false")
X402_BASE_ENABLED=true              # Base mainnet (default: true)
X402_BASE_TESTNET_ENABLED=false     # Base Sepolia testnet (default: false)
X402_ETH_ENABLED=false              # Ethereum mainnet (default: false)
X402_POLYGON_ENABLED=false          # Polygon mainnet (default: false)

# CDP Credentials (required for Base mainnet, not needed for testnet)
CDP_API_KEY_ID=your-cdp-key-id
CDP_API_KEY_SECRET=your-cdp-secret
```

**For testnet development (Base Sepolia):**
```bash
X402_BASE_TESTNET_ENABLED=true      # Enable testnet
X402_BASE_ENABLED=false             # Disable mainnet (optional)
# No CDP credentials needed for testnet!
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

## Local Testing Guide

### Quick Setup for Local Testing

```bash
# Add to your .env:
X402_BASE_TESTNET_ENABLED=true          # Enable Base Sepolia testnet
X402_BASE_ENABLED=false                 # Disable mainnet (optional)
UPLOAD_SERVICE_PUBLIC_URL=http://localhost:3001  # Default, explicit for clarity

# Optional: Enable free uploads to skip payment during testing
FREE_UPLOAD_LIMIT=1000000               # 1MB free (0 = require payment for all)

# Optional: Disable optical bridging if no local gateway
OPTICAL_BRIDGING_ENABLED=false
```

### Important Considerations

#### 1. Arweave Wallet Needs AR Balance

Even with testnet x402 payments, bundles are posted to **mainnet Arweave**. Your wallet needs AR:

```bash
# Check wallet balance (get address first)
arweave-key-tool info wallet.json
curl https://arweave.net/wallet/<YOUR_ADDRESS>/balance
```

If empty, bundles will fail at the `post-bundle` stage.

#### 2. `UPLOAD_SERVICE_PUBLIC_URL` Must Match Client

The x402 payment signature includes a `resource` URL. Client and bundler must agree:

```bash
# Bundler expects (from UPLOAD_SERVICE_PUBLIC_URL):
http://localhost:3001/v1/x402/upload/signed

# Client must sign payment for the SAME URL
# If these don't match, payment verification fails
```

**For localhost testing**, the default `http://localhost:3001` works fine - the facilitator does NOT call back to this URL, it's only for signature verification.

#### 3. Optical Bridging with Local Gateway

If testing with a local AR.IO gateway, use the host's IP (not `localhost`):

```bash
# From Docker, localhost = the container, not your machine
# Use your machine's LAN IP:
OPTICAL_BRIDGE_URL=http://192.168.1.100:3000/ar-io/admin/queue-data-item

# Or disable if not using a gateway:
OPTICAL_BRIDGING_ENABLED=false
```

#### 4. Free Upload Limit for Quick Testing

To test uploads without x402 payments:

```bash
FREE_UPLOAD_LIMIT=1000000    # Uploads under 1MB are free
```

Set back to `0` for production.

### Verify Your Setup

```bash
# 1. Health check
curl http://localhost:3001/health

# 2. Check enabled networks (should show base-sepolia)
curl http://localhost:3001/v1/info | jq '.x402'

# 3. Get price quote
curl "http://localhost:3001/v1/price/x402/data-item/arweave/1024"

# 4. Check admin dashboard
open http://localhost:3002/admin/dashboard
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
