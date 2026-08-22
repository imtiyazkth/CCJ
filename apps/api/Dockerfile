# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /workspace

RUN npm install -g pnpm@9.15.0

# Copy monorepo structure
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/types      ./packages/types
COPY packages/providers  ./packages/providers
COPY packages/db         ./packages/db
COPY apps/api            ./apps/api

# Install all deps
RUN pnpm install --frozen-lockfile

# Build in dependency order — db must be built before api
RUN pnpm --filter @ccj/types build
RUN pnpm --filter @ccj/providers build
RUN pnpm --filter @ccj/db build
RUN pnpm --filter @ccj/api build

# ── Production stage ──────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system ccj && adduser --system --ingroup ccj ccj
RUN npm install -g pnpm@9.15.0

COPY --from=builder /workspace/package.json .
COPY --from=builder /workspace/pnpm-workspace.yaml .
COPY --from=builder /workspace/pnpm-lock.yaml .
COPY --from=builder /workspace/packages/types/package.json     ./packages/types/package.json
COPY --from=builder /workspace/packages/types/dist             ./packages/types/dist
COPY --from=builder /workspace/packages/providers/package.json ./packages/providers/package.json
COPY --from=builder /workspace/packages/providers/dist         ./packages/providers/dist
COPY --from=builder /workspace/packages/db/package.json        ./packages/db/package.json
COPY --from=builder /workspace/packages/db/dist                ./packages/db/dist
COPY --from=builder /workspace/apps/api/package.json           ./apps/api/package.json
COPY --from=builder /workspace/apps/api/dist                   ./apps/api/dist

# Install production deps only
RUN pnpm install --frozen-lockfile --prod --ignore-scripts 2>/dev/null || \
    pnpm install --frozen-lockfile --ignore-scripts

USER ccj
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
