# syntax=docker/dockerfile:1
# Jarvis runs TypeScript directly on Node 22 (type stripping); only the UI is built.
FROM node:22-bookworm-slim AS ui
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY vite.config.ts ./
COPY web ./web
RUN pnpm build

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The captain is Claude Code in headless mode.
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# Match the host user so the mounted Claude login and data stay writable.
ARG UID=1000
ARG GID=1000
RUN groupmod -g "$GID" node && usermod -u "$UID" -g "$GID" node \
 && mkdir -p /data && chown node:node /data

WORKDIR /app
RUN corepack enable
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --chown=node:node src ./src
COPY --chown=node:node prompts ./prompts
COPY --from=ui --chown=node:node /app/dist ./dist

USER node
ENV HOME=/home/node JARVIS_DATA_DIR=/data HOST=0.0.0.0 PORT=4788 NODE_OPTIONS=--disable-warning=ExperimentalWarning
EXPOSE 4788
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4788/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.ts"]
