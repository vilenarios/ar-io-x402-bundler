#!/bin/bash

#############################
# Configure AR.IO Gateway for Bundler Integration
# This script reads bundler configuration and applies it to the gateway
#############################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLER_ENV="$SCRIPT_DIR/.env"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${BOLD}${CYAN}🔗 Configure Gateway for Bundler Integration${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

#############################
# Load Bundler Configuration
#############################
if [ ! -f "$BUNDLER_ENV" ]; then
  echo -e "${RED}✗${NC} Bundler .env not found at: $BUNDLER_ENV"
  echo "   Please run setup-bundler.sh first to create .env"
  exit 1
fi

echo "Loading bundler configuration..."
# Source .env to get variables
set -a
source "$BUNDLER_ENV"
set +a

# Validate required variables
if [ -z "$AWS_ENDPOINT" ] || [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
  echo -e "${RED}✗${NC} Missing MinIO configuration in bundler .env"
  echo "   Required: AWS_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY"
  exit 1
fi

if [ -z "$UPLOAD_SERVICE_PUBLIC_URL" ]; then
  echo -e "${RED}✗${NC} Missing UPLOAD_SERVICE_PUBLIC_URL in bundler .env"
  exit 1
fi

# Extract owner address from wallet if available
ARWEAVE_OWNER_ADDRESS=""
if [ -n "$ARWEAVE_WALLET_FILE" ] && [ -f "$ARWEAVE_WALLET_FILE" ]; then
  echo "Extracting Arweave owner address from wallet..."
  ARWEAVE_OWNER_ADDRESS=$(node -e "
    const fs = require('fs');
    const crypto = require('crypto');
    try {
      const jwk = JSON.parse(fs.readFileSync('$ARWEAVE_WALLET_FILE', 'utf8'));
      const n = Buffer.from(jwk.n, 'base64');
      const hash = crypto.createHash('sha256').update(n).digest();
      console.log(hash.toString('base64url'));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  " 2>/dev/null || echo "")

  if [ -n "$ARWEAVE_OWNER_ADDRESS" ]; then
    echo -e "${GREEN}✓${NC} Owner address: $ARWEAVE_OWNER_ADDRESS"
  else
    echo -e "${YELLOW}⚠${NC}  Could not extract owner address from wallet"
    echo "   ANS104_UNBUNDLE_FILTER will not be configured"
  fi
fi

echo -e "${GREEN}✓${NC} Bundler configuration loaded"
echo ""

#############################
# Gateway Configuration
#############################
echo "Gateway Configuration:"
echo ""
read -p "Path to AR.IO gateway directory (e.g., /programs/ar-io-node): " GATEWAY_DIR

if [ -z "$GATEWAY_DIR" ]; then
  echo -e "${RED}✗${NC} Gateway directory is required"
  exit 1
fi

# Expand tilde
GATEWAY_DIR="${GATEWAY_DIR/#\~/$HOME}"

GATEWAY_ENV="$GATEWAY_DIR/.env"

# Check if gateway .env exists
if [ ! -f "$GATEWAY_ENV" ]; then
  echo -e "${RED}✗${NC} Gateway .env not found at: $GATEWAY_ENV"
  echo "   Please check your AR.IO gateway installation"
  exit 1
fi

echo -e "${GREEN}✓${NC} Found gateway .env at: $GATEWAY_ENV"
echo ""

# Determine MinIO endpoint for gateway
echo "MinIO Endpoint Configuration:"
echo "  The gateway needs to access the bundler's MinIO."
echo ""
echo "Select deployment topology:"
echo "  1) Same server - bundler and gateway on same machine"
echo "  2) Different servers - bundler and gateway on different machines"
echo ""

read -p "Select option (1 or 2) [1]: " deployment_choice
deployment_choice=${deployment_choice:-1}

if [[ "$deployment_choice" == "1" ]]; then
  echo ""
  echo "Are bundler and gateway in the same Docker network?"
  read -p "Same Docker network? (Y/n): " same_network
  same_network=${same_network:-Y}

  if [[ "$same_network" =~ ^[Yy]$ ]]; then
    GATEWAY_MINIO_ENDPOINT="http://minio:9000"
    echo -e "${GREEN}✓${NC} Using Docker network endpoint: $GATEWAY_MINIO_ENDPOINT"
  else
    GATEWAY_MINIO_ENDPOINT="http://host.docker.internal:9000"
    echo -e "${GREEN}✓${NC} Using host endpoint: $GATEWAY_MINIO_ENDPOINT"
  fi
elif [[ "$deployment_choice" == "2" ]]; then
  echo ""
  read -p "Public MinIO endpoint (e.g., https://minio.yourdomain.com:9000): " minio_endpoint
  GATEWAY_MINIO_ENDPOINT="$minio_endpoint"
  echo -e "${GREEN}✓${NC} Using remote endpoint: $GATEWAY_MINIO_ENDPOINT"
else
  echo -e "${RED}✗${NC} Invalid choice"
  exit 1
fi

echo ""

#############################
# Update Gateway .env
#############################
echo "Updating gateway configuration..."

# Backup gateway .env
BACKUP_FILE="${GATEWAY_ENV}.backup.$(date +%s)"
cp "$GATEWAY_ENV" "$BACKUP_FILE"
echo -e "${GREEN}✓${NC} Backed up gateway .env to: $BACKUP_FILE"

# Remove old bundler integration if exists
sed -i '/# Bundler integration/,/^$/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/# ============================================/,/^$/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/ANS104_UNBUNDLE_FILTER/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/ANS104_INDEX_FILTER/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/AWS_S3_CONTIGUOUS_DATA_BUCKET/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/AWS_S3_CONTIGUOUS_DATA_PREFIX/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/BUNDLER_URLS/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/AWS_ENDPOINT=/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/AWS_ACCESS_KEY_ID=/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/AWS_SECRET_ACCESS_KEY=/d' "$GATEWAY_ENV" 2>/dev/null || true
sed -i '/AWS_REGION=/d' "$GATEWAY_ENV" 2>/dev/null || true

echo -e "${GREEN}✓${NC} Removed old bundler integration"

# Add new bundler integration
cat >> "$GATEWAY_ENV" << GATEWAY_EOF

# ============================================
# Bundler integration - Added by ar-io-x402-bundler ($(date))
# ============================================

# MinIO Configuration for accessing bundler's data items
AWS_ENDPOINT=${GATEWAY_MINIO_ENDPOINT}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_REGION=${AWS_REGION}
AWS_S3_CONTIGUOUS_DATA_BUCKET=${DATA_ITEM_BUCKET}
AWS_S3_CONTIGUOUS_DATA_PREFIX=raw-data-item

# Bundler URL for uploads
BUNDLER_URLS=${UPLOAD_SERVICE_PUBLIC_URL}

GATEWAY_EOF

# Add ANS104 filters if owner address is available
if [ -n "$ARWEAVE_OWNER_ADDRESS" ]; then
  cat >> "$GATEWAY_ENV" << FILTER_EOF
# ANS-104 Unbundle Filter - only unbundle bundles from your bundler
ANS104_UNBUNDLE_FILTER='{"attributes": {"owner_address": "${ARWEAVE_OWNER_ADDRESS}"}}'

# ANS-104 Index Filter - always index data items from bundles
ANS104_INDEX_FILTER='{"always": true}'
FILTER_EOF
  echo -e "${GREEN}✓${NC} Added bundler integration with ANS-104 filters"
else
  echo -e "${GREEN}✓${NC} Added bundler integration (without ANS-104 filters)"
  echo -e "${YELLOW}⚠${NC}  Add ANS104_UNBUNDLE_FILTER and ANS104_INDEX_FILTER manually"
fi

echo ""

#############################
# Update ON_DEMAND_RETRIEVAL_ORDER
#############################
echo "Updating ON_DEMAND_RETRIEVAL_ORDER..."
if grep -q "^ON_DEMAND_RETRIEVAL_ORDER=" "$GATEWAY_ENV"; then
  CURRENT_ORDER=$(grep "^ON_DEMAND_RETRIEVAL_ORDER=" "$GATEWAY_ENV" | cut -d= -f2)

  if echo "$CURRENT_ORDER" | grep -q "^s3,"; then
    echo -e "${GREEN}✓${NC} ON_DEMAND_RETRIEVAL_ORDER already includes s3 first"
  else
    echo ""
    echo "Current: ON_DEMAND_RETRIEVAL_ORDER=$CURRENT_ORDER"
    echo "Updating to: ON_DEMAND_RETRIEVAL_ORDER=s3,$CURRENT_ORDER"
    echo ""
    read -p "Update ON_DEMAND_RETRIEVAL_ORDER? (Y/n): " update_order
    update_order=${update_order:-Y}

    if [[ "$update_order" =~ ^[Yy]$ ]]; then
      sed -i "s|^ON_DEMAND_RETRIEVAL_ORDER=|ON_DEMAND_RETRIEVAL_ORDER=s3,|" "$GATEWAY_ENV"
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
echo "Configuration Summary:"
echo "  • Gateway: $GATEWAY_DIR"
echo "  • MinIO Endpoint: $GATEWAY_MINIO_ENDPOINT"
echo "  • Bundler URL: $UPLOAD_SERVICE_PUBLIC_URL"
echo "  • Bucket: $DATA_ITEM_BUCKET"
if [ -n "$ARWEAVE_OWNER_ADDRESS" ]; then
  echo "  • Owner Address: $ARWEAVE_OWNER_ADDRESS"
fi
echo ""
echo "Next steps:"
echo ""
echo "1. Restart your AR.IO gateway to apply changes:"
echo "   ${GREEN}cd $GATEWAY_DIR && docker-compose restart${NC}"
echo ""
echo "2. Verify gateway can access MinIO:"
echo "   ${GREEN}docker exec ar-io-core curl -s ${GATEWAY_MINIO_ENDPOINT}${NC}"
echo ""
echo "3. Test the integration:"
echo "   ${GREEN}curl ${UPLOAD_SERVICE_PUBLIC_URL}/v1/info${NC}"
echo ""
