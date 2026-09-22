FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY lib ./lib
COPY remote ./remote

ENV PORT=3000
EXPOSE 3000

CMD ["node", "remote/index.js"]
