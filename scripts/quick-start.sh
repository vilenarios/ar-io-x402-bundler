#!/bin/bash

#############################################################################
# AR.IO Bundler Lite - Quick Start Script
#############################################################################
#
# This script automates the complete setup of the x402 bundler:
# 1. Validates prerequisites (Node.js, Yarn, Docker)
# 2. Generates secure admin password
# 3. Creates and configures .env file
# 4. Starts Docker infrastructure (PostgreSQL, Redis, MinIO)
# 5. Installs dependencies
# 6. Runs database migrations
# 7. Builds TypeScript
# 8. Starts bundler and admin services
#
# Usage:
#   ./quick-start.sh [options]
#
# Options:
#   --wallet PATH         Path to Arweave wallet JWK file (required)
#   --x402-address ADDR   Your EVM address for receiving USDC payments (required)
#   --network NETWORK     Network: testnet (default) or mainnet
#   --skip-build          Skip yarn build step (use existing build)
#   --skip-docker         Skip docker-compose up (use existing infrastructure)
#   --help                Show this help message
#
# Examples:
#   ./quick-start.sh --wallet ./wallet.json --x402-address 0x123...
#   ./quick-start.sh --wallet ./wallet.json --x402-address 0x123... --network mainnet
#
#############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
NETWORK="testnet"
SKIP_BUILD=false
SKIP_DOCKER=false
WALLET_PATH=""
X402_ADDRESS=""

#############################################################################
# Helper Functions
#############################################################################

print_header() {
    echo -e "${CYAN}"
    echo "═══════════════════════════════════════════════════════════════"
    echo "  $1"
    echo "═══════════════════════════════════════════════════════════════"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

#############################################################################
# Parse Arguments
#############################################################################

while [[ $# -gt 0 ]]; do
    case $1 in
        --wallet)
            WALLET_PATH="$2"
            shift 2
            ;;
        --x402-address)
            X402_ADDRESS="$2"
            shift 2
            ;;
        --network)
            NETWORK="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-docker)
            SKIP_DOCKER=true
            shift
            ;;
        --help)
            grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# *//'
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Run with --help for usage information"
            exit 1
            ;;
    esac
done

#############################################################################
# Validate Prerequisites
#############################################################################

print_header "Step 1: Validating Prerequisites"

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed"
    echo "Please install Node.js >= 18.0.0 from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version must be >= 18.0.0 (found $(node -v))"
    exit 1
fi
print_success "Node.js $(node -v) found"

# Check Yarn
if ! command -v yarn &> /dev/null; then
    print_error "Yarn is not installed"
    echo "Installing Yarn globally..."
    npm install -g yarn
fi
print_success "Yarn $(yarn -v) found"

# Check Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed"
    echo "Please install Docker from https://www.docker.com/get-started"
    exit 1
fi
print_success "Docker $(docker -v | awk '{print $3}' | sed 's/,//') found"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not installed"
    echo "Please install Docker Compose"
    exit 1
fi
print_success "Docker Compose found"

# Validate required arguments
if [ -z "$WALLET_PATH" ]; then
    print_error "Arweave wallet path is required"
    echo "Usage: ./quick-start.sh --wallet /path/to/wallet.json --x402-address 0x..."
    exit 1
fi

if [ -z "$X402_ADDRESS" ]; then
    print_error "x402 payment address is required"
    echo "Usage: ./quick-start.sh --wallet /path/to/wallet.json --x402-address 0x..."
    exit 1
fi

# Validate wallet file exists
if [ ! -f "$WALLET_PATH" ]; then
    print_error "Wallet file not found: $WALLET_PATH"
    exit 1
fi
print_success "Wallet file found: $WALLET_PATH"

# Convert wallet path to absolute path
WALLET_ABSOLUTE=$(readlink -f "$WALLET_PATH")
print_info "Absolute wallet path: $WALLET_ABSOLUTE"

# Validate x402 address format
if [[ ! "$X402_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    print_error "Invalid EVM address format: $X402_ADDRESS"
    echo "Address must be 0x-prefixed 40 hex characters (e.g., 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb)"
    exit 1
fi
print_success "x402 address validated: $X402_ADDRESS"

#############################################################################
# Step 2: Generate Configuration
#############################################################################

print_header "Step 2: Generating Configuration"

# Generate admin password
ADMIN_PASSWORD=$(openssl rand -hex 32)
print_success "Generated secure admin password"

# Determine network configuration
if [ "$NETWORK" = "mainnet" ]; then
    print_info "Configuring for MAINNET"
    X402_NETWORKS='{"base":{"enabled":true,"rpcUrl":"https://mainnet.base.org","usdcAddress":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","facilitatorUrl":"https://facilitator.base.coinbasecloud.net"}}'
    print_warning "MAINNET requires Coinbase CDP credentials (CDP_API_KEY_ID, CDP_API_KEY_SECRET)"
    print_warning "Get credentials from: https://portal.cdp.coinbase.com/"
elif [ "$NETWORK" = "testnet" ]; then
    print_info "Configuring for TESTNET (Base Sepolia)"
    X402_NETWORKS='{"base-sepolia":{"enabled":true,"rpcUrl":"https://sepolia.base.org","usdcAddress":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","facilitatorUrl":"https://x402.org/facilitator"}}'
    print_success "Testnet mode - no CDP credentials required"
else
    print_error "Invalid network: $NETWORK (must be 'testnet' or 'mainnet')"
    exit 1
fi

# Create .env file
print_info "Creating .env file..."

cat > .env << EOF
#############################################################################
# AR.IO Bundler Lite - Environment Configuration
# Generated by quick-start.sh on $(date)
#############################################################################

#############################################
# Service Configuration
#############################################
NODE_ENV=production
PORT=3001
LOG_LEVEL=info

#############################################
# Database Configuration
#############################################
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_DATABASE=bundler_lite
DB_POOL_MIN=2
DB_POOL_MAX=10

#############################################
# Redis Configuration
#############################################
REDIS_CACHE_HOST=localhost
REDIS_CACHE_PORT=6379
REDIS_QUEUE_HOST=localhost
REDIS_QUEUE_PORT=6381

#############################################
# Object Storage (MinIO)
#############################################
AWS_REGION=us-east-1
AWS_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_S3_BUCKET=bundler-data-items
AWS_S3_FORCE_PATH_STYLE=true

#############################################
# Arweave Configuration
#############################################
ARWEAVE_GATEWAY=https://arweave.net
ARWEAVE_WALLET_FILE=$WALLET_ABSOLUTE

#############################################
# x402 Payment Configuration
#############################################
X402_PAYMENT_ADDRESS=$X402_ADDRESS
X402_NETWORKS=$X402_NETWORKS
X402_FRAUD_TOLERANCE_PERCENT=5
X402_PRICING_BUFFER_PERCENT=5
X402_PAYMENT_TIMEOUT_MS=300000

# Coinbase CDP Credentials (REQUIRED for mainnet)
# Get from https://portal.cdp.coinbase.com/
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=

#############################################
# Bundling Configuration
#############################################
MAX_DATA_ITEM_SIZE=10737418240
BUNDLE_SIZE_LIMIT=250000000
ENABLE_OPTICAL_POSTING=false

#############################################
# Admin Dashboard Configuration
#############################################
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
BULL_BOARD_PORT=3002
EOF

print_success "Created .env file with secure configuration"

#############################################################################
# Step 3: Start Docker Infrastructure
#############################################################################

if [ "$SKIP_DOCKER" = false ]; then
    print_header "Step 3: Starting Docker Infrastructure"

    print_info "Starting PostgreSQL, Redis, and MinIO..."
    docker-compose up -d

    print_info "Waiting for services to be ready..."
    sleep 5

    # Wait for PostgreSQL to be ready
    print_info "Waiting for PostgreSQL to accept connections..."
    for i in {1..30}; do
        if docker-compose exec -T postgres pg_isready -U postgres &> /dev/null; then
            print_success "PostgreSQL is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "PostgreSQL did not become ready in time"
            exit 1
        fi
        sleep 1
    done

    # Wait for Redis to be ready
    print_info "Waiting for Redis to accept connections..."
    for i in {1..30}; do
        if docker-compose exec -T redis redis-cli ping &> /dev/null; then
            print_success "Redis is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "Redis did not become ready in time"
            exit 1
        fi
        sleep 1
    done

    print_success "All infrastructure services are running"
else
    print_header "Step 3: Skipping Docker (using existing infrastructure)"
fi

#############################################################################
# Step 4: Install Dependencies
#############################################################################

print_header "Step 4: Installing Dependencies"

yarn install
print_success "Dependencies installed successfully"

#############################################################################
# Step 5: Database Migrations
#############################################################################

print_header "Step 5: Running Database Migrations"

yarn db:migrate
print_success "Database migrations completed"

#############################################################################
# Step 6: Build TypeScript
#############################################################################

if [ "$SKIP_BUILD" = false ]; then
    print_header "Step 6: Building TypeScript"

    yarn build
    print_success "TypeScript build completed"
else
    print_header "Step 6: Skipping Build (using existing build)"
fi

#############################################################################
# Step 7: Display Summary
#############################################################################

print_header "Setup Complete!"

echo ""
echo -e "${GREEN}✓ AR.IO Bundler Lite is ready to run!${NC}"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "${CYAN}Configuration Summary${NC}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Network:           $NETWORK"
echo "  Payment Address:   $X402_ADDRESS"
echo "  Wallet:            $WALLET_ABSOLUTE"
echo "  Database:          bundler_lite @ localhost:5432"
echo "  Admin Password:    $ADMIN_PASSWORD"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "${CYAN}Services${NC}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Bundler API:       http://localhost:3001"
echo "  Admin Dashboard:   http://localhost:3002/admin/dashboard"
echo "  Queue Monitor:     http://localhost:3002/admin/queues"
echo "  MinIO Console:     http://localhost:9001 (minioadmin/minioadmin)"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "${CYAN}Next Steps${NC}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  1. Start the bundler service:"
echo "     ${GREEN}yarn start${NC}"
echo ""
echo "  2. In a new terminal, start the admin dashboard:"
echo "     ${GREEN}yarn admin${NC}"
echo ""
echo "  3. Access the admin dashboard:"
echo "     ${GREEN}http://localhost:3002/admin/dashboard${NC}"
echo "     Username: ${YELLOW}admin${NC}"
echo "     Password: ${YELLOW}$ADMIN_PASSWORD${NC}"
echo ""
if [ "$NETWORK" = "mainnet" ]; then
    echo -e "${YELLOW}⚠  MAINNET CONFIGURATION REQUIRED:${NC}"
    echo ""
    echo "  Edit .env and add your Coinbase CDP credentials:"
    echo "    CDP_API_KEY_ID=your-key-id"
    echo "    CDP_API_KEY_SECRET=your-key-secret"
    echo ""
    echo "  Get credentials from: https://portal.cdp.coinbase.com/"
    echo ""
fi
echo "═══════════════════════════════════════════════════════════════"
echo -e "${CYAN}Testing x402 Payments${NC}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Get a price quote:"
echo "    ${GREEN}curl http://localhost:3001/v1/x402/price/3/$X402_ADDRESS?bytes=1024${NC}"
echo ""
echo "  View OpenAPI documentation:"
echo "    ${GREEN}curl http://localhost:3001/openapi.json | jq${NC}"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "${CYAN}Management Commands${NC}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  View infrastructure logs:"
echo "    ${GREEN}docker-compose logs -f${NC}"
echo ""
echo "  Stop infrastructure:"
echo "    ${GREEN}docker-compose down${NC}"
echo ""
echo "  Stop infrastructure and delete data:"
echo "    ${GREEN}docker-compose down -v${NC}"
echo ""
echo "  Run database migrations:"
echo "    ${GREEN}yarn db:migrate${NC}"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}Happy bundling! 🚀${NC}"
echo ""
