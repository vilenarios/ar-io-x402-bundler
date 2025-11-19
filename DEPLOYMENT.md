# Deployment Guide

This guide covers deploying the AR.IO x402 Bundler using pre-built Docker images from GitHub Container Registry.

## Quick Start: Production Deployment

### 1. Authenticate with GitHub Container Registry

```bash
# Create a GitHub Personal Access Token with 'read:packages' scope
# https://github.com/settings/tokens/new?scopes=read:packages

# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

### 2. Configure Environment

```bash
# Clone the repository (for docker-compose.production.yml and .env.sample)
git clone https://github.com/vilenarios/ar-io-x402-bundler.git
cd ar-io-x402-bundler

# Copy and configure environment
cp .env.sample .env
nano .env  # Configure your settings
```

### 3. Deploy with Pre-built Image

```bash
# Pull latest image
docker pull ghcr.io/vilenarios/ar-io-x402-bundler:latest

# Start all services (API, Workers, Admin, Infrastructure)
docker-compose -f docker-compose.production.yml up -d

# Check logs
docker-compose -f docker-compose.production.yml logs -f bundler-api
```

### 4. Verify Deployment

```bash
# Check API health
curl http://localhost:3001/health
# Expected: "OK"

# Check service info
curl http://localhost:3001/v1/info | jq

# Access admin dashboard
open http://localhost:3002/admin/dashboard
```

## CI/CD: Automated Builds

The repository includes a GitHub Actions workflow that automatically builds and pushes Docker images when you push to `main` or create a release tag.

### Automatic Triggers

- **Push to main**: Builds and tags as `latest` and `main-{sha}`
- **Create tag `v1.2.3`**: Builds and tags as `v1.2.3`, `v1.2`, `v1`, and `latest`
- **Pull requests**: Builds but doesn't push (validation only)

### Image Tags Available

After pushing to main or creating a release:

```bash
# Latest from main branch
docker pull ghcr.io/vilenarios/ar-io-x402-bundler:latest

# Specific version (if using semver tags)
docker pull ghcr.io/vilenarios/ar-io-x402-bundler:v1.0.0

# Specific commit SHA
docker pull ghcr.io/vilenarios/ar-io-x402-bundler:main-abc123
```

## Manual Build and Push

If you prefer to build and push manually:

### 1. Build Image Locally

```bash
# Build for your platform
docker build -t ghcr.io/vilenarios/ar-io-x402-bundler:latest .

# Multi-platform build (requires buildx)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/vilenarios/ar-io-x402-bundler:latest \
  --push .
```

### 2. Push to GHCR

```bash
# Login
echo $GITHUB_TOKEN | docker login ghcr.io -u vilenarios --password-stdin

# Tag with version
docker tag ghcr.io/vilenarios/ar-io-x402-bundler:latest \
           ghcr.io/vilenarios/ar-io-x402-bundler:v1.0.0

# Push both tags
docker push ghcr.io/vilenarios/ar-io-x402-bundler:latest
docker push ghcr.io/vilenarios/ar-io-x402-bundler:v1.0.0
```

### 3. Or Use the Helper Script

```bash
# Push latest
./push-to-ghcr.sh

# Push specific version
./push-to-ghcr.sh v1.0.0
```

## Production Best Practices

### Use Specific Version Tags

Instead of `latest` in production, pin to specific versions:

```yaml
# docker-compose.production.yml
services:
  bundler-api:
    image: ghcr.io/vilenarios/ar-io-x402-bundler:v1.0.0  # Pinned version
```

### Update Strategy

```bash
# Pull new version
docker pull ghcr.io/vilenarios/ar-io-x402-bundler:v1.1.0

# Update docker-compose.production.yml to use v1.1.0

# Rolling update
docker-compose -f docker-compose.production.yml up -d
```

### Rollback

```bash
# Revert docker-compose.production.yml to previous version
# Then restart
docker-compose -f docker-compose.production.yml up -d
```

## Monitoring

### View Logs

```bash
# All services
docker-compose -f docker-compose.production.yml logs -f

# Specific service
docker-compose -f docker-compose.production.yml logs -f bundler-api

# With timestamps and tail
docker-compose -f docker-compose.production.yml logs -f --tail=100 --timestamps
```

### Check Resource Usage

```bash
# Container stats
docker stats

# Disk usage
docker system df
```

### Admin Dashboard

- **Dashboard**: http://localhost:3002/admin/dashboard
- **Queue Monitor**: http://localhost:3002/admin/queues
- **Metrics**: http://localhost:3001/bundler_metrics (Prometheus format)

## Scaling

### Scale Workers

```bash
# Run 3 worker instances
docker-compose -f docker-compose.production.yml up -d --scale bundler-workers=3

# Or in docker-compose.production.yml:
# services:
#   bundler-workers:
#     deploy:
#       replicas: 3
```

### Load Balancing API

```bash
# Run 2 API instances behind nginx/traefik
docker-compose -f docker-compose.production.yml up -d --scale bundler-api=2
```

## Backup and Recovery

### Database Backup

```bash
# Backup PostgreSQL
docker exec ar-io-bundler-postgres pg_dump \
  -U bundler_user bundler_lite | gzip > backup-$(date +%Y%m%d).sql.gz

# Restore
gunzip -c backup-20250119.sql.gz | \
  docker exec -i ar-io-bundler-postgres psql -U bundler_user bundler_lite
```

### MinIO Backup

```bash
# Backup S3 data
docker exec ar-io-bundler-minio mc mirror \
  /data /backup/minio-$(date +%Y%m%d)
```

## Troubleshooting

### Image Not Found

If you get "image not found" errors:

```bash
# Ensure you're logged in
docker login ghcr.io

# Check image exists
docker pull ghcr.io/vilenarios/ar-io-x402-bundler:latest

# Check GitHub Package permissions
# https://github.com/vilenarios/ar-io-x402-bundler/pkgs/container/ar-io-x402-bundler
```

### Build Failures in GitHub Actions

Check the Actions tab:
https://github.com/vilenarios/ar-io-x402-bundler/actions

Common issues:
- **GITHUB_TOKEN permissions**: Ensure workflow has `packages: write` permission
- **Dockerfile errors**: Test build locally first
- **Build timeout**: Enable Docker layer caching in workflow

## Migration from Local Build

If you're currently using `docker-compose.yml` (which builds locally):

```bash
# Stop current deployment
docker-compose down

# Switch to production compose file
docker-compose -f docker-compose.production.yml up -d

# Data persists in volumes, no migration needed
```

## Environment Variables

All environment variables from `.env` are still required. Key ones:

```bash
# Required
ARWEAVE_WALLET_FILE=/path/to/wallet.json
X402_PAYMENT_ADDRESS=0xYourEthereumAddress

# Optional (with defaults)
X402_FEE_PERCENT=30
X402_FRAUD_TOLERANCE_PERCENT=5
MIGRATE_ON_STARTUP=true
```

See `.env.sample` for full configuration options.

## Support

- **Issues**: https://github.com/vilenarios/ar-io-x402-bundler/issues
- **Discussions**: https://github.com/vilenarios/ar-io-x402-bundler/discussions
- **Docker Images**: https://github.com/vilenarios/ar-io-x402-bundler/pkgs/container/ar-io-x402-bundler
