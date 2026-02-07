FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

EXPOSE 3456

CMD ["node", "server.js"]
