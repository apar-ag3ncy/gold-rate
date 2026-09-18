# Scheduler worker – same image layout as the API (shares the API source for models/services)
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace=@chheda/api --workspace=@chheda/worker --workspace=@chheda/shared --no-audit --no-fund && npm cache clean --force
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/worker apps/worker
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
USER node
EXPOSE 4100
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4100/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "apps/worker/src/index.ts"]
