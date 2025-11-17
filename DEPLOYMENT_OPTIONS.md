# Deployment Options Comparison

**Choose the right deployment method for your use case.**

---

## 🎯 Quick Recommendation

| Use Case | Recommended Method |
|----------|-------------------|
| **Production deployment** | 🐳 **All-Docker** (Option 1) |
| **Development** | 🐳 **All-Docker** or PM2 |
| **Testing/CI** | 🐳 **All-Docker** |
| **Local debugging** | 💻 PM2 (Option 2) |

**TL;DR:** Use **All-Docker** (Option 1) unless you need to debug Node.js processes directly.

---

## Option 1: All-Docker Deployment 🐳 (RECOMMENDED)

**Everything runs in Docker containers - infrastructure AND services.**

### ✅ Pros

- **Simplest operation** - Single `./start-bundler.sh` command
- **Consistent environment** - Works same on all machines
- **Production-ready** - Built-in health checks, auto-restart
- **Easy upgrades** - Just rebuild images
- **Resource isolation** - Containers limit resource usage
- **No local dependencies** - Don't need Node.js/Yarn installed
- **Clean teardown** - `docker-compose down -v` removes everything

### ❌ Cons

- **Docker overhead** - Slightly more RAM usage (~500MB extra)
- **Container debugging** - Need to exec into containers
- **Build time** - Initial build takes 2-3 minutes

### 📋 When to Use

- ✅ Production deployments
- ✅ Staging environments
- ✅ CI/CD pipelines
- ✅ Team environments (consistent setup)
- ✅ When you want "it just works"

### 🚀 How to Use

```bash
# One-time setup
cp .env.sample .env
# Edit .env with your configuration

# Start everything
./start-bundler.sh

# Stop everything
./stop-bundler.sh

# View logs
docker-compose logs -f bundler
docker-compose logs -f workers
```

**Full guide:** [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)

---

## Option 2: PM2 with Docker Infrastructure 💻

**PM2 manages Node.js processes, Docker provides infrastructure (Postgres, Redis, MinIO).**

### ✅ Pros

- **Direct process access** - Easy Node.js debugging with `--inspect`
- **Fast restarts** - No container rebuild needed
- **Hot reload** - Use `nodemon` for development
- **PM2 features** - Built-in load balancing, monitoring
- **Lower resource usage** - No Docker overhead for Node.js

### ❌ Cons

- **Complex setup** - Multiple commands to start
- **Local dependencies** - Needs Node.js 18+, Yarn, PM2
- **Manual management** - More commands to remember
- **Environment drift** - Dev/prod environments can differ
- **Cleanup harder** - Need to stop PM2 AND Docker separately

### 📋 When to Use

- ✅ Active development with code changes
- ✅ Debugging Node.js with Chrome DevTools
- ✅ Performance profiling with `--inspect`
- ✅ Testing PM2 cluster mode

### 🚀 How to Use

```bash
# One-time setup
cp .env.sample .env
yarn install
yarn build

# Start infrastructure (Docker)
yarn docker:up

# Run migrations
yarn db:migrate

# Start services (PM2)
pm2 start ecosystem.config.js

# Or use the helper script
./scripts/start.sh

# View logs
pm2 logs
pm2 monit
```

**Note:** You still need the workers file (`src/jobs/allWorkers.ts`) created in this update.

---

## Option 3: Hybrid Docker-PM2

**Mix of both - some services in Docker, some in PM2.**

### Example: Workers in Docker, API via PM2

```bash
# Start infrastructure + workers in Docker
docker-compose up -d postgres redis-cache redis-queue minio workers

# Start API locally with PM2 for debugging
pm2 start ecosystem.config.js --only upload-api
```

### When to Use

- Need to debug API but not workers
- Want fast API restarts but isolated workers

---

## Side-by-Side Comparison

| Feature | All-Docker | PM2 + Docker |
|---------|-----------|-------------|
| **Startup complexity** | ⭐⭐⭐⭐⭐ Simple | ⭐⭐⭐ Moderate |
| **Production readiness** | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐⭐ Good |
| **Development speed** | ⭐⭐⭐⭐ Good | ⭐⭐⭐⭐⭐ Excellent |
| **Debugging ease** | ⭐⭐⭐ Moderate | ⭐⭐⭐⭐⭐ Excellent |
| **Resource usage** | ⭐⭐⭐ Higher | ⭐⭐⭐⭐ Lower |
| **Consistency** | ⭐⭐⭐⭐⭐ Perfect | ⭐⭐⭐ Variable |
| **Cleanup** | ⭐⭐⭐⭐⭐ Perfect | ⭐⭐⭐ Manual |

---

## Quick Start Commands

### All-Docker

```bash
./start-bundler.sh              # Start
docker-compose logs -f          # Logs
docker-compose ps               # Status
./stop-bundler.sh               # Stop
```

### PM2 + Docker

```bash
yarn docker:up                  # Infrastructure
yarn build && yarn db:migrate   # Setup
pm2 start ecosystem.config.js   # Services
pm2 logs                        # Logs
pm2 stop all && docker-compose down  # Stop
```

---

## Migration Between Methods

### From PM2 to All-Docker

```bash
# 1. Stop PM2 services
pm2 delete all

# 2. Ensure .env is configured
cat .env  # Verify settings

# 3. Start with Docker
./start-bundler.sh
```

**Data is preserved** - PostgreSQL, Redis, and MinIO data volumes are reused.

### From All-Docker to PM2

```bash
# 1. Stop Docker services (keep infrastructure)
docker-compose stop bundler workers admin

# 2. Install dependencies locally
yarn install
yarn build

# 3. Update .env for localhost connections
# DB_HOST=localhost
# REDIS_CACHE_HOST=localhost
# REDIS_QUEUE_HOST=localhost
# AWS_ENDPOINT=http://localhost:9000

# 4. Start PM2
pm2 start ecosystem.config.js
```

---

## Environment Variables

Both methods use the same `.env` file, but with different host values:

### For All-Docker:
```bash
DB_HOST=postgres              # Container name
REDIS_CACHE_HOST=redis-cache
REDIS_QUEUE_HOST=redis-queue
AWS_ENDPOINT=http://minio:9000
```

### For PM2:
```bash
DB_HOST=localhost
REDIS_CACHE_HOST=localhost
REDIS_QUEUE_HOST=localhost
AWS_ENDPOINT=http://localhost:9000
```

**The docker-compose.yml overrides these** for containers, so you can keep localhost values and still use Docker.

---

## Recommendation by Environment

### Development

**Personal preference:**
- Use **All-Docker** if you prefer simplicity
- Use **PM2** if you need debugging tools

**Team environment:**
- Use **All-Docker** for consistency

### Staging

**Always use All-Docker** - matches production environment

### Production

**Always use All-Docker**:
- Better isolation
- Health checks
- Auto-restart
- Resource limits
- Standard deployment

---

## Summary

**Start with All-Docker** (Option 1) using `./start-bundler.sh`. It's:
- Simpler to set up
- More reliable
- Production-ready
- Self-documenting

**Switch to PM2** only if you need:
- Node.js debugging with Chrome DevTools
- Hot module reloading during development
- PM2-specific features (cluster mode, keymetrics)

Both options are now fully supported with the updates in this PR! 🎉

---

## Need Help?

- **All-Docker guide:** [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)
- **PM2 guide:** [README.md](./README.md#development) (Development section)
- **Issues:** https://github.com/ar-io/ar-io-x402-bundler/issues
