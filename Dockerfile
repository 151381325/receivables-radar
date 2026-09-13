# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

FROM node:22-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server ./server
USER node
EXPOSE 3000
CMD ["node", "server/main.js"]

FROM postgres:16-alpine AS backup
ARG COSCLI_VERSION=1.0.9
ARG TARGETARCH
RUN apk add --no-cache bash openssl curl \
    && case "$TARGETARCH" in \
      amd64) COSCLI_SHA256=a07de5ba2800147a700ed29036b0c76a4229088cee68e1682d0eae19b638a915 ;; \
      arm64) COSCLI_SHA256=5cac5ca3c093f080d6733f4c698c0bdbebdb7b30a6b50835b85de1727b8b6923 ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/tencentyun/coscli/releases/download/v${COSCLI_VERSION}/coscli-v${COSCLI_VERSION}-linux-${TARGETARCH}" -o /usr/local/bin/coscli \
    && echo "${COSCLI_SHA256}  /usr/local/bin/coscli" | sha256sum -c - \
    && chmod 0555 /usr/local/bin/coscli
COPY deploy/backup.sh deploy/restore-check.sh /usr/local/bin/
RUN chmod 0555 /usr/local/bin/backup.sh /usr/local/bin/restore-check.sh \
    && mkdir -p /backups \
    && chown postgres:postgres /backups
USER postgres
ENTRYPOINT ["/usr/local/bin/backup.sh"]
