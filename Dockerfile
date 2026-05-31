FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY server/package.json ./
RUN npm install --production

# Copy server and client
COPY server/ ./server/
COPY client/ ./client/

# Move server files to root for simplicity
RUN cp -r server/* . && rm -rf server

EXPOSE 3000

CMD ["node", "index.js"]
