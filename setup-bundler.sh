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
DB_POOL_MIN="2"
DB_POOL_MAX="10"
REDIS_CACHE_HOST="redis-cache"
REDIS_CACHE_PORT="6379"
REDIS_QUEUE_HOST="redis-queue"
REDIS_QUEUE_PORT="6381"
AWS_REGION="us-east-1"
AWS_ENDPOINT="http://minio:9000"
AWS_ACCESS_KEY_ID="minioadmin"
AWS_SECRET_ACCESS_KEY="minioadmin"
AWS_S3_BUCKET="bundler-data-items"
AWS_S3_FORCE_PATH_STYLE="true"
ARWEAVE_GATEWAY="https://arweave.net"
ADMIN_USERNAME="admin"
BULL_BOARD_PORT="3002"
X402_FRAUD_TOLERANCE_PERCENT="5"
X402_PRICING_BUFFER_PERCENT="15"
X402_PAYMENT_TIMEOUT_MS="300000"
MAX_DATA_ITEM_SIZE="10737418240"
BUNDLE_SIZE_LIMIT="250000000"
ENABLE_OPTICAL_POSTING="false"

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
    X402_NETWORKS='{"base-sepolia":{"enabled":true,"rpcUrl":"https://sepolia.base.org","usdcAddress":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","facilitatorUrl":"https://x402.org/facilitator"}}'
    echo -e "${GREEN}✓${NC} Testnet (Base Sepolia) selected"
    break
  elif [[ "$network_choice" == "2" ]]; then
    NETWORK_TYPE="mainnet"
    X402_NETWORKS='{"base":{"enabled":true,"rpcUrl":"https://mainnet.base.org","usdcAddress":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","facilitatorUrl":"https://facilitator.base.coinbasecloud.net"}}'
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
# Step 5: Optional Settings
#############################
echo -e "${CYAN}━━━ Step 5/5: Optional Settings ━━━${NC}"
echo ""
echo "Configure optional features (or press Enter to skip)."
echo ""

# Allow-listed addresses
echo "Allow-listed Addresses (comma-separated):"
echo "  These addresses can upload for free without payment."
echo ""
read -p "Allow-listed addresses (or Enter to skip): " ALLOW_LISTED_ADDRESSES

echo ""

# AR.IO Gateway Integration
echo "AR.IO Gateway Integration:"
echo "  Enables optimistic caching to your AR.IO gateway."
echo ""
read -p "Enable AR.IO gateway integration? (y/N): " enable_ario

if [[ "$enable_ario" =~ ^[Yy]$ ]]; then
  ENABLE_OPTICAL_POSTING="true"
  read -p "AR.IO Gateway URL [http://localhost:4000]: " ario_url
  OPTICAL_BRIDGE_URL="${ario_url:-http://localhost:4000}/ar-io/admin/queue-data-item"

  read -p "AR.IO Admin Key: " AR_IO_ADMIN_KEY

  echo -e "${GREEN}✓${NC} AR.IO gateway integration enabled"
else
  OPTICAL_BRIDGE_URL=""
  AR_IO_ADMIN_KEY=""
fi

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
DB_POOL_MIN=${DB_POOL_MIN}
DB_POOL_MAX=${DB_POOL_MAX}

#############################################
# Redis Configuration
#############################################
REDIS_CACHE_HOST=${REDIS_CACHE_HOST}
REDIS_CACHE_PORT=${REDIS_CACHE_PORT}
REDIS_QUEUE_HOST=${REDIS_QUEUE_HOST}
REDIS_QUEUE_PORT=${REDIS_QUEUE_PORT}

#############################################
# Object Storage (MinIO/S3)
#############################################
AWS_REGION=${AWS_REGION}
AWS_ENDPOINT=${AWS_ENDPOINT}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_S3_BUCKET=${AWS_S3_BUCKET}
AWS_S3_FORCE_PATH_STYLE=${AWS_S3_FORCE_PATH_STYLE}

#############################################
# Arweave Configuration
#############################################
ARWEAVE_GATEWAY=${ARWEAVE_GATEWAY}
ARWEAVE_WALLET_FILE=${ARWEAVE_WALLET_FILE}

#############################################
# x402 Payment Configuration
#############################################
X402_PAYMENT_ADDRESS=${X402_PAYMENT_ADDRESS}
X402_NETWORKS=${X402_NETWORKS}

EOF

# Add CDP credentials if mainnet
if [ "$NETWORK_TYPE" == "mainnet" ]; then
  cat >> .env << EOF
# Coinbase CDP Credentials (Mainnet)
CDP_API_KEY_ID=${CDP_API_KEY_ID}
CDP_API_KEY_SECRET=${CDP_API_KEY_SECRET}

EOF
fi

cat >> .env << EOF
# x402 Advanced Settings
X402_FRAUD_TOLERANCE_PERCENT=${X402_FRAUD_TOLERANCE_PERCENT}
X402_PRICING_BUFFER_PERCENT=${X402_PRICING_BUFFER_PERCENT}
X402_PAYMENT_TIMEOUT_MS=${X402_PAYMENT_TIMEOUT_MS}

#############################################
# Bundling Configuration
#############################################
MAX_DATA_ITEM_SIZE=${MAX_DATA_ITEM_SIZE}
BUNDLE_SIZE_LIMIT=${BUNDLE_SIZE_LIMIT}
ENABLE_OPTICAL_POSTING=${ENABLE_OPTICAL_POSTING}

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
echo "  • Gateway: $ARWEAVE_GATEWAY"
echo ""

echo "Payment:"
echo "  • Your Address: $X402_PAYMENT_ADDRESS"
if [ "$NETWORK_TYPE" == "mainnet" ]; then
  echo "  • CDP Configured: Yes"
fi
echo ""

echo "Admin Dashboard:"
echo "  • Username: $ADMIN_USERNAME"
echo "  • Password: $ADMIN_PASSWORD"
echo "  • Port: $BULL_BOARD_PORT"
echo ""

if [ -n "$ALLOW_LISTED_ADDRESSES" ]; then
  echo "Optional Features:"
  echo "  • Allow-listed: $ALLOW_LISTED_ADDRESSES"
fi

if [ "$ENABLE_OPTICAL_POSTING" == "true" ]; then
  echo "  • AR.IO Gateway: Enabled"
  echo "    URL: $OPTICAL_BRIDGE_URL"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Offer to start bundler
echo "What would you like to do next?"
echo ""
echo "  1) Start the bundler now (./start-bundler.sh)"
echo "  2) Exit (start manually later)"
echo ""

while true; do
  read -p "Choose option (1 or 2) [1]: " start_choice
  start_choice=${start_choice:-1}

  if [[ "$start_choice" == "1" ]]; then
    echo ""
    echo -e "${GREEN}🚀 Starting bundler...${NC}"
    echo ""
    exec ./start-bundler.sh
    break
  elif [[ "$start_choice" == "2" ]]; then
    echo ""
    echo "Setup complete! To start your bundler, run:"
    echo ""
    echo "  ./start-bundler.sh"
    echo ""
    echo "Your configuration is saved in .env"
    echo ""
    exit 0
  else
    echo -e "${RED}Invalid choice. Please enter 1 or 2.${NC}"
  fi
done
