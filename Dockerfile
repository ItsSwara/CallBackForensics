# Relay only. The CLI and demo run on the developer's machine.
FROM node:20-slim

# better-sqlite3 ships prebuilt binaries for common platforms; these tools are the fallback if it has to compile.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/relay/package.json packages/relay/
COPY packages/cli/package.json packages/cli/
COPY packages/demo/package.json packages/demo/
RUN npm ci

COPY tsconfig.json ./
COPY packages/relay packages/relay

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/relay.db
RUN mkdir -p /data
EXPOSE 8080

CMD ["node", "--import", "tsx", "packages/relay/src/index.ts"]
