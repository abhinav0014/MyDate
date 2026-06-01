FROM node:20-alpine

WORKDIR /app

COPY server/package.json ./server/package.json
RUN cd /app/server && npm install --production

COPY server/ ./server/
COPY client/ ./client/

EXPOSE 3000

CMD ["node", "server/index.js"]
