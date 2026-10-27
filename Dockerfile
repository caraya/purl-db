FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/schema.ts ./src/schema.ts
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
EXPOSE 3000
CMD ["sh", "-c", "npm run db:push && exec node dist/server.js"]