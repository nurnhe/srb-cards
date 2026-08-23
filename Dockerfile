# Release image: Vite builds the static site, then the Express backend serves it
# alongside /api, so one container on one port answers everything.
#
# Nothing is configured at build time. The site calls /api with relative URLs,
# so the Supabase credentials and the port are read at container START:
#   docker run --env-file .env -p 127.0.0.1:8080:8080 srb-cards
#
# This is the production image; dev/Dockerfile is the development one.

FROM node:22-alpine AS build

WORKDIR /app

# Dependencies first, so this layer stays cached across source edits.
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build


FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/src ./backend/src
COPY --from=build /app/dist ./dist

# Only a default — `docker run -e PORT=...` overrides it.
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "backend/src/server.js"]
