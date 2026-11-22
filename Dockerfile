# Two images from one build stage. Neither image contains the API key; the key is mounted only into `app`.
# Runtime uses tsx (TypeScript run-time loader, a runtime dependency) because the source uses ".js" import specifiers.
# Production images install without devDependencies (no typescript, no test tools).
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Holds the Anthropic credential; runs the harness and the web UI. No shell tools.
FROM deps AS app
# The containers run as the host user's uid/gid (set by scripts/setup-secrets.sh via .env), so the
# secret files, which are owned by that user and mode 600, are readable without loosening permissions.
ARG APP_UID=1000
ARG APP_GID=1000
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown ${APP_UID}:${APP_GID} /data
ENV NODE_ENV=production
USER ${APP_UID}:${APP_GID}
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/server.ts"]

# Runs the agent's tools (read/write/edit/bash) inside /workspace only. Holds no credentials.
FROM deps AS runner
ARG APP_UID=1000
ARG APP_GID=1000
COPY tsconfig.json ./
COPY runner ./runner
ENV NODE_ENV=production
RUN mkdir -p /workspace && chown ${APP_UID}:${APP_GID} /workspace
USER ${APP_UID}:${APP_GID}
EXPOSE 7000
CMD ["node", "--import", "tsx", "runner/server.ts"]
