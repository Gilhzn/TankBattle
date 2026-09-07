# Full game — WebSocket multiplayer, economy REST and the built client from one process.
# Both stages share the same base so better-sqlite3's prebuilt binary matches the runtime.

FROM node:22-slim AS build
WORKDIR /app
# Manifests first so the dependency layer is cached until they change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY . .
RUN npm run build -w @tank/shared \
  && npm run build -w @tank/server \
  && npm run build -w @tank/client

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
# Runtime deps only (ws, zod, better-sqlite3); the build toolchain stays in the build stage.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

# Mount a volume here to keep accounts, wallets and match history across restarts.
RUN mkdir -p /data && chown -R node:node /data
USER node

ENV PORT=8080 \
    DB_PATH=/data/tank.db
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
