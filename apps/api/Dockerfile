# Build from the repo root:  docker build -f apps/api/Dockerfile -t tracer-api .
# Run:  docker run --env-file .env -p 4000:4000 tracer-api
# Migrate (uses DATABASE_ADMIN_URL):  docker run --env-file .env tracer-api node dist/scripts/migrate.js

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @tracer/api... \
 && pnpm --filter @tracer/api... build \
 && pnpm --filter @tracer/api deploy --legacy --prod /out \
 && cp -r apps/api/dist /out/dist

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Migrations are read at runtime from src/db/migrations (see src/db/migrate.ts).
COPY --from=build --chown=node:node /repo/apps/api/src/db/migrations ./src/db/migrations
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
