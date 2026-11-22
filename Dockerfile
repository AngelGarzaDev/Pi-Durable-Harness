# Two images from one build stage. Neither image contains the API key; the key is mounted only into `app`.
# Runtime uses tsx (TypeScript run-time loader, a runtime dependency) because the source uses ".js" import specifiers.
# Production images install without devDependencies (no typescript, no test tools).
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Holds the Anthropic credential; runs the harness and the web UI. No shell tools.
FROM deps AS app
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown 1000:1000 /data
ENV NODE_ENV=production
USER 1000:1000
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/server.ts"]

# Runs the agent's tools (read/write/edit/bash) inside /workspace only. Holds no credentials.
FROM deps AS runner
COPY tsconfig.json ./
COPY runner ./runner
ENV NODE_ENV=production
RUN mkdir -p /workspace && chown 10001:10001 /workspace
USER 10001:10001
EXPOSE 7000
CMD ["node", "--import", "tsx", "runner/server.ts"]
