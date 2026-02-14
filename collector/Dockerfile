# Stage: Development (hot-reload)
FROM node:20-slim AS development

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg libimage-exiftool-perl && \
    pip3 install --break-system-packages 'markitdown[all]' && \
    rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app

# Install backend dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Install UI dependencies
COPY ui/package.json ui/pnpm-lock.yaml ./ui/
RUN cd ui && pnpm install --frozen-lockfile --config.package-import-method=copy

# Source code will be mounted via docker-compose volumes
EXPOSE 8087 5173
CMD ["npm", "run", "dev"]

# Stage 1: Builder
FROM node:20-slim AS builder

RUN corepack enable

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY ui/package.json ui/pnpm-lock.yaml ./ui/
RUN cd ui && pnpm install --frozen-lockfile --config.package-import-method=copy

COPY . .

RUN cd ui && pnpm run build
RUN npm run build

# Stage 2: Production
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg libimage-exiftool-perl && \
    pip3 install --break-system-packages 'markitdown[all]' && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/ui/dist ./public
COPY --from=builder /app/.env.example ./.env.example

EXPOSE 8087
CMD ["node", "dist/main"]
