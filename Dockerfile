# AR.IO Bundler Lite - Dockerfile
# Multi-stage build for optimized production image

###############################################################################
# Stage 1: Builder - Install dependencies and build TypeScript
###############################################################################
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    openssl

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN yarn build

# Generate a default admin password if not provided
RUN echo "Default admin password: $(openssl rand -hex 32)" > /tmp/admin-password.txt

###############################################################################
# Stage 2: Runtime - Create minimal production image
###############################################################################
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    dumb-init \
    openssl

# Create non-root user BEFORE copying files
RUN addgroup -g 1001 -S bundler && \
    adduser -S bundler -u 1001

# Copy files with correct ownership from the start
COPY --chown=bundler:bundler package.json yarn.lock ./
COPY --chown=bundler:bundler --from=builder /app/lib ./lib
COPY --chown=bundler:bundler --from=builder /app/node_modules ./node_modules
COPY --chown=bundler:bundler .env.sample ./

# Switch to non-root user
USER bundler

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT:-3001}/v1/info', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Expose ports
EXPOSE 3001

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the bundler service
CMD ["node", "lib/server.js"]
