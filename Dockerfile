# Imagem única para o site (next start) e para o worker (npm run worker)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# O build não precisa de credenciais reais
RUN DATABASE_URL=postgres://build:build@localhost/build APP_SECRET=build-secret-build-secret-build-secret-0000 npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN useradd --system --uid 1001 app
COPY --from=build /app ./
RUN npm prune --omit=dev
USER app
EXPOSE 3000
CMD ["npm", "start"]
