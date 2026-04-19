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
# Build: docker build --target production --build-arg AGENTS=opencode,claude,gemini -t agent-detective:latest .
# AGENTS=opencode → npm opencode-ai (binary: opencode). https://opencode.ai/docs
# AGENTS=claude   → npm @anthropic-ai/claude-code (binary: claude). https://www.npmjs.com/package/@anthropic-ai/claude-code
# AGENTS=gemini   → npm @google/gemini-cli (binary: gemini). https://www.npmjs.com/package/@google/gemini-cli
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

# Optional CLI agents inside the image (comma-separated AGENTS build-arg).
# OpenCode CLI: official npm package is opencode-ai (https://opencode.ai/docs).
RUN set -eu; \
    install_agent() { \
        case "$1" in \
            opencode) \
                echo "Installing OpenCode CLI (npm: opencode-ai)..."; \
                npm install -g opencode-ai; \
                ;; \
            claude) \
                echo "Installing Claude Code CLI (npm: @anthropic-ai/claude-code)..."; \
                npm install -g @anthropic-ai/claude-code; \
                ;; \
            gemini) \
                echo "Installing Gemini CLI (npm: @google/gemini-cli)..."; \
                npm install -g @google/gemini-cli; \
                ;; \
            *) \
                echo "Unknown agent: $1, skipping"; \
                ;; \
        esac; \
    }; \
    for agent in $(echo "$AGENTS" | tr ',' ' '); do \
        [ -n "${agent:-}" ] || continue; \
        install_agent "$agent"; \
    done

RUN groupadd -g 1001 appgroup && useradd -m -u 1001 -g appgroup -s /bin/bash appuser \
  && mkdir -p /app/plugins \
  && chown -R appuser:appgroup /app

# Fail build if requested agent CLIs are not on PATH for the runtime user.
RUN if echo ",${AGENTS}," | grep -q ',opencode,'; then \
        su -s /bin/bash appuser -c 'command -v opencode && opencode --version'; \
    fi \
    && if echo ",${AGENTS}," | grep -q ',claude,'; then \
        su -s /bin/bash appuser -c 'command -v claude'; \
    fi \
    && if echo ",${AGENTS}," | grep -q ',gemini,'; then \
        su -s /bin/bash appuser -c 'command -v gemini'; \
    fi

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
