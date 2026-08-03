# Adjust NODE_VERSION as desired
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

# Installation de python3, ffmpeg, ca-certificates et curl
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    python3 \
    ca-certificates \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV="production"

# Étape d'installation des dépendances npm
FROM base AS build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config

COPY package-lock.json package.json ./
RUN npm ci

COPY . .

# Étape finale
FROM base

COPY --from=build /app /app

EXPOSE 3000

CMD [ "node", "server.js" ]