# AR.IO x402 Bundler Documentation

Complete documentation for the AR.IO x402 Bundler.

## 📖 Documentation Files

### Quick Start
- **[../README.md](../README.md)** - Main project README with quick start guide
- **[DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)** - Complete Docker deployment guide (recommended)

### Deployment Guides
- **[DEPLOYMENT_OPTIONS.md](./DEPLOYMENT_OPTIONS.md)** - Compare deployment methods (All-Docker vs PM2 vs Hybrid)
- **[SIMPLIFIED_DEPLOYMENT_SUMMARY.md](./SIMPLIFIED_DEPLOYMENT_SUMMARY.md)** - Summary of recent deployment improvements

### Technical Documentation
- **[X402_TWO_STAGE_PAYMENT.md](./X402_TWO_STAGE_PAYMENT.md)** - x402 payment protocol details and two-stage payment flow
- **[CLAUDE.md](./CLAUDE.md)** - Architecture guide for Claude Code AI assistant

## 🚀 Quick Links

**Get started in 3 commands:**
```bash
cp .env.sample .env
# Edit .env with your wallet and payment address
./start-bundler.sh
```

**See:** [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) for complete setup guide.

## 📂 Repository Structure

```
ar-io-x402-bundler/
├── docs/                       # Documentation (you are here)
│   ├── CLAUDE.md              # Architecture for AI assistants
│   ├── DEPLOYMENT_OPTIONS.md  # Deployment comparison
│   ├── DOCKER_DEPLOYMENT.md   # Docker deployment guide
│   ├── SIMPLIFIED_DEPLOYMENT_SUMMARY.md  # Recent changes
│   └── X402_TWO_STAGE_PAYMENT.md  # x402 protocol details
├── scripts/                    # Helper scripts
│   ├── quick-start.sh         # Automated setup script
│   ├── start.sh               # PM2 startup script
│   ├── stop.sh                # PM2 stop script
│   └── ...
├── src/                        # TypeScript source code
├── start-bundler.sh           # Main Docker start script
├── stop-bundler.sh            # Main Docker stop script
├── README.md                  # Main project README
└── ...
```

## 🛠️ Deployment Methods

### 1. All-Docker (Recommended)
Simplest - everything in containers:
```bash
./start-bundler.sh
```

### 2. CLI with Flags
Automated setup with command-line arguments:
```bash
./scripts/quick-start.sh --wallet ./wallet.json --x402-address 0xYourAddress
```

### 3. PM2 Deployment
For development/debugging:
```bash
yarn install && yarn docker:up && yarn build
pm2 start ecosystem.config.js
```

See [DEPLOYMENT_OPTIONS.md](./DEPLOYMENT_OPTIONS.md) for detailed comparison.
