#!/bin/bash

#############################
# Restart AR.IO x402 Bundler
# Restarts Docker infrastructure AND/OR PM2 services
#############################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Parse arguments
RESTART_DOCKER=false
if [ "$1" = "--with-docker" ]; then
  RESTART_DOCKER=true
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔄 Restarting AR.IO x402 Bundler"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Restart Docker infrastructure if requested
if [ "$RESTART_DOCKER" = true ]; then
  echo "🐳 Restarting Docker infrastructure..."
  cd "$PROJECT_ROOT"
  docker compose restart postgres redis-cache redis-queues minio
  echo "   Waiting for services to be ready..."
  sleep 5

  # Ensure MinIO buckets exist (safe to run multiple times)
  echo "   Ensuring MinIO buckets are initialized..."
  docker compose up minio-init

  echo -e "${GREEN}✓${NC} Docker infrastructure restarted"
  echo ""
fi

# Restart PM2 services
echo "🔄 Restarting PM2 services..."
if pm2 list | grep -q "upload-api\|upload-workers\|bull-board"; then
  pm2 restart all
  echo -e "${GREEN}✓${NC} PM2 services restarted"
else
  echo -e "${YELLOW}⚠️${NC}  No PM2 services running"
  echo "   Starting services instead..."
  echo ""
  exec "$SCRIPT_DIR/start.sh"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ System restarted${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Status:"
pm2 list
echo ""
docker compose ps 2>/dev/null || true
echo ""
echo "Commands:"
echo "  pm2 logs           - View logs"
echo "  pm2 monit          - Monitor processes"
echo ""
echo "To restart with Docker infrastructure:"
echo "  ./scripts/restart.sh --with-docker"
echo ""
