FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production=false
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-alpine AS production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=base /app/dist ./dist

FROM production AS api
EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM production AS worker
CMD ["node", "dist/worker.js"]
