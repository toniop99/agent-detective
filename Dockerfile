# ================================================================
# Stage 1: Development
# ================================================================
# Hot reload enabled via volume mounts. Agents run on host.
FROM node:20-slim AS dev

WORKDIR /app

# Install pnpm and dependencies
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install

# Create non-root user for development
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
RUN chown -R appuser:appgroup /app
USER appuser

# Development defaults
ENV NODE_ENV=development
ENV PORT=3001

EXPOSE 3001

# Start development server with hot reload
# Note: Run with `docker-compose up` for volume mounts to work
CMD ["pnpm", "run", "dev"]

# ================================================================
# Stage 2: Production
# ================================================================
# Multi-stage build with selectable agents.
# Build with: docker build --target production --build-arg AGENTS="opencode,claude,gemini" -t agent-detective:latest .
# Supports multi-platform: linux/amd64, linux/arm64
FROM node:20-bookworm AS production

ARG AGENTS="opencode"
ENV AGENTS=${AGENTS}

WORKDIR /app

# Install build dependencies and pnpm
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install && pnpm run build

# Install selected agents based on AGENTS build arg
# Available agents: opencode, claude, gemini
# Note: codex is not available in Docker (requires manual installation)
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

# Create non-root user
RUN groupadd -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

# Copy built application
COPY --chown=appuser:appgroup --from=production /app/dist ./dist
COPY --chown=appuser:appgroup --from=production /app/config ./config

# Create plugins directory for third-party plugins (volume mount point)
RUN mkdir -p /app/plugins && chown -R appuser:appgroup /app/plugins

# Placeholder for plugins directory (can be overridden by volume mount)
RUN touch /app/plugins/.gitkeep && chown appuser:appgroup /app/plugins/.gitkeep

# Create config directory with placeholder if not exists
RUN mkdir -p /app/config && chown -R appuser:appgroup /app/config

# Production defaults
ENV NODE_ENV=production
ENV PORT=3001

USER appuser

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]

# ================================================================
# Default target
# ================================================================
FROM dev AS default
