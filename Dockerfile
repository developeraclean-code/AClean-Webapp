# Application only. Supabase is deployed from a separately pinned official release.
# Replace the exact Node tag with a reviewed digest before production deployment.
FROM node:22.18.0-bookworm-slim AS base
# npm 11 reads this existing cross-platform lockfile consistently; npm 10 in
# Node 22.18.0 rejects optional esbuild peer packages omitted from the lock.
RUN npm install --global npm@11.11.0

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_R2_CDN_URL=
ARG VITE_R2_DIRECT_UPLOAD=false
ARG VITE_SENTRY_DSN=
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY} \
    VITE_R2_CDN_URL=${VITE_R2_CDN_URL} \
    VITE_R2_DIRECT_UPLOAD=${VITE_R2_DIRECT_UPLOAD} \
    VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" && npm run build

FROM base AS runtime
ARG ACLEAN_BUILD_SHA=dev
ENV NODE_ENV=production PORT=3000 ACLEAN_BUILD_SHA=${ACLEAN_BUILD_SHA}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY api ./api
COPY server ./server
# Several API handlers import pure helpers from src/lib at runtime.
COPY src/lib ./src/lib
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health?component=app').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
