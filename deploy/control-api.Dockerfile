FROM node:20-bookworm-slim AS frontend-build

WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm run build --prefix frontend

FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY apps ./apps
COPY packages ./packages
RUN npm ci --omit=dev && npm cache clean --force

COPY backend ./backend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 5000
CMD ["node", "backend/app.js"]
