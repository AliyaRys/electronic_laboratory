# syntax=docker/dockerfile:1

# Frontend image recipe (ADR-013): build the React SPA with Node, serve with nginx.
#
# NOTE (Task I01): ``frontend/`` is built in ТЗ-02, so this Dockerfile is a
# pinned recipe, not something I01's CI builds. The digest of the node base image
# is pinned in docs/adr/README.md and re-verified before release.

# --- build: the SPA -----------------------------------------------------------
FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS build

WORKDIR /app

# npm ci (never `npm install`) for reproducible installs (ADR-014).
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# --- runtime: nginx serving the SPA -------------------------------------------
FROM nginx:1.30.6@sha256:42c68eab6f7e22611786a9fe1d1c019e275c50185bd54b8f75dc2b9184322703 AS runtime

# The nginx config proxies /api/ and /openapi.json to the backend WITHOUT
# rewriting the URI: /api/v1 belongs to the backend and must not be stripped.
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
