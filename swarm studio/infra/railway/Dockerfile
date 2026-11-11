FROM node:24.22.2-bookworm@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40
COPY --chmod=755 infra/sandboxes/computer/apt-security.sh /tmp/apt-security.sh
RUN /tmp/apt-security.sh \
  && apt-get update \
  && apt-get install -y --no-install-recommends gosu tini \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY --chmod=755 . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @swarm-studio/db generate
RUN pnpm --filter @swarm-studio/api --filter @swarm-studio/worker build
RUN SWARM_STUDIO_ALLOW_DEV_SECRETS=1 pnpm --filter @swarm-studio/web build
RUN install -d -m 750 -o node -g node /data /app/apps/web/node_modules/.vite-temp
RUN /tmp/apt-security.sh --check && rm -f /tmp/apt-security.sh
ENV NODE_ENV=production
ENV SWARM_STUDIO_ALLOWED_HOSTS=healthcheck.railway.app
EXPOSE 5173
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["bash", "infra/railway/start.sh"]
