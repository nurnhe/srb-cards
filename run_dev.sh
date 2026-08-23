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
    *) echo "Неизвестный аргумент: $arg / Unknown argument: $arg (смотри / see ./run_dev.sh --help)" >&2; exit 1 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker не запущен. Запусти Docker и попробуй снова." >&2
  echo "Docker is not running. Start Docker and try again." >&2
  exit 1
fi

if [ "$STOP" = true ]; then
  docker stop "$CONTAINER" >/dev/null 2>&1 \
    && echo "Контейнер остановлен. / Container stopped." \
    || echo "Контейнер и так не запущен. / Container was not running."
  exit 0
fi

# The backend reads the Supabase credentials from these variables; without them
# it exits straight away.
ENV_ARGS=()
if [ -f .env ]; then
  ENV_ARGS=(--env-file .env)
else
  echo "ВНИМАНИЕ: файла .env нет — бэкенд не запустится."
  echo "Скопируй .env.example в .env и впиши значения из Supabase."
  echo "WARNING: no .env file — the backend will not start."
  echo "Copy .env.example to .env and fill in the values from Supabase."
  echo
fi

# Build the image if it is missing (or if asked to rebuild).
if [ "$REBUILD" = true ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Собираю образ $IMAGE… / Building image $IMAGE…"
  docker build -f dev/Dockerfile -t "$IMAGE" .
fi

container_state() {
  docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing"
}

if [ "$RECREATE" = true ] && [ "$(container_state)" != "missing" ]; then
  echo "Удаляю старый контейнер… / Removing the old container…"
  docker rm -f "$CONTAINER" >/dev/null
fi

case "$(container_state)" in
  running)
    echo "Контейнер уже запущен. / Container is already running."
    echo "(Если менял .env — перезапусти с ./run_dev.sh --recreate.)"
    echo "(If you changed .env — restart with ./run_dev.sh --recreate.)"
    ;;
  exited|created)
    echo "Запускаю существующий контейнер… / Starting the existing container…"
    echo "(Переменные из .env берутся при создании контейнера — если менял .env,"
    echo " перезапусти с ./run_dev.sh --recreate.)"
    echo "(.env values are read when the container is created — if you changed"
    echo " .env, restart with ./run_dev.sh --recreate.)"
    docker start "$CONTAINER" >/dev/null
    ;;
  *)
    echo "Создаю контейнер… / Creating the container…"
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
echo "  Приложение / App:  http://localhost:$APP_PORT"
echo "  API:               http://localhost:$API_PORT/api/health"
echo
echo "Логи ниже. Ctrl+C закроет логи, но контейнер продолжит работать"
echo "(остановить — ./run_dev.sh --stop)."
echo "Logs below. Ctrl+C closes the logs, but the container keeps running"
echo "(stop it with ./run_dev.sh --stop)."
echo

docker logs -f "$CONTAINER"
