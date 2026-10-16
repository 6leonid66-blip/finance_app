FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 make g++ libgtk-3-0 libdbus-glib-1-2 libasound2 \
    libx11-xcb1 libxt6 libnss3 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libatk1.0-0 libatk-bridge2.0-0 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/sync-worker
COPY sync-worker/package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm rebuild better-sqlite3 --ignore-scripts=false \
    && node node_modules/@sergienko4/israeli-bank-scrapers/scripts/patch-playwright-core.mjs
COPY sync-worker/*.mjs ./
COPY src/lib/bankImport.ts /app/src/lib/bankImport.ts
RUN mkdir -p /data /home/node/.cache && chown -R node:node /app /data /home/node/.cache
USER node
# Fetch at image build time; provider jobs never auto-download executables.
RUN npm run browser:install
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 SYNC_DATA_DIR=/data PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
