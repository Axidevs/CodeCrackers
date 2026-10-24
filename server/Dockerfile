# =========================================================
# CURA Backend Dockerfile (Node.js 20 Alpine)
# =========================================================

FROM node:20-alpine AS base

# Install curl for container health check
RUN apk add --no-cache curl

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install clean production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY src/ ./src/

# Create runtime non-root user for security
USER node

# Expose backend port
EXPOSE 5001

# Environment defaults
ENV PORT=5001
ENV NODE_ENV=production

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5001/api/health || exit 1

# Start CURA backend
CMD ["node", "src/server.js"]
