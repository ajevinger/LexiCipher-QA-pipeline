FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Copy package files first for layer caching
COPY package.json ./
RUN npm install --omit=dev

# Copy bot script and pure-math engine modules
COPY bot.js ./
COPY src/ ./src/

# Create downloads directory (mount point for Docker volume)
RUN mkdir -p /app/downloads

CMD ["node", "bot.js"]
