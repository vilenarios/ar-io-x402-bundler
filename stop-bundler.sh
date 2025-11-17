#!/bin/bash

#############################
# AR.IO x402 Bundler - Stop All Services
#############################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🛑 Stopping AR.IO x402 Bundler"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$1" == "--clean" ]; then
  echo -e "${YELLOW}⚠️  Stopping and removing ALL data (volumes)${NC}"
  echo "   This will delete:"
  echo "   - All uploaded data items"
  echo "   - Database contents"
  echo "   - MinIO storage"
  echo ""
  read -p "Are you sure? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker-compose down -v
    echo -e "${GREEN}✓${NC} All services stopped and data removed"
  else
    echo "Cancelled"
    exit 0
  fi
else
  docker-compose down
  echo -e "${GREEN}✓${NC} All services stopped (data preserved)"
  echo ""
  echo "To remove all data as well, run:"
  echo "  ./stop-bundler.sh --clean"
fi

echo ""
