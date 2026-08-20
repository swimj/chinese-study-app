FROM litestream/litestream:0.5.16 AS litestream

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --legacy-peer-deps
COPY spikes/hosted-beta-platform ./spikes/hosted-beta-platform

RUN mkdir -p /data /var/run && chown -R node:node /app /data /var/run
USER node

EXPOSE 5174
CMD ["litestream", "replicate", "-config", "/app/spikes/hosted-beta-platform/litestream.yml", "-exec", "node --experimental-strip-types /app/spikes/hosted-beta-platform/src/server.ts"]
