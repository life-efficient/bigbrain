FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY src ./src
COPY README.md LICENSE ./

ENV NODE_ENV=production
ENV BIGBRAIN_HOME=/brain
ENV BIGBRAIN_CONFIG=/config/bigbrain.config.json
ENV PORT=3333

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3333) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "node ./bin/bigbrain.js --config \"$BIGBRAIN_CONFIG\" mcp --host 0.0.0.0 --port \"${PORT:-3333}\""]
