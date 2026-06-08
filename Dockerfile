FROM node:22-slim

# Build tools for better-sqlite3 (falls back to compiling if no prebuilt binary matches).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 build-essential ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (workspace manifests first for better layer caching).
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
RUN npm ci
# Build the libraries to dist so the witness's @receipts/* deps resolve at runtime.
# (tsconfig.* are required for tsup's .d.ts build to resolve modules correctly.)
RUN npm run build

ENV PORT=8787
EXPOSE 8787

# Runs the witness service from TypeScript via tsx. WITNESS_PRIVATE_JWK must be set at runtime.
CMD ["npx", "tsx", "packages/witness/src/server.ts"]
