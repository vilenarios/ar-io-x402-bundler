#!/bin/bash

#############################
# AR.IO x402 Bundler - Simple Docker Start
#
# This script starts the bundler using Docker Compose.
# No PM2, no complexity - just Docker.
#############################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 AR.IO x402 Bundler - All-Docker Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check for .env file
if [ ! -f ".env" ]; then
  echo -e "${RED}✗ .env file not found${NC}"
  echo ""
  echo "Please create a .env file with required configuration."
  echo "You can copy from .env.sample:"
  echo ""
  echo "  cp .env.sample .env"
  echo ""
  echo "Then edit .env and set:"
  echo "  - ARWEAVE_WALLET_FILE (absolute path to your wallet)"
  echo "  - X402_PAYMENT_ADDRESS (your Ethereum address)"
  echo "  - ADMIN_PASSWORD (generate with: openssl rand -hex 32)"
  echo ""
  exit 1
fi

# Load environment variables to check configuration
set -a
source .env
set +a

# Check for wallet file
if [ -z "$ARWEAVE_WALLET_FILE" ]; then
  echo -e "${RED}✗ ARWEAVE_WALLET_FILE not set in .env${NC}"
  exit 1
fi

if [ ! -f "$ARWEAVE_WALLET_FILE" ]; then
  echo -e "${RED}✗ Wallet file not found: $ARWEAVE_WALLET_FILE${NC}"
  echo ""
  echo "Please ensure the wallet file exists at the specified path."
  exit 1
fi

# Check for x402 payment address
if [ -z "$X402_PAYMENT_ADDRESS" ]; then
  echo -e "${YELLOW}⚠️  X402_PAYMENT_ADDRESS not set - uploads will require payment${NC}"
fi

# Check for admin password
if [ -z "$ADMIN_PASSWORD" ]; then
  echo -e "${YELLOW}⚠️  ADMIN_PASSWORD not set - generating one...${NC}"
  ADMIN_PASSWORD=$(openssl rand -hex 32)
  echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> .env
  echo -e "${GREEN}✓${NC} Generated admin password and added to .env"
fi

echo -e "${GREEN}✓${NC} Configuration validated"
echo ""

# Build if needed
echo "🔨 Checking if build is needed..."
if [ "$1" == "--build" ] || [ ! -d "lib" ]; then
  echo "   Building Docker images..."
  docker-compose build
  echo -e "${GREEN}✓${NC} Build complete"
else
  echo -e "${BLUE}ℹ${NC}  Using existing build (use --build to rebuild)"
fi
echo ""

# Start all services
echo "🚀 Starting all services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for bundler service to be ready..."

# Wait for bundler to be healthy (max 120 seconds)
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if docker inspect bundler-lite-service --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; then
    echo -e "${GREEN}✓${NC} Bundler is healthy"
    break
  fi

  if [ $ELAPSED -eq 0 ]; then
    echo -n "  Waiting"
  else
    echo -n "."
  fi

  sleep 2
  ELAPSED=$((ELAPSED + 2))
done
echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo -e "${RED}✗ Bundler failed to become healthy${NC}"
  echo ""
  echo "Check logs with: docker logs bundler-lite-service"
  exit 1
fi

# Run database migrations
echo ""
echo "📊 Running database migrations..."
docker-compose exec -T bundler yarn db:migrate || {
  echo -e "${YELLOW}⚠️  Migration failed - this is OK if database is already migrated${NC}"
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ AR.IO x402 Bundler is running!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Container Status:"
docker-compose ps --format "table {{.Name}}\t{{.Status}}" | grep -E "bundler|admin|workers" || true
echo ""
echo "Services:"
echo "  📦 Bundler API:       http://localhost:3001"
echo "  📊 Admin Dashboard:   http://localhost:3002/admin/dashboard"
echo "  📋 Queue Monitor:     http://localhost:3002/admin/queues"
echo "  🗄️  MinIO Console:     http://localhost:9001"
echo ""
echo "Admin Credentials:"
echo "  Username: ${ADMIN_USERNAME:-admin}"
echo "  Password: $ADMIN_PASSWORD"
echo ""
echo "Infrastructure:"
echo "  🐘 PostgreSQL:  localhost:5432"
echo "  🔴 Redis Cache: localhost:6379"
echo "  🔴 Redis Queue: localhost:6381"
echo "  📦 MinIO S3:    localhost:9000"
echo ""
echo "Docker Commands:"
echo "  docker-compose logs -f bundler   # View bundler logs"
echo "  docker-compose logs -f workers   # View worker logs"
echo "  docker-compose logs -f           # View all logs"
echo "  docker-compose ps                # View service status"
echo "  docker-compose stop              # Stop all services"
echo "  docker-compose down              # Stop and remove containers"
echo "  docker-compose down -v           # Stop and remove all data"
echo ""
echo "Test Upload:"
echo "  curl http://localhost:3001/health"
echo "  curl -X GET 'http://localhost:3001/v1/x402/price/3/0xYourAddress?bytes=1024'"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
