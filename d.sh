#!/bin/bash

echo "🚀 Running command: $@"

# Set project name to avoid orphans and consistent naming
export COMPOSE_PROJECT_NAME=personal-ai

# Ensure external volumes and network exist
for vol in personal-ai_pg_data personal-ai_redis_data personal-ai_caddy_data personal-ai_caddy_config personal-ai_es_data personal-ai_n8n_data personal-ai_nocodb_data; do
    docker volume create "$vol" 2>/dev/null || true
done
docker network create personal-ai-net 2>/dev/null || true

# Run all services as a single project
docker compose \
    --project-directory . \
    -f services/infra/docker-compose.yml \
    -f services/n8n/docker-compose.yml \
    -f services/ai/docker-compose.yml \
    -f services/apps/docker-compose.yml \
    $@
