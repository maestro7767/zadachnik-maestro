# Сервер «Маэстро»: аккаунты + синхронизация.
# bookworm-slim: glibc — подходят готовые бинарники argon2, сборка из исходников не нужна.
FROM node:24-bookworm-slim

WORKDIR /app

# Сначала только зависимости — слой кешируется, пока не меняется lock-файл.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
# База SQLite на примонтированном диске (переживает перезапуски и передеплои).
ENV DB_PATH=/data/maestro.db
EXPOSE 3000
VOLUME ["/data"]

CMD ["npm", "start"]
