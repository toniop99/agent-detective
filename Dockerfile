# syntax=docker/dockerfile:1
# =============================================================================
# Builder — workspace install, package builds, bundled app entrypoint
# =============================================================================
FROM node:24-bookworm AS builder

WORKDIR /app
ENV CI=1

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json tsup.config.ts ./
COPY packages/ ./packages/
COPY src/ ./src/
COPY config/ ./config/

RUN pnpm install --frozen-lockfile

RUN pnpm exec turbo run build --filter='./packages/**'

RUN pnpm run build:app

# Production node_modules (drop devDependencies; keep workspace links valid)
RUN pnpm prune --prod

# =============================================================================
# Production — runtime image (no compile; uses pruned node_modules from builder)
# =============================================================================
# Build: docker build --target production --build-arg AGENTS=opencode,claude -t agent-detective:latest .
FROM node:24-bookworm AS production

ARG AGENTS="opencode"
ENV AGENTS=${AGENTS}

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

RUN apt-get update && apt-get install -y --no-install-recommends wget \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Optional CLI agents inside the image (comma-separated AGENTS build-arg)
RUN install_agent() { \
    case "$1" in \
        opencode) \
            echo "Installing opencode..." && \
            npm install -g opencode 2>/dev/null || echo "opencode install skipped" \
            ;; \
        claude) \
            echo "Installing claude..." && \
            npm install -g @anthropic-ai/claude 2>/dev/null || echo "claude install skipped" \
            ;; \
        gemini) \
            echo "Installing gemini..." && \
            npm install -g gemini-cli 2>/dev/null || echo "gemini install skipped" \
            ;; \
        *) \
            echo "Unknown agent: $1, skipping" \
            ;; \
    esac; \
    } && \
    for agent in $(echo "$AGENTS" | tr ',' ' '); do \
        install_agent "$agent"; \
    done

RUN groupadd -g 1001 appgroup && useradd -u 1001 -g appgroup -s /bin/bash appuser \
  && mkdir -p /app/plugins \
  && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health | grep -q '"status"' || exit 1

CMD ["node", "dist/index.js"]

FROM node:24-bookworm AS dev

WORKDIR /app
ENV CI=1
ENV NODE_ENV=development
ENV PORT=3001

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
  && apt-get update && apt-get install -y --no-install-recommends wget git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json tsup.config.ts ./
COPY packages ./packages
COPY src ./src
COPY config ./config

RUN pnpm install --frozen-lockfile

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health | grep -q '"status"' || exit 1

CMD ["pnpm", "run", "dev"]

# Default image target for `docker build` with no --target
FROM dev AS default
