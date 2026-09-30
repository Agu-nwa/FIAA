#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env.ec2 ]; then
  echo "Missing .env.ec2. Copy .env.ec2.example and fill in its values." >&2
  exit 1
fi

git pull --ff-only
docker compose --env-file .env.ec2 -f docker-compose.ec2.yml build --pull app
docker compose --env-file .env.ec2 -f docker-compose.ec2.yml up -d --remove-orphans
docker compose --env-file .env.ec2 -f docker-compose.ec2.yml ps

echo "Waiting for the application readiness check..."
attempt=0
until docker compose --env-file .env.ec2 -f docker-compose.ec2.yml exec -T app \
  node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 12 ]; then
    echo "Deployment did not become ready. Inspect: docker compose --env-file .env.ec2 -f docker-compose.ec2.yml logs" >&2
    exit 1
  fi
  sleep 5
done

echo "FIAA staging deployment is ready."
