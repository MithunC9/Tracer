# Web app image (optional compose profile `web`). Build from the repo root:
#   docker build -f docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000 -t tracer-web .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @tracer/web... \
 && pnpm exec turbo run build --filter=@tracer/web...

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/apps/web
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
