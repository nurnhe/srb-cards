# One image definition for both ways of running the app.
#
#   development: docker build --target dev -t srb-cards-dev .   (run_dev.sh does this)
#   release:     docker build -t srb-cards .
#
# Nothing is configured at build time. The site calls /api with relative URLs,
# so the Supabase credentials and the port are read at container START:
#   docker run --env-file .env -p 127.0.0.1:3000:3000 srb-cards

FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci


# Development. No source is copied — it arrives at run time through a bind mount
# (see run_dev.sh), so edits are live and nothing has to be rebuilt unless a
# package.json changes. The dependencies installed above are masked back over the
# bind mount with anonymous volumes, so the container always uses its own
# Linux-built ones instead of whatever the host has.
FROM deps AS dev

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# 5173 = Vite dev server, 3000 = Express API
EXPOSE 5173 3000

CMD ["/usr/local/bin/entrypoint.sh"]


# Release build: Vite turns the source into a static site in /app/dist.
FROM deps AS build

COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build


# Release image: the Express backend serves that built site itself, alongside
# /api, so one container on one port answers everything.
FROM node:22-alpine AS release

WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/src ./backend/src
COPY --from=build /app/dist ./dist

# No ENV PORT here on purpose: server.js already defaults to 3000, which is what
# .env says. A different default here would be silently overridden by PORT from
# the environment, leaving the app listening on a port nothing talks to.
EXPOSE 3000

USER node
CMD ["node", "backend/src/server.js"]
