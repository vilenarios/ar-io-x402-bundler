# Docker Deployment: Edge Cases, Risks & Challenges

## ✅ What We've Built

1. **GitHub Actions Workflow** (`.github/workflows/docker-publish.yml`)
   - Automatically builds Docker images on push to main
   - Supports semantic versioning tags (v1.2.3)
   - Multi-architecture builds (amd64, arm64)
   - Caches layers for faster builds

2. **Production Docker Compose** (`docker-compose.production.yml`)
   - Uses pre-built images from GHCR
   - Includes all services (API, Workers, Admin, Infrastructure)
   - Persistent volumes for data

3. **Manual Build Script** (`push-to-ghcr.sh`)
   - Quick manual builds and pushes

4. **Comprehensive Documentation** (`DEPLOYMENT.md`)

## 🚨 Critical Issues Found & Fixed

### ✅ FIXED: Missing admin-server.js in Docker Image
**Problem**: Dockerfile didn't copy `admin-server.js` or `ecosystem.config.js`
**Impact**: Admin dashboard container would fail to start
**Fix**: Added to Dockerfile line 61-62
**Status**: ✅ Fixed

### ✅ FIXED: .dockerignore Too Aggressive
**Problem**: Original .dockerignore excluded necessary files
**Fix**: Updated to only exclude truly unnecessary files
**Status**: ✅ Fixed

## ⚠️ Edge Cases & Potential Issues

### 1. First-Time GitHub Package Setup

**Issue**: GitHub Actions will fail on first push because the package doesn't exist yet.

**Symptoms**:
```
Error: denied: permission_denied: write_package
```

**Why**: GitHub requires manual creation of package visibility settings on first push.

**Solution**:
```bash
# First time only - build and push manually to create the package
echo $GITHUB_TOKEN | docker login ghcr.io -u vilenarios --password-stdin
docker build -t ghcr.io/vilenarios/ar-io-x402-bundler:latest .
docker push ghcr.io/vilenarios/ar-io-x402-bundler:latest

# After first successful push, GitHub Actions will work automatically
```

**Workaround**: After manual push, go to:
- https://github.com/vilenarios/ar-io-x402-bundler/pkgs/container/ar-io-x402-bundler
- Settings → Change visibility to "Public" (or configure access for private)

### 2. Wallet File Mounting in Docker

**Issue**: Wallet files must exist on the host filesystem for volume mounts to work.

**docker-compose.production.yml**:
```yaml
volumes:
  - ${ARWEAVE_WALLET_FILE}:${ARWEAVE_WALLET_FILE}:ro
```

**Problems**:
- Path must be **absolute** (not relative)
- File must exist **before** `docker-compose up`
- Won't work in Kubernetes/orchestrated environments

**Solution for Production**:
```bash
# Option 1: Use absolute paths
ARWEAVE_WALLET_FILE=/opt/bundler/wallets/arweave.json

# Option 2: Use Docker secrets (more secure)
# Create secret
docker secret create arweave_wallet /path/to/wallet.json

# Update docker-compose.yml to use secrets instead of volumes
secrets:
  - arweave_wallet
```

**Better Solution for Kubernetes**:
```yaml
# Use Kubernetes secrets instead of file mounts
apiVersion: v1
kind: Secret
metadata:
  name: arweave-wallet
type: Opaque
data:
  wallet.json: <base64-encoded-wallet>
```

### 3. Database Migration Race Conditions

**Issue**: Multiple API instances with `MIGRATE_ON_STARTUP=true` can cause race conditions.

**Scenario**:
```bash
# Both instances try to run migrations simultaneously
docker-compose up -d --scale bundler-api=2
```

**Problems**:
- Duplicate migration executions
- Potential deadlocks
- Inconsistent migration state

**Solutions**:

**Option A**: Single migration job
```yaml
# Add a one-time migration service
services:
  migrate:
    image: ghcr.io/vilenarios/ar-io-x402-bundler:latest
    command: ["yarn", "db:migrate"]
    depends_on:
      - postgres
    restart: "no"  # Run once and exit

  bundler-api:
    environment:
      - MIGRATE_ON_STARTUP=false  # Disable auto-migration
    depends_on:
      - migrate
```

**Option B**: Use a lock mechanism (recommended)
```typescript
// In migration code - add distributed lock via Redis
await redis.set('migration-lock', '1', 'EX', 300, 'NX');
// Run migrations only if lock acquired
```

### 4. Multi-Architecture Build Failures

**Issue**: arm64 builds may fail if dependencies have architecture-specific native bindings.

**GitHub Actions Error**:
```
ERROR: failed to solve: process "/bin/sh -c yarn install" did not complete successfully
```

**Problematic Dependencies**:
- `bcrypt` - has native bindings
- `sqlite3` - native module
- Any package with `node-gyp` builds

**Solution**:
```dockerfile
# In Dockerfile - ensure build tools for all architectures
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    musl-dev  # Add this for arm64 support
```

**Or**: Disable arm64 if not needed
```yaml
# .github/workflows/docker-publish.yml
platforms: linux/amd64  # Remove linux/arm64
```

### 5. Image Size Bloat

**Current Issue**: Image includes unnecessary files increasing size and build time.

**Check Current Size**:
```bash
docker images ghcr.io/vilenarios/ar-io-x402-bundler
# Expect: 200-400 MB (good) or 1GB+ (bad)
```

**Optimizations Applied**:
- ✅ Multi-stage build (separates build from runtime)
- ✅ Alpine Linux base image (minimal)
- ✅ .dockerignore excludes dev files

**Further Optimizations** (if needed):
```dockerfile
# Option 1: Use --production for node_modules
RUN yarn install --frozen-lockfile --production

# Option 2: Prune dev dependencies after build
RUN yarn install --frozen-lockfile && \
    yarn build && \
    yarn install --production --ignore-scripts --prefer-offline
```

### 6. Environment Variable Validation

**Issue**: Container starts even if critical env vars are missing, then fails at runtime.

**Current Behavior**:
```bash
docker-compose up -d
# Container starts, then crashes after 30 seconds
# Logs show: "ARWEAVE_WALLET_FILE not found"
```

**Solution**: Add startup validation
```dockerfile
# Add to Dockerfile - entrypoint script
COPY --chown=bundler:bundler docker-entrypoint.sh ./
ENTRYPOINT ["/usr/bin/dumb-init", "--", "./docker-entrypoint.sh"]
```

```bash
# docker-entrypoint.sh
#!/bin/sh
set -e

# Validate required environment variables
: "${ARWEAVE_WALLET_FILE:?ARWEAVE_WALLET_FILE not set}"
: "${X402_PAYMENT_ADDRESS:?X402_PAYMENT_ADDRESS not set}"
: "${DB_HOST:?DB_HOST not set}"

# Check wallet file exists
if [ ! -f "$ARWEAVE_WALLET_FILE" ]; then
  echo "ERROR: Wallet file not found: $ARWEAVE_WALLET_FILE"
  exit 1
fi

# Start the application
exec "$@"
```

### 7. GitHub Actions Quota Limits

**Issue**: Free tier has limited Actions minutes and storage.

**Free Tier Limits**:
- 2,000 Actions minutes/month
- 500 MB package storage
- 1 GB data transfer/month

**Each Build Consumes**:
- ~10-15 minutes (multi-arch build)
- ~300-500 MB storage per image version
- Multiple tags count separately!

**Risk**: Frequent pushes could exhaust quota quickly.

**Solutions**:

**Option A**: Only build on tags
```yaml
on:
  push:
    tags:
      - 'v*.*.*'  # Only version tags
  # Remove 'main' branch trigger
```

**Option B**: Use pull request builds sparingly
```yaml
on:
  pull_request:
    branches: [main]
    types: [opened, reopened]  # Don't rebuild on every commit
```

**Option C**: Self-hosted runner
```yaml
jobs:
  build:
    runs-on: self-hosted  # Use your own server
```

### 8. Cache Invalidation Issues

**Issue**: GitHub Actions cache can get corrupted or outdated.

**Symptoms**:
- Builds fail mysteriously
- "Module not found" errors
- Stale dependencies

**Solution**: Clear cache manually
```yaml
# In workflow, add cache key with version
cache-from: type=gha,scope=build-v2  # Increment v2 → v3 to bust cache
cache-to: type=gha,mode=max,scope=build-v2
```

**Or**: Delete cache via GitHub UI
- Repo → Actions → Caches → Delete all caches

### 9. Private Repository Access

**Issue**: Pulling private images requires authentication, complicating deployments.

**Error**:
```
Error response from daemon: pull access denied for ghcr.io/vilenarios/ar-io-x402-bundler
```

**Solution**: Create read-only Personal Access Token
```bash
# Create token with 'read:packages' scope only
# https://github.com/settings/tokens/new?scopes=read:packages

# On deployment server
echo $READ_ONLY_TOKEN | docker login ghcr.io -u vilenarios --password-stdin

# Or use in CI/CD
docker login ghcr.io -u vilenarios -p $READ_ONLY_TOKEN
```

**Better**: Use GitHub Actions OIDC for automated deployments
```yaml
# No long-lived tokens needed
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
```

### 10. Health Check False Positives

**Issue**: Current health check only tests HTTP 200, not actual functionality.

**Current Health Check**:
```dockerfile
HEALTHCHECK CMD node -e "require('http').get('http://localhost:${PORT:-3001}/health'...)"
```

**Problems**:
- `/health` returns 200 even if database is down
- Returns 200 even if Redis is unreachable
- Container marked "healthy" when it's not

**Better Health Check**:
```typescript
// src/routes/health.ts
export async function healthRoute(ctx: KoaContext) {
  const checks = {
    database: false,
    redis: false,
    minio: false,
  };

  try {
    await ctx.state.database.raw('SELECT 1');
    checks.database = true;
  } catch (e) { /* keep false */ }

  try {
    await ctx.state.cacheService.get('health-check');
    checks.redis = true;
  } catch (e) { /* keep false */ }

  const allHealthy = Object.values(checks).every(v => v);
  ctx.status = allHealthy ? 200 : 503;
  ctx.body = { status: allHealthy ? 'healthy' : 'unhealthy', checks };
}
```

## 🎯 Recommended Next Steps

### High Priority

1. **✅ Fix Dockerfile** - Add admin-server.js (DONE)
2. **Test first build** - Push manually to create package
3. **Add entrypoint validation** - Catch missing env vars early
4. **Document wallet setup** - Clear instructions for absolute paths

### Medium Priority

5. **Improve health check** - Test DB/Redis connectivity
6. **Add migration lock** - Prevent race conditions
7. **Setup monitoring** - Prometheus metrics, log aggregation
8. **Create rollback procedure** - Document how to revert versions

### Low Priority

9. **Optimize image size** - Production-only dependencies
10. **Setup secrets management** - Vault, AWS Secrets Manager, etc.
11. **Multi-region deployment** - CDN for global access

## 📊 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| First push fails | High | Low | Manual push first time |
| Wallet mount fails | Medium | High | Document absolute paths |
| Migration race condition | Low | High | Single migration job |
| Multi-arch build fails | Low | Medium | Test both architectures |
| GitHub quota exceeded | Low | Medium | Build on tags only |
| Cache corruption | Low | Low | Version cache keys |
| Private repo access issues | Medium | Medium | Document PAT setup |
| Health check false positive | High | Medium | Enhance health endpoint |

## 🚀 Production Readiness Checklist

- [ ] Manual first push successful
- [ ] GitHub package visibility configured
- [ ] Wallet files with absolute paths
- [ ] Database migrations tested
- [ ] Multi-architecture builds verified
- [ ] Health checks improved
- [ ] Monitoring setup (Prometheus/Grafana)
- [ ] Log aggregation configured
- [ ] Backup procedures documented
- [ ] Rollback procedure tested
- [ ] Security scan passed (Trivy, Snyk)
- [ ] Load testing completed
- [ ] Disaster recovery plan documented

## 📝 Additional Resources

- **GitHub Container Registry**: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- **Docker Multi-stage Builds**: https://docs.docker.com/build/building/multi-stage/
- **GitHub Actions**: https://docs.github.com/en/actions
- **Docker Security Best Practices**: https://docs.docker.com/develop/security-best-practices/
