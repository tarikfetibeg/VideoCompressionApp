FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY apps ./apps
COPY packages ./packages
RUN npm ci --omit=dev && npm cache clean --force

COPY backend ./backend
CMD ["node", "backend/workers/eventOutboxWorker.js"]
