FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/api ./apps/api
COPY scripts ./scripts
COPY legacy-data ./legacy-data
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @trade/shared build && pnpm --filter @trade/domain build && pnpm --filter @trade/database build && pnpm --filter @trade/web build && pnpm --filter @trade/api build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/legacy-data ./legacy-data
EXPOSE 8080
CMD ["sh", "-c", "node scripts/migrate-legacy.mjs ./legacy-data && node apps/api/dist/server.js"]
