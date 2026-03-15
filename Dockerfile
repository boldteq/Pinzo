# Stage 1: Build (needs devDependencies for vite/react-router build)
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Prisma generate needs DATABASE_URL at build time (not used for connections)
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

# Stage 2: Production runtime (only production deps)
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy Prisma schema + generated client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/build ./build
COPY --from=builder /app/public ./public
COPY prisma ./prisma

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
