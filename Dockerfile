# Multi-stage build: Node builds the static site, nginx serves it.
# Mirrors what Netlify does (npm run build -> publish dist/).

FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first so this layer is cached across source edits.
COPY package.json package-lock.json ./
RUN npm ci

# Vite inlines VITE_* variables into the bundle at BUILD time, so they have to
# be passed to `docker build --build-arg`, not to `docker run -e`.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY . .
RUN npm run build


FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
