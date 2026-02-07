#!/bin/bash

echo "🚀 Running command: $@"

# Set project name to avoid orphans and consistent naming
export COMPOSE_PROJECT_NAME=personal-ai

# Run all services as a single project
docker compose \
    --project-directory . \
    -f services/infra/docker-compose.yml \
    -f services/n8n/docker-compose.yml \
    -f services/ai/docker-compose.yml \
    -f services/apps/docker-compose.yml \
    $@
