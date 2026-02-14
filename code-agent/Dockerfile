# Multi-stage build for both development and production
FROM node:20-slim AS base

LABEL maintainer="Code Agent API Server"

WORKDIR /app

# Install system dependencies (needed for both stages)
RUN apt-get update && \
    apt-get install -y \
    curl \
    git \
    ripgrep \
    wget \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install uv --break-system-packages

# Install Cursor Agent CLI
RUN curl -fsSL https://cursor.com/install | bash

# Configure MCPs
COPY ./.docker/cursor/mcp.json /root/.cursor/mcp.json
# Configure Cursor Agent CLI
COPY ./.docker/cursor/cli-config.json /root/.cursor/cli-config.json

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim AS production

LABEL maintainer="Code Agent API Server"

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
    curl \
    git \
    ripgrep \
    wget \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install uv --break-system-packages

# Install Cursor Agent CLI
RUN curl -fsSL https://cursor.com/install | bash

# Configure MCPs
RUN mkdir -p /root/.cursor
COPY ./.docker/cursor/mcp.json /root/.cursor/mcp.json
# We will use a CMD that performs runtime substitution.

# Copy package files
COPY package*.json ./

# Copy built application
COPY --from=base /app/dist/ ./dist/

# Install only production dependencies
RUN npm install --only=production

EXPOSE 8085

ENV PORT=8085
ENV PATH="/root/.local/bin:$PATH"

CMD ["node", "dist/main.js"]

# Development stage
FROM base AS development

# Install NestJS CLI globally for development
RUN npm install -g @nestjs/cli

# Set NODE_ENV to development
ENV NODE_ENV=development

EXPOSE 8085

ENV PORT=8085
ENV PATH="/root/.local/bin:$PATH"

# Use npm run start:dev for hot reloading during development
CMD ["npm", "run", "start"]
