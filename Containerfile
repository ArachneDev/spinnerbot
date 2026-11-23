# One image runs both containers. The Quadlet Exec line picks the process:
#   node apps/web/dist/server/main.js   (default)
#   node apps/bot/dist/main.js
FROM docker.io/library/node:22.23.4-alpine3.24 AS build
WORKDIR /app
RUN apk add --no-cache python3
RUN npm install -g pnpm@12.16.1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# A fresh production-only install: --prod alone leaves the build tools (esbuild and others) in the store.
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
    && CI=true pnpm install --frozen-lockfile --prod
RUN python3 -m venv python/.venv && python/.venv/bin/pip install -q -r python/requirements.txt
# Only deploy-commands.js and the database deploy-cli.js are used in production. The command
# scaffolding and the dev-only migrate CLI are built with the rest, so leave them out of the image.
# (Debug and test tools live in apps/bot/dev, which .dockerignore keeps out of the build entirely.)
RUN rm -f apps/bot/dist/scripts/new-command.* apps/bot/dist/scripts/scaffold.* \
      packages/db/dist/migrate-cli.*

FROM docker.io/library/node:22.23.4-alpine3.24
ARG VERSION=dev
ENV NODE_ENV=production VERSION=$VERSION
RUN apk add --no-cache python3
WORKDIR /app
COPY --from=build /app /app
# The node user, by number: a name could map to root.
USER 1000:1000
EXPOSE 3000
CMD ["node", "apps/web/dist/server/main.js"]
