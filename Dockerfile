# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --create-home nextjs \
  && mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@10.15.1 --activate \
  && chown -R nextjs:nodejs "$COREPACK_HOME"

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM dependencies AS builder

ARG NEXT_PUBLIC_SERVER_URL=http://localhost:3000
ARG PAYLOAD_SECRET=build-only-secret-at-least-32-characters

ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL
ENV PAYLOAD_SECRET=$PAYLOAD_SECRET

COPY . .
RUN mkdir -p public \
  && pnpm build

FROM dependencies AS tooling

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN mkdir -p /app/media \
  && chown -R nextjs:nodejs /app/media

USER nextjs

CMD ["pnpm", "db:migrate"]

FROM tooling AS worker

CMD ["pnpm", "worker"]

FROM base AS runtime

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

RUN mkdir -p /app/media \
  && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
