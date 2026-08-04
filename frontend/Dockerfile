# Build context is frontend/, not the repo root — this image has nothing to do
# with backend/.
#   docker build -t smart-coach-buddy-frontend frontend/

# Node 26 matches the local toolchain and the backend image.
FROM node:26-alpine AS builder

WORKDIR /app

# Copied separately from src/ so a source-only edit reuses the install layer.
COPY package.json package-lock.json ./
RUN npm ci

# import.meta.env is resolved at build time, so this is inlined into the bundle
# and cannot be changed by the runtime environment. Unset leaves a production
# build at `warn` — see src/lib/log.ts.
ARG VITE_LOG_LEVEL
ENV VITE_LOG_LEVEL=$VITE_LOG_LEVEL

# tsconfig.app.json and tsconfig.node.json are the two projects `tsc -b`
# resolves through the root tsconfig's references.
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build


FROM nginx:alpine AS runtime

# The build output is static; nginx serves it and proxies /api to the backend
# so the browser still sees a single origin.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

# Substituted into the config on start. BACKEND_URL must not end in a slash —
# see the note in nginx.conf.template. The default is a compose-style service
# name; on Render this is set per-environment.
ENV BACKEND_URL=http://backend:8787

# Makes the image's 15-local-resolvers.envsh export NGINX_LOCAL_RESOLVERS,
# which the config needs to re-resolve the backend after it redeploys. The
# script no-ops without this.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

# Hosts that inject PORT (Render) override this, same as the backend image.
# Render's default is 10000, which is fine for the public-facing frontend —
# only private-network *listeners* are barred from that port.
ENV PORT=8080

# Running unprivileged means no root master process to bind a low port and no
# root-owned paths, so the port is >1024 and everything nginx writes belongs to
# the nginx user. The image's `user nginx;` directive then logs a harmless
# warning about needing super-user privileges.
RUN touch /var/run/nginx.pid \
 && chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx /etc/nginx/conf.d

USER nginx

EXPOSE 8080

# Static liveness only: this deliberately does not probe the backend, so a
# backend outage does not also mark the frontend unhealthy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:$PORT/" || exit 1

# The image's own entrypoint runs the envsubst step, then execs this.
CMD ["nginx", "-g", "daemon off;"]
