# ====================================================
# Stage 1: Build Frontend (Vite + React)
# ====================================================
FROM --platform=linux/amd64 node:22-bookworm-slim AS frontend-builder
WORKDIR /build/fe

# Copy package definitions and install dependencies
COPY fe/package*.json ./
RUN npm install

# Copy frontend source code and build production bundle
COPY fe/ ./
RUN npm run build

# ====================================================
# Stage 2: Production Backend & Headless Chromium
# ====================================================
FROM --platform=linux/amd64 node:22-bookworm-slim AS runner

# Install Chromium, core system libraries, fonts and dumb-init
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-color-emoji \
    ca-certificates \
    dumb-init \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/be

# Configure runtime environment
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HEADLESS=true \
    CHROME_PATH=/usr/bin/chromium \
    CLIENT_DIST_DIR=/app/fe/dist

# Install production dependencies for backend
COPY be/package*.json ./
RUN npm install --omit=dev

# Copy backend application source
COPY be/ ./

# Copy compiled frontend from Stage 1
COPY --from=frontend-builder /build/fe/dist /app/fe/dist

# Ensure persistence directories exist
RUN mkdir -p /app/be/data /app/be/screenshots

EXPOSE 3000

# Use dumb-init to properly handle PID 1 signals and reap Chromium zombie processes
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/server.js"]

