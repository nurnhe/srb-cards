#!/usr/bin/env bash
#
# Starts the local development environment in Docker: the Vite dev server and
# the API backend, both in one container, with this folder mounted inside so
# your edits show up immediately.
#
#   ./run_dev.sh              start it (building the image the first time)
#   ./run_dev.sh --rebuild    rebuild the image — needed after changing a
#                             package.json or adding a dependency
#   ./run_dev.sh --recreate   throw the container away and make a fresh one
#   ./run_dev.sh --stop       stop it
#
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="srb-cards-dev"
CONTAINER="srb-cards-dev"
APP_PORT=5173
API_PORT=3000

REBUILD=false
RECREATE=false
STOP=false

for arg in "$@"; do
  case "$arg" in
    --rebuild)  REBUILD=true; RECREATE=true ;;
    --recreate) RECREATE=true ;;
    --stop)     STOP=true ;;
    -h|--help)  sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg (see ./run_dev.sh --help)" >&2; exit 1 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker and try again." >&2
  exit 1
fi

if [ "$STOP" = true ]; then
  docker stop "$CONTAINER" >/dev/null 2>&1 \
    && echo "Container stopped." \
    || echo "Container was not running."
  exit 0
fi

# The backend reads the Supabase credentials from these variables; without them
# it exits straight away.
ENV_ARGS=()
if [ -f .env ]; then
  ENV_ARGS=(--env-file .env)
else
  echo "WARNING: no .env file — the backend will not start."
  echo "Copy .env.example to .env and fill in the values from Supabase."
  echo
fi

# Build the image if it is missing (or if asked to rebuild).
if [ "$REBUILD" = true ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building image $IMAGE…"
  docker build --target dev -t "$IMAGE" .
fi

container_state() {
  docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing"
}

if [ "$RECREATE" = true ] && [ "$(container_state)" != "missing" ]; then
  echo "Removing the old container…"
  docker rm -f "$CONTAINER" >/dev/null
fi

case "$(container_state)" in
  running)
    echo "Container is already running."
    echo "(If you changed .env — restart with ./run_dev.sh --recreate.)"
    ;;
  exited|created)
    echo "Starting the existing container…"
    echo "(.env values are read when the container is created — if you changed"
    echo " .env, restart with ./run_dev.sh --recreate.)"
    docker start "$CONTAINER" >/dev/null
    ;;
  *)
    echo "Creating the container…"
    # The anonymous volumes on the two node_modules folders keep the container's
    # own Linux-built dependencies visible underneath the bind mount.
    # Ports are published on 127.0.0.1 only: the backend holds the Supabase
    # service key and has no login, so it must not be reachable from outside.
    docker run -d \
      --name "$CONTAINER" \
      -v "$PWD":/app \
      -v /app/node_modules \
      -v /app/backend/node_modules \
      -p "127.0.0.1:$APP_PORT:5173" \
      -p "127.0.0.1:$API_PORT:3000" \
      "${ENV_ARGS[@]+"${ENV_ARGS[@]}"}" \
      "$IMAGE" >/dev/null
    ;;
esac

echo
echo "  App:  http://localhost:$APP_PORT"
echo "  API:  http://localhost:$API_PORT/api/health"
echo
echo "Logs below. Ctrl+C closes the logs, but the container keeps running"
echo "(stop it with ./run_dev.sh --stop)."
echo

docker logs -f "$CONTAINER"
