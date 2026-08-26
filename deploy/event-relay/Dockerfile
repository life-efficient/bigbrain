FROM node:22-alpine

WORKDIR /app
COPY server.mjs /app/server.mjs
RUN mkdir -p /var/lib/bigbrain-relay

ENV BIGBRAIN_RELAY_HOST=0.0.0.0
ENV BIGBRAIN_RELAY_QUEUE_DIR=/var/lib/bigbrain-relay
EXPOSE 5580

CMD ["node", "/app/server.mjs"]
