# Build stage: the image does not build unless the typecheck and the whole test suite pass (REQ-DL-4).
# No key and no network to the model are needed: the scenarios select the fake interpreter themselves.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json vitest.config.ts ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY eval ./eval
COPY specs/INVARIANTS.md ./specs/INVARIANTS.md
# The delivery tests read these files; the example trace is replayed.
COPY Dockerfile .dockerignore README.md ./
COPY traces/examples ./traces/examples
RUN pnpm typecheck && pnpm test && pnpm build
RUN pnpm prune --prod

# Runtime stage: compiled output and production dependencies only (REQ-DL-1), as the unprivileged node user.
# NODE_NO_WARNINGS keeps runtime warnings off stderr (REQ-OUT-4); the entry point redirects anything else to the traces.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NODE_NO_WARNINGS=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/traces && chown -R node:node /app
USER node
# Reads /app/work_orders.csv (mount it read-only), writes /app/traces (mount it), talks over stdin/stdout.
ENTRYPOINT ["node", "dist/main.js"]
