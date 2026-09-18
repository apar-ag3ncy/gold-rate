# API – Express + sharp (needs the libvips prebuilt binary; node:20-slim works, alpine needs extra care)
FROM node:20-slim AS base
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace=@chheda/api --workspace=@chheda/shared --no-audit --no-fund && npm cache clean --force
COPY packages/shared packages/shared
COPY apps/api apps/api
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "apps/api/src/server.ts"]
