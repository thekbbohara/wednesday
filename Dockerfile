# syntax=docker/dockerfile:1
# Jarvis runs TypeScript directly on Node 22 (type stripping), so there is no build step.
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

USER node
ENV HOME=/home/node JARVIS_DATA_DIR=/data NODE_OPTIONS=--disable-warning=ExperimentalWarning
ENTRYPOINT ["node", "src/cli.ts"]
