FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV HTTP_HOST=0.0.0.0
ENV HTTP_PORT=3000

EXPOSE 3000 1502

CMD ["node", "server.js"]
