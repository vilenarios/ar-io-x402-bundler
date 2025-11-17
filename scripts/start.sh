#!/bin/bash

#############################
# Start AR.IO x402 Bundler (Upload-Only)
# Uses explicit PORT configuration to prevent conflicts
#############################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Starting AR.IO x402 Bundler (Upload-Only)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Docker infrastructure
echo "📦 Checking infrastructure..."
if ! docker ps | grep -q ar-io-x402-bundler-postgres; then
  echo -e "${YELLOW}⚠️  Infrastructure not running${NC}"
  echo "   Starting Docker containers..."
  cd "$PROJECT_ROOT"
  docker compose up -d postgres redis-cache redis-queues minio
  echo "   Waiting for services to be ready..."
  sleep 5

  # Initialize MinIO buckets (one-time setup)
  echo "   Initializing MinIO buckets..."
  docker compose up minio-init

  # Run database migrations
  echo "   Running database migrations..."
  cd "$PROJECT_ROOT"
  DB_HOST=localhost DB_USER=turbo_admin DB_PASSWORD=postgres DB_DATABASE=upload_service yarn db:migrate:latest
  cd "$PROJECT_ROOT"

  echo -e "${GREEN}✓${NC} Infrastructure started"
else
  echo -e "${GREEN}✓${NC} Infrastructure running"
fi

# Check if service needs building
echo ""
echo "🔨 Checking build status..."
if [ ! -d "$PROJECT_ROOT/lib" ]; then
  echo "   Upload service needs building"
  cd "$PROJECT_ROOT"
  yarn build
  echo -e "${GREEN}✓${NC} Build complete"
else
  echo -e "${GREEN}✓${NC} Service already built"
fi

# Check for wallet
echo ""
echo "🔑 Checking wallet configuration..."
if [ ! -f "$PROJECT_ROOT/wallet.json" ]; then
  echo -e "${RED}✗${NC} wallet.json not found at $PROJECT_ROOT/wallet.json"
  echo "   Upload service requires an Arweave wallet for bundle signing"
  echo "   Please copy your wallet to: $PROJECT_ROOT/wallet.json"
  exit 1
fi
echo -e "${GREEN}✓${NC} Wallet found"

# Check for .env file
echo ""
echo "⚙️  Checking configuration..."
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo -e "${RED}✗${NC} .env not found"
  exit 1
fi
echo -e "${GREEN}✓${NC} Configuration found"

# Stop existing services if running
echo ""
echo "🔄 Checking for existing PM2 processes..."
if pm2 list | grep -q "upload-api\|upload-workers\|bull-board"; then
  echo "   Stopping existing processes..."
  pm2 delete upload-api upload-workers bull-board 2>/dev/null || true
  echo -e "${GREEN}✓${NC} Existing processes stopped"
else
  echo -e "${GREEN}✓${NC} No existing processes"
fi

# Start all services using ecosystem file
echo ""
echo "🚀 Starting all services using PM2 ecosystem file..."
cd "$PROJECT_ROOT"
pm2 start ecosystem.config.js

# Save PM2 configuration
echo ""
echo "💾 Saving PM2 configuration..."
pm2 save

# Show status
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ All services started successfully!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
pm2 list
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Service URLs:"
echo "  Upload Service:     http://localhost:3001"
echo "  Queue Monitoring:   http://localhost:3002/admin/queues"
echo ""
echo "AR.IO Gateway (if co-located):"
echo "  Gateway:          http://localhost:3000"
echo "  Gateway Core:     http://localhost:4000"
echo ""
echo "Infrastructure:"
echo "  PostgreSQL:       localhost:5432"
echo "  Redis Cache:      localhost:6379"
echo "  Redis Queues:     localhost:6381"
echo "  MinIO Console:    http://localhost:9001"
echo ""
echo "Useful Commands:"
echo "  pm2 logs                - View all logs"
echo "  pm2 logs upload-api     - View upload service logs"
echo "  pm2 logs upload-workers - View upload workers (bundling pipeline)"
echo "  pm2 monit               - Monitor processes"
echo "  pm2 restart all         - Restart all services"
echo "  pm2 stop all            - Stop all services"
echo ""
echo "Test Endpoints:"
echo "  curl http://localhost:3001/health"
echo "  curl -X POST http://localhost:3001/v1/tx -H 'Content-Type: application/octet-stream' --data 'Hello!'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
