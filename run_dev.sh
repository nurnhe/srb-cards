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
#   ./run_dev.sh --stop       stop it (both the normal and the test one)
#   ./run_dev.sh --real       use the REAL database (.env) instead — without
#                             this flag it always uses the TEST database
#                             (.env.test), so real words are never touched
#                             by accident
#   ./run_dev.sh --test       same as the default, spelled out
#
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="srb-cards-dev"
CONTAINER="srb-cards-dev-test"
OTHER_CONTAINER="srb-cards-dev"
ENV_FILE=".env.test"
APP_PORT=5173
API_PORT=3000

REBUILD=false
RECREATE=false
STOP=false
TEST=true

for arg in "$@"; do
  case "$arg" in
    --rebuild)  REBUILD=true; RECREATE=true ;;
    --recreate) RECREATE=true ;;
    --stop)     STOP=true ;;
    --test)     TEST=true ;;
    --real)     TEST=false ;;
    -h|--help)  sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg (see ./run_dev.sh --help)" >&2; exit 1 ;;
  esac
done

if [ "$TEST" = false ]; then
  CONTAINER="srb-cards-dev"
  OTHER_CONTAINER="srb-cards-dev-test"
  ENV_FILE=".env"
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker and try again." >&2
  exit 1
fi

if [ "$STOP" = true ]; then
  stopped=false
  for name in srb-cards-dev srb-cards-dev-test; do
    docker stop "$name" >/dev/null 2>&1 && { echo "Stopped $name."; stopped=true; } || true
  done
  [ "$stopped" = true ] || echo "Nothing was running."
  exit 0
fi

if [ "$TEST" = true ] && [ ! -f .env.test ]; then
  echo "There is no .env.test file, so there is no test database to use." >&2
  echo "Create it (see CLAUDE.md), or run ./run_dev.sh --real to use the real one." >&2
  exit 1
fi

# Both containers use the same ports, so only one can run at a time.
docker stop "$OTHER_CONTAINER" >/dev/null 2>&1 || true

# The backend reads the Supabase credentials from these variables; without them
# it exits straight away.
ENV_ARGS=()
if [ -f "$ENV_FILE" ]; then
  ENV_ARGS=(--env-file "$ENV_FILE")
else
  echo "WARNING: no $ENV_FILE file — the backend will not start."
  echo "Copy .env.example to $ENV_FILE and fill in the values from Supabase."
  echo
fi

# Build the image if it is missing (or if asked to rebuild).
if [ "$REBUILD" = true ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building image ${IMAGE}…"
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
    echo "(If you changed $ENV_FILE — restart with ./run_dev.sh --recreate.)"
    ;;
  exited|created)
    echo "Starting the existing container…"
    echo "($ENV_FILE values are read when the container is created — if you changed"
    echo " it, restart with ./run_dev.sh --recreate.)"
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
if [ "$TEST" = true ]; then
  echo "  *** TEST DATABASE (.env.test) — your real words are not touched ***"
else
  echo "  !!! REAL DATABASE (.env) — changes here are real !!!"
fi
echo "  App:  http://localhost:$APP_PORT"
echo "  API:  http://localhost:$API_PORT/api/health"
echo
echo "Logs below. Ctrl+C closes the logs, but the container keeps running"
echo "(stop it with ./run_dev.sh --stop)."
echo

docker logs -f "$CONTAINER"
