# syntax=docker/dockerfile:1
# skillxone image for deployment Mode B. One image runs either the web app (default) or the
# worker (`pnpm worker serve`). See docs/deployment/docker.md.

FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
# Compilers are only needed if no prebuilt better-sqlite3 binary matches; they stay in this stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/database/package.json packages/database/
COPY packages/github/package.json packages/github/
COPY packages/installer/package.json packages/installer/
COPY packages/ranking/package.json packages/ranking/
COPY packages/search/package.json packages/search/
COPY packages/security/package.json packages/security/
COPY packages/shared/package.json packages/shared/
COPY packages/skill-parser/package.json packages/skill-parser/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production \
    DATABASE_URL=file:./data/skillxone.db \
    PORT=3000
# The worker runs TypeScript through tsx, so the full workspace is kept. No compilers are copied.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/docker-start.sh"]
