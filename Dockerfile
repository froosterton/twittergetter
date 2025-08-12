# Use Node.js base image
FROM node:18

# Install Chrome and dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    curl \
    unzip \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install ChromeDriver with fallback approach
RUN CHROME_VERSION=$(google-chrome --version | grep -oE '[0-9]+\.[0-9]+') && \
    echo "Chrome version: $CHROME_VERSION" && \
    # Try the new Chrome for Testing URL first
    if wget -q "https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/$CHROME_VERSION.0.6045.105/linux64/chromedriver-linux64.zip" -O chromedriver.zip; then \
        echo "Downloaded ChromeDriver from new URL"; \
    else \
        echo "New URL failed, trying alternative version"; \
        wget -q "https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/119.0.6045.105/linux64/chromedriver-linux64.zip" -O chromedriver.zip; \
    fi && \
    unzip chromedriver.zip && \
    mv chromedriver-linux64/chromedriver /usr/local/bin/ && \
    chmod +x /usr/local/bin/chromedriver && \
    rm -rf chromedriver.zip chromedriver-linux64

# Set up app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app code
COPY . .

# Expose port (if needed for web interface)
EXPOSE 3000

# Start the app
CMD ["npm", "start"] 