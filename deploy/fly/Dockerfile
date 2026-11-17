FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_AUTH_MODE=clerk

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY src ./src
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY" && npm run build

FROM golang:1.25.12-bookworm AS litestream

# Keep the base revision and the local backport independently reviewable.
WORKDIR /src/litestream
RUN git init . && git remote add origin https://github.com/benbjohnson/litestream.git \
    && git fetch --depth 1 origin 6d61ef5d007756d62e473daee4c760ac395a55c6 \
    && git checkout --detach FETCH_HEAD
COPY deploy/fly/litestream/continuity.patch /tmp/continuity.patch
RUN git apply --check /tmp/continuity.patch && git apply /tmp/continuity.patch
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg \
    CGO_ENABLED=0 go build -mod=readonly -trimpath \
    -tags osusergo,netgo,sqlite_omit_load_extension \
    -ldflags "-s -w -X main.Version=0.5.16-study-wal1" \
    -o /usr/local/bin/litestream ./cmd/litestream

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ARG APP_REVISION
RUN test -n "$APP_REVISION" && test "$APP_REVISION" != "unknown"
ENV APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.revision=$APP_REVISION

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=litestream /src/litestream/LICENSE /usr/share/doc/litestream/LICENSE
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps
COPY server ./server
COPY src ./src
COPY scripts ./scripts
COPY deploy/fly/litestream.yml ./deploy/fly/litestream.yml
COPY deploy/fly/litestream.rc.yml ./deploy/fly/litestream.rc.yml
COPY deploy/fly/migrate-with-litestream.sh ./deploy/fly/migrate-with-litestream.sh
COPY --from=frontend-build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 5174 9091
CMD ["litestream", "replicate", "-config", "/app/deploy/fly/litestream.yml", "-exec", "npm run start:hosted"]
