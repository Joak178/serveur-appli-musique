FROM node:20-slim

WORKDIR /app

ENV NODE_ENV="production"

COPY package-lock.json package.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD [ "node", "server.js" ]