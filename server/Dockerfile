FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY server/ ./
COPY shared/ /app/shared/
RUN npm run generate && npm run check

FROM base
COPY --from=build /app /app
RUN mkdir /data && chown node:node /data
ENV DATABASE_URL=file:/data/events.db
ENV PORT=3001
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
USER node
EXPOSE 3001
CMD ["sh", "-c", "npm run migrate && npm start"]
