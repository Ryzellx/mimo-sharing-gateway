# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
RUN npm install --workspace=backend --include-workspace-root
COPY tsconfig.base.json* ./
COPY backend backend
RUN npm run build -w backend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
RUN npm install --workspace=backend --include-workspace-root --omit=dev
COPY --from=build /app/backend/dist backend/dist
COPY backend/migrations backend/migrations
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
