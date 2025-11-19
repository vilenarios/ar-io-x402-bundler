#!/bin/bash
set -e

# GitHub Container Registry push script
# Usage: ./push-to-ghcr.sh [version]
# Example: ./push-to-ghcr.sh v1.0.0

# Prerequisites:
# 1. Create GitHub Personal Access Token: https://github.com/settings/tokens/new
#    Required permissions: write:packages, read:packages
# 2. Login to GHCR:
#    echo $GITHUB_TOKEN | docker login ghcr.io -u vilenarios --password-stdin
# 3. If you need sudo, use: sudo -E ./push-to-ghcr.sh (preserves environment)

VERSION=${1:-latest}
GITHUB_USER="vilenarios"
IMAGE_NAME="ar-io-x402-bundler"

# Check if logged in to GHCR
if ! docker info 2>/dev/null | grep -q "ghcr.io"; then
  echo "⚠️  Not logged in to ghcr.io"
  echo "Please login first:"
  echo "  echo \$GITHUB_TOKEN | docker login ghcr.io -u vilenarios --password-stdin"
  echo ""
  echo "Need to use sudo? Try:"
  echo "  echo \$GITHUB_TOKEN | sudo docker login ghcr.io -u vilenarios --password-stdin"
  exit 1
fi

echo "Building Docker image..."
docker build -t ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:${VERSION} .

echo "Tagging as latest..."
docker tag ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:${VERSION} ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:latest

echo "Pushing to GitHub Container Registry..."
docker push ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:${VERSION}
docker push ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:latest

echo "✅ Successfully pushed:"
echo "  - ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:${VERSION}"
echo "  - ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:latest"
echo ""
echo "Next steps:"
echo "1. Set package visibility: https://github.com/${GITHUB_USER}/${IMAGE_NAME}/pkgs/container/${IMAGE_NAME}"
echo "2. Pull on deployment server: docker pull ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:latest"
