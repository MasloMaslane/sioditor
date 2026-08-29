# Builds the app and serves it with the headers it needs. The same image stands up on a
# LAN box for a room with no internet.
FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/editor/package.json packages/editor/
COPY packages/runner/package.json packages/runner/
COPY packages/runtime-python/package.json packages/runtime-python/
COPY packages/storage/package.json packages/storage/
COPY packages/toolchain-cpp/package.json packages/toolchain-cpp/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm vendor:pyodide && pnpm build

# Precompress once at build time. brotli-11 on the large assets takes tens of seconds;
# doing it per request is not an option.
RUN apt-get update && apt-get install -y --no-install-recommends brotli \
 && find apps/web/dist -type f \( -name '*.wasm' -o -name '*.js' -o -name '*.css' \
      -o -name '*.zip' -o -name '*.json' -o -name '*.html' \) -size +1k \
      -exec brotli -q 11 -f -k {} + \
 && rm -rf /var/lib/apt/lists/*

FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv/sioditor
COPY deploy/Caddyfile /etc/caddy/Caddyfile
