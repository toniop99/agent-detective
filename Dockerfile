# ================================================================
# Stage 1: Builder
# ================================================================
# Compiles the application
FROM node:24-bookworm AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install && pnpm run build

# ================================================================
# Stage 2: Production
# ================================================================
# Production runtime with selected agents
# Build with: docker build --target production --build-arg AGENTS="opencode,claude,gemini" -t agent-detective:latest .
# Supports multi-platform: linux/amd64, linux/arm64
FROM node:24-bookworm AS production

ARG AGENTS="opencode"
ENV AGENTS=${AGENTS}

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config

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

RUN groupadd -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

RUN mkdir -p /app/plugins && chown -R appuser:appgroup /app
RUN touch /app/plugins/.gitkeep && chown appuser:appgroup /app/plugins/.gitkeep

ENV NODE_ENV=production
ENV PORT=3001
ENV COREPACK_HOME=/app/.corepack

RUN mkdir -p /app/.corepack && chown -R appuser:appgroup /app/.corepack

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]

# ================================================================
# Stage 3: Development
# ================================================================
# Hot reload enabled via volume mounts. Agents run on host.
FROM node:24-slim AS dev

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install

RUN groupadd -r appgroup && useradd -r -g appgroup appuser
RUN chown -R appuser:appgroup /app
USER appuser

ENV NODE_ENV=development
ENV PORT=3001

EXPOSE 3001

CMD ["pnpm", "run", "dev"]

# ================================================================
# Default target
# ================================================================
FROM dev AS default