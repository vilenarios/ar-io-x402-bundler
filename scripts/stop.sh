#!/bin/bash

#############################
# Stop AR.IO x402 Bundler - FULL SYSTEM
# Stops PM2 services AND Docker infrastructure
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
STOP_DOCKER=true
if [ "$1" = "--services-only" ]; then
  STOP_DOCKER=false
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🛑 Stopping AR.IO x402 Bundler"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Stop PM2 services
echo "🛑 Stopping PM2 services..."
if pm2 list | grep -q "upload-api\|upload-workers\|bull-board"; then
  pm2 stop all 2>/dev/null || true
  pm2 delete all 2>/dev/null || true
  echo -e "${GREEN}✓${NC} PM2 services stopped and removed"
else
  echo -e "${YELLOW}⚠️${NC}  No PM2 services running"
fi

# Stop Docker infrastructure
if [ "$STOP_DOCKER" = true ]; then
  echo ""
  echo "🐳 Stopping Docker infrastructure..."
  cd "$PROJECT_ROOT"
  if docker compose ps | grep -q "Up"; then
    docker compose down
    echo -e "${GREEN}✓${NC} Docker infrastructure stopped"
  else
    echo -e "${YELLOW}⚠️${NC}  Docker infrastructure not running"
  fi
else
  echo ""
  echo -e "${YELLOW}ℹ️${NC}  Docker infrastructure left running (use --services-only flag removed to stop it)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ System stopped${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Status:"
pm2 list
echo ""
docker compose ps 2>/dev/null || true
echo ""
echo "To restart everything:"
echo "  ./scripts/start.sh"
echo ""
