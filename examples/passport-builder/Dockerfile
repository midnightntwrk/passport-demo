FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip xz-utils bash gosu \
    && rm -rf /var/lib/apt/lists/*
ENV COMPACT_DIRECTORY=/opt/compact
COPY examples/passport-builder/scripts/install-compact.sh /tmp/install-compact.sh
RUN sh /tmp/install-compact.sh && rm /tmp/install-compact.sh

FROM base AS build
WORKDIR /app
# Repository-root context preserves the SDK's existing local package path.
# The root .dockerignore excludes credentials, local data, and installed modules.
COPY packages/connect ./packages/connect
RUN npm install --prefix packages/connect --workspaces=false --legacy-peer-deps \
    && npm run build --prefix packages/connect
COPY examples/passport-builder ./examples/passport-builder
COPY skills/midnight-passport ./skills/midnight-passport
WORKDIR /app/examples/passport-builder
RUN npm ci --workspaces=false && npm run build \
    && npm prune --omit=dev --ignore-scripts --workspaces=false

FROM base AS runtime
ENV NODE_ENV=production \
    BUILDER_DATA_DIR=/data \
    PORT=3001
WORKDIR /app
COPY --from=build /app/packages/connect ./packages/connect
COPY --from=build /app/examples/passport-builder ./examples/passport-builder
COPY --from=build /app/skills/midnight-passport ./skills/midnight-passport
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
WORKDIR /app/examples/passport-builder
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3001)+"/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
ENTRYPOINT ["sh", "scripts/start-container.sh"]
CMD ["node", "--import", "tsx", "service/server.ts"]
