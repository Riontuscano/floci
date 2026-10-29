FROM node:22-bookworm-slim
ENV NODE_ENV=production
# Fewer glibc memory arenas: image processing otherwise fragments memory and keeps growing.
ENV MALLOC_ARENA_MAX=2
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 6100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:6100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
