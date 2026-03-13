ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine
WORKDIR /usr/src/app
COPY . .
RUN npm ci
EXPOSE 80
CMD ["node", "src/index.js", "80"]