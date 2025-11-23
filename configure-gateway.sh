#!/bin/bash

#############################
# Configure AR.IO Gateway for Bundler Integration
#############################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

GATEWAY_ENV="/programs/ar-io-node/.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${CYAN}🔗 Configure Gateway for Bundler Integration${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if gateway .env exists
if [ ! -f "$GATEWAY_ENV" ]; then
  echo -e "${RED}✗${NC} Gateway .env not found at: $GATEWAY_ENV"
  echo "   Please check your AR.IO gateway installation"
  exit 1
fi

echo -e "${GREEN}✓${NC} Found gateway .env"
echo ""

# Backup gateway .env
BACKUP_FILE="${GATEWAY_ENV}.backup.$(date +%s)"
echo "Creating backup..."
sudo cp "$GATEWAY_ENV" "$BACKUP_FILE"
echo -e "${GREEN}✓${NC} Backup created: $BACKUP_FILE"
echo ""

# Remove old bundler integration if exists
echo "Removing old bundler integration (if any)..."
sudo sed -i '/# Bundler integration/,/^$/d' "$GATEWAY_ENV" 2>/dev/null || true
sudo sed -i '/ANS104_UNBUNDLE_FILTER/d' "$GATEWAY_ENV" 2>/dev/null || true
sudo sed -i '/ANS104_INDEX_FILTER/d' "$GATEWAY_ENV" 2>/dev/null || true
sudo sed -i '/AWS_S3_CONTIGUOUS_DATA_BUCKET/d' "$GATEWAY_ENV" 2>/dev/null || true
sudo sed -i '/AWS_S3_CONTIGUOUS_DATA_PREFIX/d' "$GATEWAY_ENV" 2>/dev/null || true
sudo sed -i '/BUNDLER_URLS/d' "$GATEWAY_ENV" 2>/dev/null || true
sudo sed -i '/AWS_ENDPOINT=/d' "$GATEWAY_ENV" 2>/dev/null || true
sudo sed -i '/AWS_ACCESS_KEY_ID=/d' "$GATEWAY_ENV" 2>/dev/null || true
sudo sed -i '/AWS_SECRET_ACCESS_KEY=/d' "$GATEWAY_ENV" 2>/dev/null || true
echo -e "${GREEN}✓${NC} Old configuration removed"
echo ""

# Add new bundler integration
echo "Adding bundler integration configuration..."
sudo tee -a "$GATEWAY_ENV" > /dev/null <<'EOF'

# ============================================
# Bundler integration - Added by ar-io-x402-bundler ($(date))
# ============================================

# MinIO Configuration for accessing bundler's data items
AWS_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=bundler-admin
AWS_SECRET_ACCESS_KEY=fdfed81a6ea89e014a501dfd741a84e0
AWS_REGION=us-east-1
AWS_S3_CONTIGUOUS_DATA_BUCKET=bundler-data-items
AWS_S3_CONTIGUOUS_DATA_PREFIX=raw-data-item

# Bundler URL for uploads
BUNDLER_URLS=https://arweave.nexus

# ANS-104 Unbundle Filter - only unbundle bundles from your bundler
ANS104_UNBUNDLE_FILTER='{"attributes": {"owner_address": "_TEfo0iHrEury-i3rDDgchwDxeZW0Llq74g0nmsq34k"}}'

# ANS-104 Index Filter - always index data items from bundles
ANS104_INDEX_FILTER='{"always": true}'
EOF

echo -e "${GREEN}✓${NC} Bundler integration added"
echo ""

# Check ON_DEMAND_RETRIEVAL_ORDER
echo "Checking ON_DEMAND_RETRIEVAL_ORDER..."
if grep -q "^ON_DEMAND_RETRIEVAL_ORDER=" "$GATEWAY_ENV"; then
  CURRENT_ORDER=$(grep "^ON_DEMAND_RETRIEVAL_ORDER=" "$GATEWAY_ENV" | cut -d= -f2)

  if echo "$CURRENT_ORDER" | grep -q "^s3,"; then
    echo -e "${GREEN}✓${NC} ON_DEMAND_RETRIEVAL_ORDER already includes s3 first"
  else
    echo -e "${YELLOW}⚠${NC}  ON_DEMAND_RETRIEVAL_ORDER needs s3 added to the beginning"
    echo ""
    echo "Current: ON_DEMAND_RETRIEVAL_ORDER=$CURRENT_ORDER"
    echo "Need to update to: ON_DEMAND_RETRIEVAL_ORDER=s3,$CURRENT_ORDER"
    echo ""
    read -p "Update automatically? (Y/n): " update_order
    update_order=${update_order:-Y}

    if [[ "$update_order" =~ ^[Yy]$ ]]; then
      sudo sed -i "s|^ON_DEMAND_RETRIEVAL_ORDER=|ON_DEMAND_RETRIEVAL_ORDER=s3,|" "$GATEWAY_ENV"
      echo -e "${GREEN}✓${NC} ON_DEMAND_RETRIEVAL_ORDER updated"
    else
      echo -e "${YELLOW}⚠${NC}  You'll need to manually add 's3,' to the beginning of ON_DEMAND_RETRIEVAL_ORDER"
    fi
  fi
else
  echo -e "${YELLOW}⚠${NC}  ON_DEMAND_RETRIEVAL_ORDER not found in .env"
  echo "   Add this line manually:"
  echo "   ON_DEMAND_RETRIEVAL_ORDER=s3,trusted-gateways,ar-io-network,chunks-offset-aware,tx-data"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Configuration Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo ""
echo "1. Restart your AR.IO gateway:"
echo "   ${GREEN}cd /programs/ar-io-node && sudo docker-compose restart${NC}"
echo ""
echo "2. Restart your bundler (to apply new MinIO credentials):"
echo "   ${GREEN}cd ~/source/ar-io-x402-bundler && ./stop-bundler.sh && ./start-bundler.sh${NC}"
echo ""
echo "3. Test the integration:"
echo "   ${GREEN}curl https://arweave.nexus/local/upload/v1/info${NC}"
echo ""
echo "MinIO Credentials:"
echo "  • Username: bundler-admin"
echo "  • Password: fdfed81a6ea89e014a501dfd741a84e0"
echo "  • Console: http://localhost:9001"
echo ""
