# Development image. Dependencies are installed here, but all source code
# arrives at run time through a bind mount (see run_dev.sh), so edits are live
# and nothing has to be rebuilt unless a package.json changes.
#
# This is not the production image — that is the Dockerfile in the repo root.
FROM node:22-alpine

WORKDIR /app

# Installed into the image, then masked back over the bind mount with anonymous
# volumes at run time, so the container always uses its own Linux-built
# dependencies instead of whatever the host has.
COPY package.json package-lock.json ./
RUN npm ci

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci

COPY dev/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# 5173 = Vite dev server, 3000 = Express API
EXPOSE 5173 3000

CMD ["/usr/local/bin/entrypoint.sh"]
