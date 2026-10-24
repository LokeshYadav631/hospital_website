FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/hospital.db
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "node --disable-warning=ExperimentalWarning scripts/migrate.js && node --disable-warning=ExperimentalWarning src/server.js"]
