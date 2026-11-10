# Talentum website builder (builder/server.mjs). Locally it runs beside Talentum in docker-compose
# (talentum-pb/docker-compose.yml → site-builder); on the server it's the same image.
FROM node:22-bookworm-slim
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false NODE_ENV=production MALLOC_ARENA_MAX=2
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "builder/server.mjs"]
