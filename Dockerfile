FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4179
ENV HOST=0.0.0.0
ENV DB_PATH=/data/remint.sqlite
WORKDIR /app

COPY --chown=node:node server ./server
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 4179
VOLUME ["/data"]
CMD ["node", "server/index.js"]
