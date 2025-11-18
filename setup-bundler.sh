#!/bin/bash

#############################
# AR.IO x402 Bundler - Interactive Setup
#
# This script guides you through configuring your bundler.
# It will create a .env file with all necessary settings.
#############################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Clear screen and show welcome
clear
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${BOLD}🚀 AR.IO x402 Bundler - Interactive Setup${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "This wizard will help you configure your bundler."
echo "It will create a .env file with all necessary settings."
echo ""

# Check if .env already exists
if [ -f ".env" ]; then
  echo -e "${YELLOW}⚠️  .env file already exists!${NC}"
  echo ""
  read -p "Do you want to overwrite it? (y/N): " overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    echo ""
    echo "Setup cancelled. Existing .env file preserved."
    exit 0
  fi
  mv .env .env.backup.$(date +%s)
  echo -e "${GREEN}✓${NC} Backed up existing .env file"
  echo ""
fi

# Initialize variables
NODE_ENV="production"
PORT="3001"
LOG_LEVEL="info"
DB_HOST="postgres"
DB_PORT="5432"
DB_USER="postgres"
DB_PASSWORD="postgres"
DB_DATABASE="bundler_lite"
ELASTICACHE_HOST="redis-cache"
ELASTICACHE_PORT="6379"
ELASTICACHE_NO_CLUSTERING="true"
REDIS_HOST="redis-queue"
REDIS_PORT_QUEUES="6379"
AWS_REGION="us-east-1"
AWS_ENDPOINT="http://minio:9000"
AWS_ACCESS_KEY_ID="minioadmin"
AWS_SECRET_ACCESS_KEY="minioadmin"
DATA_ITEM_BUCKET="bundler-data-items"
S3_FORCE_PATH_STYLE="true"
ARWEAVE_GATEWAY="https://arweave.net"
PUBLIC_ACCESS_GATEWAY="https://arweave.nexus"
ADMIN_USERNAME="admin"
BULL_BOARD_PORT="3002"
X402_FRAUD_TOLERANCE_PERCENT="5"
X402_PRICING_BUFFER_PERCENT="15"
X402_PAYMENT_TIMEOUT_MS="300000"
MAX_DATA_ITEM_SIZE="10737418240"
MAX_BUNDLE_SIZE="250000000"
OPTICAL_BRIDGING_ENABLED="true"

#############################
# Step 1: Network Selection
#############################
echo -e "${CYAN}━━━ Step 1/5: Network Selection ━━━${NC}"
echo ""
echo "Which network do you want to use?"
echo ""
echo "  1) Testnet (Base Sepolia) - Recommended for testing"
echo "     • Free testnet USDC"
echo "     • No CDP credentials needed"
echo "     • Public facilitator"
echo ""
echo "  2) Mainnet (Base) - Production use"
echo "     • Real USDC payments"
echo "     • Requires Coinbase CDP credentials"
echo "     • Production facilitator"
echo ""

while true; do
  read -p "Select network (1 or 2) [1]: " network_choice
  network_choice=${network_choice:-1}

  if [[ "$network_choice" == "1" ]]; then
    NETWORK_TYPE="testnet"
    echo -e "${GREEN}✓${NC} Testnet (Base Sepolia) selected"
    break
  elif [[ "$network_choice" == "2" ]]; then
    NETWORK_TYPE="mainnet"
    echo -e "${GREEN}✓${NC} Mainnet (Base) selected"
    break
  else
    echo -e "${RED}Invalid choice. Please enter 1 or 2.${NC}"
  fi
done

echo ""

#############################
# Step 2: Arweave Wallet
#############################
echo -e "${CYAN}━━━ Step 2/5: Arweave Wallet ━━━${NC}"
echo ""
echo "Your bundler needs an Arweave wallet to sign bundles."
echo "This must be an ABSOLUTE path (e.g., /home/user/wallet.json)"
echo ""

ARWEAVE_OWNER_ADDRESS=""

while true; do
  read -p "Enter path to Arweave wallet file: " ARWEAVE_WALLET_FILE

  # Expand ~ to home directory
  ARWEAVE_WALLET_FILE="${ARWEAVE_WALLET_FILE/#\~/$HOME}"

  # Check if it's an absolute path
  if [[ "$ARWEAVE_WALLET_FILE" != /* ]]; then
    # Convert relative to absolute
    ARWEAVE_WALLET_FILE="$(cd "$(dirname "$ARWEAVE_WALLET_FILE")" 2>/dev/null && pwd)/$(basename "$ARWEAVE_WALLET_FILE")" || ARWEAVE_WALLET_FILE=""
  fi

  if [ -z "$ARWEAVE_WALLET_FILE" ]; then
    echo -e "${RED}✗ Invalid path${NC}"
    continue
  fi

  if [ ! -f "$ARWEAVE_WALLET_FILE" ]; then
    echo -e "${YELLOW}⚠️  File not found: $ARWEAVE_WALLET_FILE${NC}"
    read -p "Continue anyway? (y/N): " continue_anyway
    if [[ "$continue_anyway" =~ ^[Yy]$ ]]; then
      echo -e "${YELLOW}⚠️${NC} Wallet file will need to exist before starting bundler"
      break
    fi
  else
    echo -e "${GREEN}✓${NC} Wallet file found"

    # Try to extract owner address for gateway integration
    if command -v node &> /dev/null; then
      ARWEAVE_OWNER_ADDRESS=$(node -e "
        const fs = require('fs');
        const crypto = require('crypto');
        try {
          const jwk = JSON.parse(fs.readFileSync('$ARWEAVE_WALLET_FILE', 'utf8'));
          const n = Buffer.from(jwk.n, 'base64url');
          const hash = crypto.createHash('sha256').update(n).digest();
          console.log(hash.toString('base64url'));
        } catch (e) {
          console.log('');
        }
      " 2>/dev/null || echo "")

      if [ -n "$ARWEAVE_OWNER_ADDRESS" ]; then
        echo -e "${GREEN}✓${NC} Wallet address: $ARWEAVE_OWNER_ADDRESS"
      fi
    fi
    break
  fi
done

echo ""

#############################
# Step 3: x402 Payment Address
#############################
echo -e "${CYAN}━━━ Step 3/5: Payment Configuration ━━━${NC}"
echo ""
echo "Enter your Ethereum address to receive USDC payments."
echo "This should be an address you control (e.g., 0x742d35Cc...)"
echo ""

while true; do
  read -p "Your Ethereum address (0x...): " X402_PAYMENT_ADDRESS

  # Validate Ethereum address format
  if [[ "$X402_PAYMENT_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    echo -e "${GREEN}✓${NC} Valid Ethereum address"
    break
  else
    echo -e "${RED}✗ Invalid Ethereum address format${NC}"
    echo "   Expected: 0x followed by 40 hexadecimal characters"
  fi
done

echo ""

# Mainnet: Ask for CDP credentials
if [ "$NETWORK_TYPE" == "mainnet" ]; then
  echo -e "${YELLOW}Mainnet requires Coinbase CDP credentials${NC}"
  echo "Get them from: https://portal.cdp.coinbase.com/"
  echo ""

  read -p "CDP API Key ID: " CDP_API_KEY_ID
  read -p "CDP API Key Secret: " CDP_API_KEY_SECRET

  echo -e "${GREEN}✓${NC} CDP credentials saved"
  echo ""
else
  CDP_API_KEY_ID=""
  CDP_API_KEY_SECRET=""
fi

# Facilitator Configuration
echo ""
echo "x402 Facilitator Configuration:"
echo "  Facilitators handle payment settlement on-chain."
echo "  Multiple facilitators provide automatic fallback if one fails."
echo ""

if [ "$NETWORK_TYPE" == "mainnet" ]; then
  echo "  Default facilitators for Base Mainnet:"
  echo "    1. Coinbase (https://api.cdp.coinbase.com/platform/v2/x402)"
  echo "    2. Mogami (https://facilitator.mogami.tech) - fallback"
else
  echo "  Default facilitator for Base Sepolia:"
  echo "    • Mogami (https://facilitator.mogami.tech)"
fi

echo ""
read -p "Customize facilitators? (y/N): " customize_facilitators
customize_facilitators=${customize_facilitators:-N}

if [[ "$customize_facilitators" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Enter comma-separated list of facilitator URLs."
  echo "Example: https://facilitator1.com,https://facilitator2.com"
  echo ""

  if [ "$NETWORK_TYPE" == "mainnet" ]; then
    read -p "Base Mainnet facilitators: " X402_FACILITATORS_BASE
  else
    read -p "Base Sepolia facilitators: " X402_FACILITATORS_BASE_TESTNET
  fi

  echo -e "${GREEN}✓${NC} Custom facilitators configured"
  echo ""
else
  X402_FACILITATORS_BASE=""
  X402_FACILITATORS_BASE_TESTNET=""
  echo -e "${GREEN}✓${NC} Using default facilitators"
  echo ""
fi

#############################
# Step 4: Admin Dashboard
#############################
echo -e "${CYAN}━━━ Step 4/5: Admin Dashboard ━━━${NC}"
echo ""
echo "Configure admin dashboard access."
echo ""

read -p "Admin username [admin]: " admin_user_input
ADMIN_USERNAME=${admin_user_input:-admin}

echo ""
echo "Admin password options:"
echo "  1) Auto-generate secure password (recommended)"
echo "  2) Enter my own password"
echo ""

while true; do
  read -p "Choose option (1 or 2) [1]: " password_choice
  password_choice=${password_choice:-1}

  if [[ "$password_choice" == "1" ]]; then
    ADMIN_PASSWORD=$(openssl rand -hex 32)
    echo -e "${GREEN}✓${NC} Generated secure password"
    break
  elif [[ "$password_choice" == "2" ]]; then
    read -sp "Enter password: " ADMIN_PASSWORD
    echo ""
    if [ -z "$ADMIN_PASSWORD" ]; then
      echo -e "${RED}✗ Password cannot be empty${NC}"
      continue
    fi
    echo -e "${GREEN}✓${NC} Custom password set"
    break
  else
    echo -e "${RED}Invalid choice. Please enter 1 or 2.${NC}"
  fi
done

echo ""

#############################
# Step 5: Gateway Configuration
#############################
echo -e "${CYAN}━━━ Step 5/7: Gateway Configuration ━━━${NC}"
echo ""

# Public Access Gateway - Better explanation
echo "Where should users READ their uploaded data from?"
echo ""
echo "After uploading to your bundler, users need a gateway to read their data."
echo "This URL is shown in the /info endpoint."
echo ""
echo "  1) My own AR.IO gateway (recommended if you're running one)"
echo "  2) arweave.net (Arweave mainnet - reliable but centralized)"
echo "  3) Custom gateway URL"
echo ""

while true; do
  read -p "Select option (1, 2, or 3) [1]: " gateway_choice
  gateway_choice=${gateway_choice:-1}

  if [[ "$gateway_choice" == "1" ]]; then
    read -p "Your gateway's public URL (e.g., https://arweave.nexus): " gateway_url_input
    if [ -z "$gateway_url_input" ]; then
      echo -e "${RED}✗ Gateway URL cannot be empty${NC}"
      continue
    fi
    PUBLIC_ACCESS_GATEWAY="$gateway_url_input"
    USING_OWN_GATEWAY="true"
    echo -e "${GREEN}✓${NC} Using your gateway: $PUBLIC_ACCESS_GATEWAY"
    break
  elif [[ "$gateway_choice" == "2" ]]; then
    PUBLIC_ACCESS_GATEWAY="https://arweave.net"
    USING_OWN_GATEWAY="false"
    echo -e "${GREEN}✓${NC} Using Arweave mainnet: $PUBLIC_ACCESS_GATEWAY"
    break
  elif [[ "$gateway_choice" == "3" ]]; then
    read -p "Enter custom gateway URL: " custom_gateway
    if [ -z "$custom_gateway" ]; then
      echo -e "${RED}✗ Gateway URL cannot be empty${NC}"
      continue
    fi
    PUBLIC_ACCESS_GATEWAY="$custom_gateway"
    USING_OWN_GATEWAY="false"
    echo -e "${GREEN}✓${NC} Using custom gateway: $PUBLIC_ACCESS_GATEWAY"
    break
  else
    echo -e "${RED}Invalid choice. Please enter 1, 2, or 3.${NC}"
  fi
done

echo ""

# Free Upload Limit
echo "Free Upload Limit:"
echo "  Allow small uploads without payment (0 = all uploads require payment)"
echo ""
read -p "Free upload limit in bytes [0]: " free_limit_input
FREE_UPLOAD_LIMIT=${free_limit_input:-0}
if [ "$FREE_UPLOAD_LIMIT" == "0" ]; then
  echo -e "${GREEN}✓${NC} All uploads will require x402 payment"
else
  echo -e "${GREEN}✓${NC} Free uploads up to $FREE_UPLOAD_LIMIT bytes"
fi

echo ""

#############################
# Step 6: Gateway Integration
#############################
if [ "$USING_OWN_GATEWAY" == "true" ]; then
  echo -e "${CYAN}━━━ Step 6/7: AR.IO Gateway Integration ━━━${NC}"
  echo ""
  echo "Let's configure vertical integration between your bundler and gateway."
  echo ""

  read -p "Enable AR.IO gateway integration? (Y/n): " enable_ario
  enable_ario=${enable_ario:-Y}

  if [[ "$enable_ario" =~ ^[Yy]$ ]]; then
    echo ""
    echo "Deployment Topology:"
    echo "  1) Same server - bundler and gateway on same machine"
    echo "  2) Different servers - bundler and gateway on different machines"
    echo ""

    while true; do
      read -p "Select deployment (1 or 2) [1]: " deployment_choice
      deployment_choice=${deployment_choice:-1}

      if [[ "$deployment_choice" == "1" ]]; then
        DEPLOYMENT_TYPE="same-server"
        echo -e "${GREEN}✓${NC} Same server deployment"
        echo ""

        echo "Are the bundler and gateway in the same Docker network?"
        echo "  (They can communicate via container names)"
        echo ""
        read -p "Same Docker network? (Y/n): " same_network
        same_network=${same_network:-Y}

        if [[ "$same_network" =~ ^[Yy]$ ]]; then
          SAME_DOCKER_NETWORK="true"
          echo ""
          read -p "Gateway container/service name [ar-io-core]: " gateway_container
          GATEWAY_CONTAINER_NAME=${gateway_container:-ar-io-core}

          # Set URLs for same Docker network
          ARIO_GATEWAY_URL="http://${GATEWAY_CONTAINER_NAME}:4000"
          GATEWAY_MINIO_ENDPOINT="http://minio:9000"

          echo -e "${GREEN}✓${NC} Gateway URL: $ARIO_GATEWAY_URL"
          echo -e "${GREEN}✓${NC} MinIO endpoint (for gateway): $GATEWAY_MINIO_ENDPOINT"
        else
          SAME_DOCKER_NETWORK="false"
          echo ""
          echo -e "${YELLOW}Different Docker networks - you'll need to use host networking${NC}"
          ARIO_GATEWAY_URL="http://host.docker.internal:4000"
          GATEWAY_MINIO_ENDPOINT="http://host.docker.internal:9000"
          echo -e "${GREEN}✓${NC} Gateway URL: $ARIO_GATEWAY_URL"
          echo -e "${GREEN}✓${NC} MinIO endpoint (for gateway): $GATEWAY_MINIO_ENDPOINT"
        fi
        break

      elif [[ "$deployment_choice" == "2" ]]; then
        DEPLOYMENT_TYPE="different-servers"
        SAME_DOCKER_NETWORK="false"
        echo -e "${GREEN}✓${NC} Different servers deployment"
        echo ""

        read -p "Gateway server hostname/IP: " gateway_host
        read -p "Gateway port [4000]: " gateway_port
        gateway_port=${gateway_port:-4000}

        ARIO_GATEWAY_URL="http://${gateway_host}:${gateway_port}"

        echo ""
        echo -e "${YELLOW}⚠️  For remote gateway integration, you need to:${NC}"
        echo "  1. Expose MinIO publicly or via VPN"
        echo "  2. Configure firewall rules between servers"
        echo ""

        read -p "Public MinIO endpoint (e.g., https://minio.yourdomain.com:9000): " minio_endpoint
        GATEWAY_MINIO_ENDPOINT="$minio_endpoint"

        echo -e "${GREEN}✓${NC} Gateway URL: $ARIO_GATEWAY_URL"
        echo -e "${GREEN}✓${NC} MinIO endpoint (for gateway): $GATEWAY_MINIO_ENDPOINT"
        break

      else
        echo -e "${RED}Invalid choice. Please enter 1 or 2.${NC}"
      fi
    done

    echo ""
    OPTICAL_BRIDGE_URL="${ARIO_GATEWAY_URL}/ar-io/admin/queue-data-item"

    read -p "AR.IO Admin Key: " AR_IO_ADMIN_KEY
    echo ""

    # Ask for bundler public URL ONLY if gateway integration is enabled
    echo "Bundler Public URL:"
    echo "  What public URL will users access this bundler at?"
    echo "  (e.g., https://upload.services.vilenarios.com)"
    echo ""
    read -p "Bundler public URL: " BUNDLER_PUBLIC_URL

    while [ -z "$BUNDLER_PUBLIC_URL" ]; do
      echo -e "${YELLOW}⚠️  Bundler public URL is required for gateway integration${NC}"
      read -p "Bundler public URL: " BUNDLER_PUBLIC_URL
    done

    echo -e "${GREEN}✓${NC} Bundler public URL: $BUNDLER_PUBLIC_URL"
    echo ""

    # Gateway auto-configuration
    if [ -n "$ARWEAVE_OWNER_ADDRESS" ]; then
      echo "Gateway Auto-Configuration:"
      echo "  Would you like to automatically update your AR.IO gateway's .env?"
      echo ""
      read -p "Path to AR.IO gateway directory (e.g., /programs/ar-io-node) or Enter to skip: " ARIO_GATEWAY_DIR

      if [ -n "$ARIO_GATEWAY_DIR" ]; then
        ARIO_GATEWAY_DIR="${ARIO_GATEWAY_DIR/#\~/$HOME}"

        if [ -d "$ARIO_GATEWAY_DIR" ]; then
          CONFIGURE_GATEWAY="true"
          echo -e "${GREEN}✓${NC} Will configure gateway at: $ARIO_GATEWAY_DIR"
        else
          echo -e "${YELLOW}⚠️${NC}  Directory not found. Skipping auto-configuration."
          CONFIGURE_GATEWAY="false"
        fi
      else
        CONFIGURE_GATEWAY="false"
      fi
    else
      CONFIGURE_GATEWAY="false"
    fi
  else
    OPTICAL_BRIDGE_URL=""
    AR_IO_ADMIN_KEY=""
    BUNDLER_PUBLIC_URL=""
    CONFIGURE_GATEWAY="false"
  fi
else
  # Skip gateway integration if not using own gateway
  OPTICAL_BRIDGE_URL=""
  AR_IO_ADMIN_KEY=""
  BUNDLER_PUBLIC_URL=""
  CONFIGURE_GATEWAY="false"
fi

echo ""

#############################
# Step 7: Optional Features
#############################
echo -e "${CYAN}━━━ Step 7/7: Optional Features ━━━${NC}"
echo ""

# Allow-listed addresses
echo "Allow-listed Addresses:"
echo "  These addresses can upload for free without payment."
echo ""
read -p "Allow-listed addresses (comma-separated, or Enter to skip): " ALLOW_LISTED_ADDRESSES

echo ""

# Cleanup Configuration
echo "Data Cleanup Configuration:"
echo "  The bundler automatically cleans up old data to save disk space."
echo "  Storage tiers: Filesystem (hot cache) → MinIO (cold storage) → Arweave (permanent)"
echo ""

echo "Filesystem cleanup (hot cache for bundling performance):"
read -p "  Keep filesystem backups for how many days? [7]: " fs_cleanup_days
FILESYSTEM_CLEANUP_DAYS=${fs_cleanup_days:-7}
echo -e "${GREEN}✓${NC} Filesystem retention: $FILESYSTEM_CLEANUP_DAYS days"

echo ""
echo "MinIO cleanup (cold storage for disaster recovery):"
read -p "  Keep MinIO data for how many days? [90]: " minio_cleanup_days
MINIO_CLEANUP_DAYS=${minio_cleanup_days:-90}
echo -e "${GREEN}✓${NC} MinIO retention: $MINIO_CLEANUP_DAYS days"

echo ""
echo "Cleanup schedule (cron format):"
echo "  Examples: '0 2 * * *' (daily 2 AM), '0 */6 * * *' (every 6 hours)"
read -p "  Cleanup cron schedule [0 2 * * *]: " cleanup_cron
CLEANUP_CRON=${cleanup_cron:-"0 2 * * *"}
echo -e "${GREEN}✓${NC} Cleanup schedule: $CLEANUP_CRON"

echo ""

#############################
# Create .env file
#############################
echo -e "${CYAN}━━━ Creating .env file... ━━━${NC}"
echo ""

cat > .env << EOF
# AR.IO Bundler Lite - x402 Configuration
# Generated by setup-bundler.sh on $(date)

#############################################
# Service Configuration
#############################################
NODE_ENV=${NODE_ENV}
PORT=${PORT}
LOG_LEVEL=${LOG_LEVEL}

#############################################
# Database Configuration
#############################################
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_DATABASE=${DB_DATABASE}

#############################################
# Redis Configuration
#############################################
# Redis for caching (Elasticache-compatible)
ELASTICACHE_HOST=${ELASTICACHE_HOST}
ELASTICACHE_PORT=${ELASTICACHE_PORT}
ELASTICACHE_NO_CLUSTERING=${ELASTICACHE_NO_CLUSTERING}

# Redis for job queues (BullMQ)
REDIS_HOST=${REDIS_HOST}
REDIS_PORT_QUEUES=${REDIS_PORT_QUEUES}

#############################################
# Object Storage (MinIO/S3)
#############################################
AWS_REGION=${AWS_REGION}
AWS_ENDPOINT=${AWS_ENDPOINT}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
DATA_ITEM_BUCKET=${DATA_ITEM_BUCKET}
S3_FORCE_PATH_STYLE=${S3_FORCE_PATH_STYLE}

#############################################
# Arweave Configuration
#############################################
ARWEAVE_GATEWAY=${ARWEAVE_GATEWAY}
PUBLIC_ACCESS_GATEWAY=${PUBLIC_ACCESS_GATEWAY}
ARWEAVE_WALLET_FILE=${ARWEAVE_WALLET_FILE}

#############################################
# x402 Payment Configuration
#############################################
X402_PAYMENT_ADDRESS=${X402_PAYMENT_ADDRESS}

EOF

# Add CDP credentials if mainnet
if [ "$NETWORK_TYPE" == "mainnet" ]; then
  cat >> .env << EOF
# Coinbase CDP Credentials (Mainnet)
CDP_API_KEY_ID=${CDP_API_KEY_ID}
CDP_API_KEY_SECRET=${CDP_API_KEY_SECRET}

EOF
fi

# Add facilitator configuration
cat >> .env << EOF
# x402 Facilitator Configuration (Multi-Facilitator Fallback)
# Provide comma-separated list of facilitators (tries in order until one succeeds)
EOF

if [ -n "$X402_FACILITATORS_BASE" ]; then
  echo "X402_FACILITATORS_BASE=${X402_FACILITATORS_BASE}" >> .env
else
  echo "# X402_FACILITATORS_BASE=" >> .env
fi

if [ -n "$X402_FACILITATORS_BASE_TESTNET" ]; then
  echo "X402_FACILITATORS_BASE_TESTNET=${X402_FACILITATORS_BASE_TESTNET}" >> .env
else
  echo "# X402_FACILITATORS_BASE_TESTNET=" >> .env
fi

cat >> .env << EOF

# x402 Advanced Settings
X402_FRAUD_TOLERANCE_PERCENT=${X402_FRAUD_TOLERANCE_PERCENT}
X402_PRICING_BUFFER_PERCENT=${X402_PRICING_BUFFER_PERCENT}
X402_PAYMENT_TIMEOUT_MS=${X402_PAYMENT_TIMEOUT_MS}

#############################################
# Info Endpoint Configuration
#############################################
# Ethereum address shown in info endpoint (uses x402 payment address)
ETHEREUM_ADDRESS=${X402_PAYMENT_ADDRESS}
# Free upload limit in bytes (0 = all uploads require payment)
FREE_UPLOAD_LIMIT=${FREE_UPLOAD_LIMIT}

#############################################
# Bundling Configuration
#############################################
MAX_DATA_ITEM_SIZE=${MAX_DATA_ITEM_SIZE}
MAX_BUNDLE_SIZE=${MAX_BUNDLE_SIZE}
APP_NAME=AR.IO Bundler
OPTICAL_BRIDGING_ENABLED=${OPTICAL_BRIDGING_ENABLED}

#############################################
# Data Cleanup Configuration
#############################################
# How many days to keep filesystem backups before cleanup
# Filesystem backups are used as hot cache during bundling
# After bundling, items are in MinIO + Arweave, so filesystem can be cleaned
FILESYSTEM_CLEANUP_DAYS=7

# How many days to keep MinIO data before cleanup
# MinIO is cold storage for disaster recovery and re-bundling
# After this period, items are only in Arweave (permanent storage)
MINIO_CLEANUP_DAYS=90

# Cleanup job schedule (cron format)
# Default: "0 2 * * *" (daily at 2 AM UTC)
# Examples:
#   "0 */6 * * *"  - Every 6 hours
#   "0 3 * * 0"    - Weekly on Sunday at 3 AM
#   "0 1 1 * *"    - Monthly on the 1st at 1 AM
CLEANUP_CRON=0 2 * * *

#############################################
# Optional: Allow-listed Addresses
#############################################
EOF

if [ -n "$ALLOW_LISTED_ADDRESSES" ]; then
  echo "ALLOW_LISTED_ADDRESSES=${ALLOW_LISTED_ADDRESSES}" >> .env
else
  echo "# ALLOW_LISTED_ADDRESSES=" >> .env
fi

cat >> .env << EOF

#############################################
# Optional: Raw Data Uploads
#############################################
# Enable raw data uploads (for AI agents that can't create ANS-104 data items)
# RAW_DATA_UPLOADS_ENABLED=true
# RAW_DATA_ITEM_JWK_FILE=/absolute/path/to/your/raw-data-wallet.json

#############################################
# Optional: AR.IO Gateway Integration
#############################################
EOF

if [ -n "$OPTICAL_BRIDGE_URL" ]; then
  echo "OPTICAL_BRIDGE_URL=${OPTICAL_BRIDGE_URL}" >> .env
  echo "AR_IO_ADMIN_KEY=${AR_IO_ADMIN_KEY}" >> .env
else
  echo "# OPTICAL_BRIDGE_URL=" >> .env
  echo "# AR_IO_ADMIN_KEY=" >> .env
fi

cat >> .env << EOF

#############################################
# Admin Dashboard Configuration
#############################################
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
BULL_BOARD_PORT=${BULL_BOARD_PORT}
EOF

echo -e "${GREEN}✓${NC} .env file created successfully"
echo ""

#############################
# Configure AR.IO Gateway
#############################
if [ "$CONFIGURE_GATEWAY" == "true" ]; then
  echo -e "${CYAN}━━━ Configuring AR.IO Gateway ━━━${NC}"
  echo ""

  GATEWAY_ENV_FILE="$ARIO_GATEWAY_DIR/.env"

  if [ ! -f "$GATEWAY_ENV_FILE" ]; then
    echo -e "${RED}✗${NC} Gateway .env file not found at: $GATEWAY_ENV_FILE"
    echo "   Skipping gateway configuration"
  else
    # Backup gateway .env
    cp "$GATEWAY_ENV_FILE" "$GATEWAY_ENV_FILE.backup.$(date +%s)"
    echo -e "${GREEN}✓${NC} Backed up gateway .env file"

    # Remove old bundler integration settings if they exist
    sed -i '/# Bundler integration/,/^$/d' "$GATEWAY_ENV_FILE" 2>/dev/null || true
    sed -i '/ANS104_UNBUNDLE_FILTER/d' "$GATEWAY_ENV_FILE" 2>/dev/null || true
    sed -i '/ANS104_INDEX_FILTER/d' "$GATEWAY_ENV_FILE" 2>/dev/null || true
    sed -i '/AWS_S3_CONTIGUOUS_DATA_BUCKET/d' "$GATEWAY_ENV_FILE" 2>/dev/null || true
    sed -i '/AWS_S3_CONTIGUOUS_DATA_PREFIX/d' "$GATEWAY_ENV_FILE" 2>/dev/null || true
    sed -i '/BUNDLER_URLS/d' "$GATEWAY_ENV_FILE" 2>/dev/null || true

    # Remove old AWS/MinIO settings if they exist
    sed -i '/AWS_ENDPOINT=/d' "$GATEWAY_ENV_FILE" 2>/dev/null || true
    sed -i '/AWS_S3_CONTIGUOUS_DATA_BUCKET=/d' "$GATEWAY_ENV_FILE" 2>/dev/null || true
    sed -i '/AWS_S3_CONTIGUOUS_DATA_PREFIX=/d' "$GATEWAY_ENV_FILE" 2>/dev/null || true

    # Add bundler integration settings
    cat >> "$GATEWAY_ENV_FILE" << GATEWAY_EOF

# Bundler integration - Added by ar-io-x402-bundler setup ($(date))
# Only unbundle bundles from this bundler's Arweave address
ANS104_UNBUNDLE_FILTER='{"attributes": {"owner_address": "$ARWEAVE_OWNER_ADDRESS"}}'

# Always index data items from bundles
ANS104_INDEX_FILTER='{"always": true}'

# S3/MinIO configuration for accessing bundler's data items
AWS_ENDPOINT=${GATEWAY_MINIO_ENDPOINT}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_REGION=${AWS_REGION}
AWS_S3_CONTIGUOUS_DATA_BUCKET=${DATA_ITEM_BUCKET}
AWS_S3_CONTIGUOUS_DATA_PREFIX=raw-data-item

# Bundler URL for uploads
BUNDLER_URLS=${BUNDLER_PUBLIC_URL}

GATEWAY_EOF

    echo -e "${GREEN}✓${NC} Updated gateway .env with bundler integration"
    echo ""
    echo -e "${YELLOW}IMPORTANT:${NC} You need to manually update this gateway setting:"
    echo ""
    echo "1. Add 's3' to the BEGINNING of ON_DEMAND_RETRIEVAL_ORDER:"
    echo "   ON_DEMAND_RETRIEVAL_ORDER=s3,trusted-gateways,ar-io-network,chunks-offset-aware,tx-data"
    echo ""
    echo "   This tells the gateway to check MinIO first for data items."
    echo ""
    echo "2. Restart your AR.IO gateway to apply changes:"
    echo "   cd $ARIO_GATEWAY_DIR && docker-compose restart"
    echo ""
  fi
fi

#############################
# Summary
#############################
clear
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✅ Setup Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${BOLD}Configuration Summary:${NC}"
echo ""
echo "Network:"
echo "  • Type: $NETWORK_TYPE"
if [ "$NETWORK_TYPE" == "testnet" ]; then
  echo "  • Chain: Base Sepolia"
  echo "  • USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e"
else
  echo "  • Chain: Base Mainnet"
  echo "  • USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
fi
echo ""

echo "Arweave:"
echo "  • Wallet: $ARWEAVE_WALLET_FILE"
if [ -n "$ARWEAVE_OWNER_ADDRESS" ]; then
  echo "  • Address: $ARWEAVE_OWNER_ADDRESS"
fi
echo "  • Gateway (posting): $ARWEAVE_GATEWAY"
echo "  • Gateway (public): $PUBLIC_ACCESS_GATEWAY"
echo ""

echo "Payment:"
echo "  • Your Address: $X402_PAYMENT_ADDRESS"
if [ "$NETWORK_TYPE" == "mainnet" ]; then
  echo "  • CDP Configured: Yes"
fi
if [ "$FREE_UPLOAD_LIMIT" == "0" ]; then
  echo "  • Free Uploads: Disabled (all uploads require payment)"
else
  echo "  • Free Upload Limit: $FREE_UPLOAD_LIMIT bytes"
fi

# Show facilitators
if [ -n "$X402_FACILITATORS_BASE" ]; then
  echo "  • Facilitators (Base): Custom ($X402_FACILITATORS_BASE)"
elif [ "$NETWORK_TYPE" == "mainnet" ]; then
  echo "  • Facilitators (Base): Coinbase → Mogami (default)"
fi

if [ -n "$X402_FACILITATORS_BASE_TESTNET" ]; then
  echo "  • Facilitators (Sepolia): Custom ($X402_FACILITATORS_BASE_TESTNET)"
elif [ "$NETWORK_TYPE" == "testnet" ]; then
  echo "  • Facilitators (Sepolia): Mogami (default)"
fi
echo ""

echo "Admin Dashboard:"
echo "  • URL: http://localhost:$BULL_BOARD_PORT"
echo "  • Username: $ADMIN_USERNAME"
echo "  • Password: $ADMIN_PASSWORD"
echo ""

echo "Data Cleanup:"
echo "  • Filesystem retention: $FILESYSTEM_CLEANUP_DAYS days"
echo "  • MinIO retention: $MINIO_CLEANUP_DAYS days"
echo "  • Schedule: $CLEANUP_CRON (runs automatically)"
echo ""

if [ -n "$BUNDLER_PUBLIC_URL" ]; then
  echo "Bundler:"
  echo "  • Public URL: $BUNDLER_PUBLIC_URL"
  echo ""
fi

if [ -n "$ALLOW_LISTED_ADDRESSES" ]; then
  echo "Optional Features:"
  echo "  • Allow-listed: $ALLOW_LISTED_ADDRESSES"
fi

if [ -n "$OPTICAL_BRIDGE_URL" ]; then
  echo "AR.IO Gateway Integration:"
  echo "  • Enabled: Yes"
  echo "  • Gateway URL: $ARIO_GATEWAY_URL"
  echo "  • Bridge URL: $OPTICAL_BRIDGE_URL"
  if [ "$CONFIGURE_GATEWAY" == "true" ]; then
    echo "  • Gateway configured: Yes (at $ARIO_GATEWAY_DIR)"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

#############################
# Post-Setup Instructions
#############################
if [ -n "$BUNDLER_PUBLIC_URL" ]; then
  echo -e "${BOLD}📋 NEXT STEPS - Post-Setup Guide${NC}"
  echo ""
  echo "To complete your bundler deployment, follow these steps:"
  echo ""

  echo -e "${CYAN}Step 1: Start the Bundler${NC}"
  echo "  ./start-bundler.sh"
  echo ""

  echo -e "${CYAN}Step 2: Configure Nginx (Required for Public Access)${NC}"
  echo ""
  echo "  Add this to your nginx configuration to expose the bundler:"
  echo ""
  echo "  ${BOLD}# Bundler upload endpoint${NC}"
  echo "  location /local/upload {"
  echo "    proxy_pass http://localhost:3001;"
  echo "    proxy_http_version 1.1;"
  echo "    proxy_set_header Upgrade \$http_upgrade;"
  echo "    proxy_set_header Connection 'upgrade';"
  echo "    proxy_set_header Host \$host;"
  echo "    proxy_set_header X-Real-IP \$remote_addr;"
  echo "    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
  echo "    proxy_set_header X-Forwarded-Proto \$scheme;"
  echo ""
  echo "    # Large file upload support"
  echo "    client_max_body_size 10G;"
  echo "    proxy_request_buffering off;"
  echo "    proxy_read_timeout 300s;"
  echo "    proxy_connect_timeout 75s;"
  echo "  }"
  echo ""
  echo "  Then reload nginx:"
  echo "    sudo nginx -t && sudo nginx -s reload"
  echo ""

  if [ -n "$OPTICAL_BRIDGE_URL" ]; then
    echo -e "${CYAN}Step 3: Restart AR.IO Gateway${NC}"
    echo "  Your gateway .env has been updated. Restart to apply changes:"
    echo ""
    if [ "$CONFIGURE_GATEWAY" == "true" ] && [ -n "$ARIO_GATEWAY_DIR" ]; then
      echo "    cd $ARIO_GATEWAY_DIR && docker-compose restart"
    else
      echo "    cd /path/to/ar-io-node && docker-compose restart"
    fi
    echo ""

    echo -e "${CYAN}Step 4: Test the Integration${NC}"
    echo ""
    echo "  a) Check bundler info endpoint:"
    echo "     curl ${BUNDLER_PUBLIC_URL}/"
    echo ""
    echo "  b) Check gateway can reach bundler:"
    echo "     curl ${PUBLIC_ACCESS_GATEWAY}/local/upload/"
    echo ""
    echo "  c) Test upload (requires x402 payment):"
    echo "     echo 'Hello AR.IO' | curl -X POST ${BUNDLER_PUBLIC_URL}/v1/tx \\
      --data-binary @- \\
      -H 'Content-Type: application/octet-stream'"
    echo ""

    if [ "$DEPLOYMENT_TYPE" == "same-server" ] && [ "$SAME_DOCKER_NETWORK" == "true" ]; then
      echo -e "${CYAN}Step 5: Verify Docker Network${NC}"
      echo "  Make sure bundler and gateway are in the same Docker network:"
      echo ""
      echo "  # List networks"
      echo "  docker network ls"
      echo ""
      echo "  # Connect gateway to bundler network (if needed)"
      echo "  docker network connect ar-io-x402-bundler_default ${GATEWAY_CONTAINER_NAME}"
      echo ""
    fi

    if [ "$DEPLOYMENT_TYPE" == "different-servers" ]; then
      echo -e "${CYAN}Step 5: Configure Firewall/Networking${NC}"
      echo "  For remote gateway integration, ensure:"
      echo ""
      echo "  1. Gateway can reach bundler's optical bridge:"
      echo "     ${OPTICAL_BRIDGE_URL}"
      echo ""
      echo "  2. Gateway can reach MinIO:"
      echo "     ${GATEWAY_MINIO_ENDPOINT}"
      echo ""
      echo "  3. Firewall allows connections between servers"
      echo ""
    fi
  fi

  echo -e "${CYAN}Admin Dashboard${NC}"
  echo "  Access at: http://localhost:${BULL_BOARD_PORT}"
  echo "  Username: ${ADMIN_USERNAME}"
  echo "  Password: ${ADMIN_PASSWORD}"
  echo ""

  echo -e "${YELLOW}⚠️  Important Security Notes:${NC}"
  echo "  • Store your admin password securely"
  echo "  • Keep your Arweave wallet file safe"
  if [ "$NETWORK_TYPE" == "mainnet" ]; then
    echo "  • Keep your CDP API credentials secure"
  fi
  echo "  • Use HTTPS in production (configure SSL in nginx)"
  echo ""

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
fi

# Offer to start bundler
echo "What would you like to do next?"
echo ""
echo "  1) Start the bundler now (./start-bundler.sh)"
echo "  2) Show post-setup guide again"
echo "  3) Exit (start manually later)"
echo ""

while true; do
  read -p "Choose option (1, 2, or 3) [1]: " start_choice
  start_choice=${start_choice:-1}

  if [[ "$start_choice" == "1" ]]; then
    echo ""
    echo -e "${GREEN}🚀 Starting bundler...${NC}"
    echo ""
    exec ./start-bundler.sh
    break
  elif [[ "$start_choice" == "2" ]]; then
    echo ""
    echo "Post-setup guide saved to: setup-guide.txt"
    # Save post-setup guide to file for reference
    cat > setup-guide.txt << GUIDE_EOF
AR.IO x402 Bundler - Post-Setup Guide
Generated: $(date)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONFIGURATION SUMMARY:

Network: $NETWORK_TYPE
Bundler Public URL: $BUNDLER_PUBLIC_URL
Public Access Gateway: $PUBLIC_ACCESS_GATEWAY
AR.IO Gateway Integration: $([ -n "$OPTICAL_BRIDGE_URL" ] && echo "Enabled" || echo "Disabled")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DEPLOYMENT STEPS:

Step 1: Start the Bundler
  ./start-bundler.sh

Step 2: Configure Nginx
  Add this to your nginx configuration:

  # Bundler upload endpoint
  location /local/upload {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;

    # Large file upload support
    client_max_body_size 10G;
    proxy_request_buffering off;
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;
  }

  Then reload nginx:
    sudo nginx -t && sudo nginx -s reload

$([ -n "$OPTICAL_BRIDGE_URL" ] && cat << GATEWAY_GUIDE

Step 3: Restart AR.IO Gateway
  cd $([ "$CONFIGURE_GATEWAY" == "true" ] && echo "$ARIO_GATEWAY_DIR" || echo "/path/to/ar-io-node") && docker-compose restart

Step 4: Test the Integration
  a) Check bundler info endpoint:
     curl $BUNDLER_PUBLIC_URL/

  b) Check gateway can reach bundler:
     curl $PUBLIC_ACCESS_GATEWAY/local/upload/

  c) Test upload:
     echo 'Hello AR.IO' | curl -X POST $BUNDLER_PUBLIC_URL/v1/tx --data-binary @- -H 'Content-Type: application/octet-stream'

$([ "$DEPLOYMENT_TYPE" == "same-server" ] && [ "$SAME_DOCKER_NETWORK" == "true" ] && cat << NETWORK_GUIDE

Step 5: Verify Docker Network
  Make sure bundler and gateway are in the same Docker network:

  # List networks
  docker network ls

  # Connect gateway to bundler network (if needed)
  docker network connect ar-io-x402-bundler_default $GATEWAY_CONTAINER_NAME
NETWORK_GUIDE
)

$([ "$DEPLOYMENT_TYPE" == "different-servers" ] && cat << REMOTE_GUIDE

Step 5: Configure Firewall/Networking
  For remote gateway integration, ensure:

  1. Gateway can reach bundler's optical bridge:
     $OPTICAL_BRIDGE_URL

  2. Gateway can reach MinIO:
     $GATEWAY_MINIO_ENDPOINT

  3. Firewall allows connections between servers
REMOTE_GUIDE
)
GATEWAY_GUIDE
)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ADMIN DASHBOARD:
  URL: http://localhost:$BULL_BOARD_PORT
  Username: $ADMIN_USERNAME
  Password: $ADMIN_PASSWORD

SECURITY NOTES:
  • Store your admin password securely
  • Keep your Arweave wallet file safe
$([ "$NETWORK_TYPE" == "mainnet" ] && echo "  • Keep your CDP API credentials secure")
  • Use HTTPS in production (configure SSL in nginx)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GUIDE_EOF

    echo ""
    cat setup-guide.txt
    echo ""
  elif [[ "$start_choice" == "3" ]]; then
    echo ""
    echo "Setup complete! To start your bundler, run:"
    echo ""
    echo "  ./start-bundler.sh"
    echo ""
    if [ -n "$BUNDLER_PUBLIC_URL" ]; then
      echo "Post-setup guide saved to: setup-guide.txt"
      echo ""
    fi
    echo "Your configuration is saved in .env"
    echo ""
    exit 0
  else
    echo -e "${RED}Invalid choice. Please enter 1, 2, or 3.${NC}"
  fi
done
