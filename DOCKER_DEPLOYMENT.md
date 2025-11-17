# Docker Deployment Guide

**Simplified all-Docker deployment for AR.IO x402 Bundler - No PM2 required!**

This guide covers the recommended standalone Docker deployment using `docker-compose`. Everything runs in containers with simple start/stop scripts.

---

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [What's Included](#whats-included)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Deployment Methods](#deployment-methods)
- [Service Management](#service-management)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Upgrading](#upgrading)

---

## 🚀 Quick Start

**Get up and running in 3 commands:**

```bash
# 1. Configure environment
cp .env.sample .env
# Edit .env - set ARWEAVE_WALLET_FILE and X402_PAYMENT_ADDRESS

# 2. Start everything
./start-bundler.sh

# 3. Check status
docker-compose ps
```

**That's it!** The bundler is now running at `http://localhost:3001`

---

## 📦 What's Included

The Docker setup includes **6 services**:

| Service | Description | Port |
|---------|-------------|------|
| **postgres** | PostgreSQL 16 database | 5432 |
| **redis-cache** | Redis cache layer | 6379 |
| **redis-queue** | Redis for BullMQ job queues | 6381 |
| **minio** | S3-compatible object storage | 9000, 9001 |
| **bundler** | Main API server (Koa) | 3001 |
| **workers** | BullMQ job processors | - |
| **admin** | Admin dashboard & queue monitor | 3002 |

**Architecture:**
```
┌─────────────────────────────────────────────────────┐
│                Docker Network                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │PostgreSQL│  │  Redis   │  │  MinIO   │          │
│  │  (DB)    │  │ (Cache)  │  │  (S3)    │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │             │             │                  │
│  ┌────┴─────────────┴─────────────┴─────┐          │
│  │        Bundler API (Port 3001)        │          │
│  └────┬──────────────────────────────────┘          │
│       │                                              │
│  ┌────┴────────┐  ┌───────────────┐                │
│  │   Workers   │  │ Admin (3002)  │                │
│  │  (BullMQ)   │  │  Dashboard    │                │
│  └─────────────┘  └───────────────┘                │
└─────────────────────────────────────────────────────┘
```

---

## 📝 Prerequisites

**Required:**
- Docker Engine 20.10+
- Docker Compose 2.0+
- Arweave wallet (JWK file)
- 4GB+ available RAM
- 20GB+ available disk space

**Optional:**
- Ethereum address (for receiving x402 USDC payments)
- Coinbase CDP credentials (for mainnet only)

**Check prerequisites:**
```bash
docker --version          # Docker 20.10+
docker-compose --version  # Docker Compose 2.0+
```

---

## ⚙️ Configuration

### Step 1: Create `.env` file

```bash
cp .env.sample .env
```

### Step 2: Required Configuration

**Edit `.env` and set these required variables:**

```bash
# REQUIRED: Absolute path to your Arweave wallet
ARWEAVE_WALLET_FILE=/absolute/path/to/your/wallet.json

# REQUIRED: Your Ethereum address for USDC payments
X402_PAYMENT_ADDRESS=0xYourEthereumAddress

# REQUIRED: Admin dashboard password
ADMIN_PASSWORD=$(openssl rand -hex 32)
```

### Step 3: Network Selection

**For Testnet (Base Sepolia) - Default:**
```bash
# Already set in .env.sample - no changes needed
X402_NETWORKS={"base-sepolia":{"enabled":true,"rpcUrl":"https://sepolia.base.org","usdcAddress":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","facilitatorUrl":"https://x402.org/facilitator"}}
```

**For Mainnet (Base):**
```bash
# Uncomment in .env and add CDP credentials
X402_NETWORKS={"base":{"enabled":true,"rpcUrl":"https://mainnet.base.org","usdcAddress":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","facilitatorUrl":"https://facilitator.base.coinbasecloud.net"}}

# REQUIRED for mainnet:
CDP_API_KEY_ID=your-cdp-key-id
CDP_API_KEY_SECRET=your-cdp-secret
```

Get CDP credentials from: https://portal.cdp.coinbase.com/

---

## 🚀 Deployment Methods

### Method 1: Simple Start Script (Recommended)

**Use the provided start script:**

```bash
# Start everything
./start-bundler.sh

# Rebuild and start
./start-bundler.sh --build

# Stop everything
./stop-bundler.sh

# Stop and remove all data
./stop-bundler.sh --clean
```

**What the script does:**
1. Validates configuration
2. Checks wallet file exists
3. Generates admin password if missing
4. Starts all Docker services
5. Runs database migrations
6. Shows service URLs and credentials

### Method 2: Manual Docker Compose

**Full control with docker-compose commands:**

```bash
# Start all services in background
docker-compose up -d

# View logs (follow mode)
docker-compose logs -f

# Run database migrations (one-time)
docker-compose exec bundler yarn db:migrate

# Check service health
docker-compose ps

# Stop all services
docker-compose down

# Stop and remove volumes (CAUTION: deletes all data)
docker-compose down -v
```

### Method 3: Production Deployment

**For production environments:**

1. **Use production environment variables:**
   ```bash
   NODE_ENV=production
   LOG_LEVEL=warn
   ```

2. **Set resource limits** in `docker-compose.yml`:
   ```yaml
   bundler:
     deploy:
       resources:
         limits:
           cpus: '2'
           memory: 4G
         reservations:
           cpus: '1'
           memory: 2G
   ```

3. **Enable health checks:**
   ```bash
   # Health checks are already configured in docker-compose.yml
   docker-compose ps  # View health status
   ```

4. **Configure log rotation:**
   ```yaml
   bundler:
     logging:
       driver: "json-file"
       options:
         max-size: "10m"
         max-file: "3"
   ```

---

## 🔧 Service Management

### Start/Stop Services

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d bundler

# Stop all services
docker-compose stop

# Restart specific service
docker-compose restart bundler

# Restart workers to pick up new jobs
docker-compose restart workers
```

### View Logs

```bash
# All services (follow mode)
docker-compose logs -f

# Specific service
docker-compose logs -f bundler
docker-compose logs -f workers

# Last 100 lines
docker-compose logs --tail=100 bundler

# Logs with timestamps
docker-compose logs -f -t bundler
```

### Execute Commands in Containers

```bash
# Run database migration
docker-compose exec bundler yarn db:migrate

# Access PostgreSQL
docker-compose exec postgres psql -U postgres -d bundler_lite

# Access Redis CLI
docker-compose exec redis-cache redis-cli

# Access MinIO Console (web browser)
open http://localhost:9001
# Login: minioadmin / minioadmin
```

### Service Health

```bash
# Check all service status
docker-compose ps

# Check specific service health
docker inspect bundler-lite-service | grep -i health

# View service resource usage
docker stats bundler-lite-service bundler-lite-workers
```

---

## 📊 Monitoring

### Admin Dashboard

**Access the admin dashboard:**
- **URL:** http://localhost:3002/admin/dashboard
- **Credentials:** admin / (your ADMIN_PASSWORD from .env)

**Features:**
- Upload statistics (volume, unique users)
- x402 payment stats (USDC volume by network)
- Bundle statistics (count, average size)
- System health (database, Redis, queues)

### Queue Monitor (Bull Board)

**Monitor BullMQ job queues:**
- **URL:** http://localhost:3002/admin/queues
- **Credentials:** Same as admin dashboard

**View:**
- Job counts (waiting, active, completed, failed)
- Individual job details
- Error logs and stack traces
- Retry failed jobs manually

### Prometheus Metrics

**Metrics endpoint:**
```bash
curl http://localhost:3001/bundler_metrics
```

**Sample metrics:**
- HTTP request rates
- Job processing times
- Database connection pool stats
- Custom bundler metrics

### Health Checks

```bash
# API health
curl http://localhost:3001/health

# Service info
curl http://localhost:3001/v1/info

# PostgreSQL health
docker-compose exec postgres pg_isready -U postgres

# Redis health
docker-compose exec redis-cache redis-cli ping
```

---

## 🔍 Troubleshooting

### Common Issues

#### 1. Wallet file not found

**Error:** `ENOENT: no such file or directory, open './wallet.json'`

**Solution:**
```bash
# Use ABSOLUTE path in .env
ARWEAVE_WALLET_FILE=/home/user/ar-io-x402-bundler/wallet.json

# NOT relative path
# ARWEAVE_WALLET_FILE=./wallet.json  ❌
```

#### 2. Port already in use

**Error:** `Bind for 0.0.0.0:3001 failed: port is already allocated`

**Solution:**
```bash
# Find process using port
lsof -i :3001

# Change port in .env
PORT=3005

# Or stop conflicting service
docker-compose down
```

#### 3. Database migration fails

**Error:** `relation "new_data_item" does not exist`

**Solution:**
```bash
# Run migrations manually
docker-compose exec bundler yarn db:migrate

# Check migration status
docker-compose exec bundler yarn knex migrate:status --knexfile lib/arch/db/knexfile.js
```

#### 4. Workers not processing jobs

**Check worker logs:**
```bash
docker-compose logs -f workers
```

**Restart workers:**
```bash
docker-compose restart workers
```

**Verify Redis queue connection:**
```bash
docker-compose exec workers node -e "
const Redis = require('ioredis');
const redis = new Redis({ host: 'redis-queue', port: 6379 });
redis.ping().then(console.log).catch(console.error);
"
```

#### 5. Out of disk space

**Check Docker disk usage:**
```bash
docker system df

# Clean up
docker system prune -a --volumes
```

**Check MinIO usage:**
```bash
docker-compose exec minio du -sh /data
```

### Debug Mode

**Enable debug logging:**
```bash
# In .env
LOG_LEVEL=debug

# Restart services
docker-compose restart bundler workers
```

**View detailed logs:**
```bash
docker-compose logs -f bundler | grep -i error
docker-compose logs -f workers | grep -i failed
```

---

## 🔄 Upgrading

### Update to Latest Version

```bash
# 1. Pull latest code
git pull origin main

# 2. Rebuild Docker images
docker-compose build

# 3. Stop old services
docker-compose down

# 4. Start new services
docker-compose up -d

# 5. Run new migrations
docker-compose exec bundler yarn db:migrate
```

### Rollback

```bash
# 1. Stop current services
docker-compose down

# 2. Checkout previous version
git checkout <previous-commit>

# 3. Rebuild and start
docker-compose up -d --build
```

### Backup Before Upgrade

```bash
# Backup PostgreSQL
docker-compose exec postgres pg_dump -U postgres bundler_lite > backup-$(date +%Y%m%d).sql

# Backup MinIO data
docker run --rm \
  -v bundler_minio-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/minio-backup-$(date +%Y%m%d).tar.gz /data
```

---

## 📚 Additional Resources

- **README.md** - Project overview and features
- **CLAUDE.md** - Architecture and development guide
- **.env.sample** - Configuration reference
- **docker-compose.yml** - Service definitions

---

## 🆘 Getting Help

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Verify configuration: `.env` file
3. Check service health: `docker-compose ps`
4. Review this troubleshooting guide
5. Open an issue: https://github.com/ar-io/ar-io-x402-bundler/issues

---

**Built with ❤️ for the AR.IO ecosystem**
