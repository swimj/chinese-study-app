FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_AUTH_MODE=clerk

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY src ./src
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY" && npm run build

FROM litestream/litestream:0.5.16 AS litestream

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ARG APP_REVISION=unknown
LABEL org.opencontainers.image.revision=$APP_REVISION

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps
COPY server ./server
COPY src ./src
COPY scripts ./scripts
COPY deploy/fly/litestream.yml ./deploy/fly/litestream.yml
COPY --from=frontend-build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 5174
CMD ["litestream", "replicate", "-config", "/app/deploy/fly/litestream.yml", "-exec", "npm run start:hosted"]
