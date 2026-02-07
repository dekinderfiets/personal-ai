# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json to install dependencies
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Install UI dependencies
COPY ui/package.json ./ui/
RUN cd ui && npm install

# Copy the rest of the application source code
COPY . .

# Build the UI
RUN cd ui && npm run build

# Build the NestJS application
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Copy production dependencies from builder stage
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev

# Copy the built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/ui/dist ./public
COPY --from=builder /app/.env.example ./.env.example

# Expose the port the NestJS app runs on
EXPOSE 8087

# Command to run the NestJS application
CMD ["node", "dist/main"]