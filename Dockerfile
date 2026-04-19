FROM node:20-alpine

# Install FFmpeg and dumb-init for proper signal handling
RUN apk add --no-cache ffmpeg dumb-init

WORKDIR /app

# Install server dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Install dashboard dependencies and build
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN cd dashboard && npm ci

# Copy all source code
COPY . .

# Build dashboard
RUN cd dashboard && npm run build

# Create directories
RUN mkdir -p /app/server/uploads /var/www/videos

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
