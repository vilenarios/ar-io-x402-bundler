#!/bin/bash

#############################
# Verify AR.IO x402 Bundler System Health
# Checks all services and infrastructure
#############################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔍 AR.IO x402 Bundler System Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Function to check and report
check() {
  local name="$1"
  local command="$2"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

  if eval "$command" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $name"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
    return 0
  else
    echo -e "${RED}✗${NC} $name"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  fi
}

# Function to check with output
check_with_output() {
  local name="$1"
  local command="$2"
  local expected="$3"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

  local output=$(eval "$command" 2>&1)
  if echo "$output" | grep -q "$expected"; then
    echo -e "${GREEN}✓${NC} $name"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
    return 0
  else
    echo -e "${RED}✗${NC} $name (got: ${output:0:50})"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    return 1
  fi
}

# Section: Docker Infrastructure
echo -e "${BLUE}━━━ Docker Infrastructure ━━━${NC}"
check "PostgreSQL container running" "docker ps | grep -q ar-io-x402-bundler-postgres"
check "PostgreSQL is healthy" "docker ps | grep ar-io-x402-bundler-postgres | grep -q '(healthy)'"
check "Redis Cache container running" "docker ps | grep -q ar-io-x402-bundler-redis-cache"
check "Redis Cache is healthy" "docker ps | grep ar-io-x402-bundler-redis-cache | grep -q '(healthy)'"
check "Redis Queues container running" "docker ps | grep -q ar-io-x402-bundler-redis-queues"
check "Redis Queues is healthy" "docker ps | grep ar-io-x402-bundler-redis-queues | grep -q '(healthy)'"
check "MinIO container running" "docker ps | grep -q ar-io-x402-bundler-minio"
check "MinIO is healthy" "docker ps | grep ar-io-x402-bundler-minio | grep -q '(healthy)'"
echo ""

# Section: PM2 Processes
echo -e "${BLUE}━━━ PM2 Services ━━━${NC}"
check "PM2 is running" "pm2 list > /dev/null 2>&1"
check "upload-api process exists" "pm2 list | grep -q upload-api"
check "upload-api is online" "pm2 list | grep upload-api | grep -q online"
check "upload-workers process exists" "pm2 list | grep -q upload-workers"
check "upload-workers is online" "pm2 list | grep upload-workers | grep -q online"
check "bull-board process exists" "pm2 list | grep -q bull-board"
check "bull-board is online" "pm2 list | grep bull-board | grep -q online"
echo ""

# Section: HTTP Endpoints
echo -e "${BLUE}━━━ HTTP Endpoints ━━━${NC}"
check_with_output "Upload service health endpoint" "curl -s http://localhost:3001/health" "OK"
check "Upload service port 3001 listening" "ss -tlnp 2>/dev/null | grep -q ':3001' || netstat -tln 2>/dev/null | grep -q ':3001'"
check "Bull Board port 3002 listening" "ss -tlnp 2>/dev/null | grep -q ':3002' || netstat -tln 2>/dev/null | grep -q ':3002'"
echo ""

# Section: Service Connectivity
echo -e "${BLUE}━━━ Service Connectivity ━━━${NC}"
check "Upload service connected to Redis" "pm2 logs upload-api --lines 50 --nostream 2>&1 | grep -q 'Connected to Elasticache at localhost'"
check "Upload service listening on port" "pm2 logs upload-api --lines 50 --nostream 2>&1 | grep -q 'Listening on port 3001'"
echo ""

# Section: Cron Jobs
echo -e "${BLUE}━━━ Background Jobs ━━━${NC}"
check "Bundle planning cron job configured" "crontab -l 2>/dev/null | grep -q trigger-plan"
echo ""

# Section: Log Checks (No Critical Errors)
echo -e "${BLUE}━━━ Error Checks ━━━${NC}"
if pm2 logs upload-api --lines 100 --nostream 2>&1 | grep -v "OTEL" | grep -qi "error.*failed\|critical\|cannot start" | head -1; then
  echo -e "${YELLOW}⚠${NC}  Upload service has recent errors (check logs)"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
else
  check "Upload service: no critical errors" "true"
fi

if pm2 logs upload-workers --lines 100 --nostream 2>&1 | grep -qi "error.*failed\|critical\|cannot start" | head -1; then
  echo -e "${YELLOW}⚠${NC}  Upload workers have recent errors (check logs)"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
else
  check "Upload workers: no critical errors" "true"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}Summary:${NC}"
echo "  Total Checks: $TOTAL_CHECKS"
echo -e "  ${GREEN}Passed: $PASSED_CHECKS${NC}"
if [ $FAILED_CHECKS -gt 0 ]; then
  echo -e "  ${RED}Failed: $FAILED_CHECKS${NC}"
fi
echo ""

# Overall status
if [ $FAILED_CHECKS -eq 0 ]; then
  echo -e "${GREEN}✅ All systems operational!${NC}"
  echo ""
  echo "Service URLs:"
  echo "  Upload Service:     http://localhost:3001"
  echo "  Queue Monitoring:   http://localhost:3002/admin/queues"
  echo "  MinIO Console:      http://localhost:9001"
  echo ""
  echo "Next steps:"
  echo "  • Test upload: curl -X POST http://localhost:3001/v1/tx -H 'Content-Type: application/octet-stream' --data 'Hello Arweave!'"
  echo "  • View logs: pm2 logs"
  echo "  • Monitor: pm2 monit"
  echo ""
  exit 0
else
  echo -e "${RED}❌ System has issues - check failed items above${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "  • View logs: pm2 logs"
  echo "  • Restart services: ./scripts/restart.sh"
  echo "  • Full restart: ./scripts/stop.sh && ./scripts/start.sh"
  echo ""
  exit 1
fi
