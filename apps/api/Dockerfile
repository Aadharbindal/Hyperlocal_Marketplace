FROM node:20-alpine AS base
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
RUN npm ci --omit=dev --workspace apps/api --workspace packages/core
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build --workspace apps/api
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
