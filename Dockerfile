# Use Node.js base image with Debian Bullseye (more stable)
FROM node:18-bullseye

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Download and install Chrome manually (bypasses repository issues)
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
    apt-get update && \
    apt-get install -y ./google-chrome-stable_current_amd64.deb && \
    rm google-chrome-stable_current_amd64.deb && \
    rm -rf /var/lib/apt/lists/*

# Install ChromeDriver using npm
RUN npm install -g chromedriver

# Set up app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app code
COPY . .

# Set environment variables for non-interactive mode
ENV NODE_ENV=production
ENV CI=true
ENV FORCE_COLOR=1

# Expose port (if needed for web interface)
EXPOSE 3000

# Start the app
CMD ["npm", "start"] 