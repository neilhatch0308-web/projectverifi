# ============================================================
# server/Dockerfile
#
# Multi-stage: compile TypeScript in a build stage, ship only the
# compiled output + production dependencies in the runtime image.
# Listens on $PORT (Cloud Run sets this; index.ts already honours it -
# confirmed, no code change needed there).
# ============================================================

FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Cloud Run injects PORT at runtime - this default only matters for
# running the image locally/elsewhere without it set.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]