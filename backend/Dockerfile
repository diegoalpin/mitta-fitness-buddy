# Build context is backend/, not the repo root — this image has nothing to do
# with frontend/.
#   docker build -t smart-coach-buddy-backend backend/

# Node 26 matches the local toolchain and @types/node ^26.
FROM node:26-alpine AS builder

WORKDIR /app

# Copied separately from src/ so a source-only edit reuses the install layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Reuses the installed tree instead of a second registry round-trip.
RUN npm prune --omit=dev


FROM node:26-alpine AS runtime

# Node as PID 1 ignores SIGTERM (no default handler is installed for PID 1),
# so `docker stop` would sit through its 10s grace period before SIGKILL.
RUN apk add --no-cache tini

ENV NODE_ENV=production

WORKDIR /app

# package.json is required at runtime: "type": "module" is what makes Node
# treat dist/*.js as ESM.
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node

# config.ts falls back to 8787 when PORT is unset. Hosts that inject PORT
# (Render) override this.
ENV PORT=8787
EXPOSE 8787

# Liveness only, mirroring routes/health.ts — deliberately does not probe MCP
# or the LLM provider. No curl in alpine, so use Node's global fetch.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
