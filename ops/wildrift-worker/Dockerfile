ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY wr-api/package.json wr-api/package-lock.json ./wr-api/
RUN cd wr-api && npm ci --omit=dev && npm cache clean --force
COPY . .
USER 10001:10001
ENTRYPOINT ["node", "/app/wr-api/scripts/scrape-worker.mjs"]
