FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/market-worker ./apps/market-worker
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @trade/shared build && pnpm --filter @trade/exchanges-core build && pnpm --filter @trade/exchanges-bybit build && pnpm --filter @trade/domain build && pnpm --filter @trade/database build && pnpm --filter @trade/market-worker build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/market-worker ./apps/market-worker
CMD ["node", "apps/market-worker/dist/worker.js"]
