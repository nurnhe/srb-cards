#!/bin/sh
# Runs the API and the Vite dev server side by side in the one dev container.
# Binaries are invoked directly rather than through npm so there is no wrapper
# process in between and signals reach them.
set -e

cd /app

node --watch backend/src/server.js &
backend_pid=$!

./node_modules/.bin/vite &
frontend_pid=$!

stop_both() {
  kill "$backend_pid" "$frontend_pid" 2>/dev/null || true
}
trap 'stop_both' INT TERM

# If either process exits, bring the container down with it — a half-running
# environment is more confusing than a stopped one.
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
  sleep 1
done

echo "One of the dev processes exited — stopping the other."
stop_both
wait 2>/dev/null || true
