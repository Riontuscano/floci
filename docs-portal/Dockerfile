FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY content ./content
COPY public ./public
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
