#!/bin/bash
set -e

# GitHub Container Registry push script
# Usage: ./push-to-ghcr.sh [version]
# Example: ./push-to-ghcr.sh v1.0.0

VERSION=${1:-latest}
GITHUB_USER="vilenarios"
IMAGE_NAME="ar-io-x402-bundler"

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
