FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @lifelog/server --include=dev --no-audit --no-fund
COPY apps/server/ apps/server/
RUN npm run build:server

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production LIFELOG_MODE=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @lifelog/server --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/apps/server/dist/ apps/server/dist/
COPY --from=build /app/apps/server/migrations/ apps/server/migrations/
USER node
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
