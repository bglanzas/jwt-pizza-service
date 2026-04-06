ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
EXPOSE 80
CMD ["node", "src/index.js", "80"]
