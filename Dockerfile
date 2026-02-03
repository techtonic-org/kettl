FROM python:3.11-slim
WORKDIR /app

# Install Bun
RUN apt-get update && apt-get install -y curl unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun && \
    rm -rf /var/lib/apt/lists/*

# Install GarminDB
RUN pip install --no-cache-dir garmindb

# Copy package files and install JS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY src ./src
COPY tsconfig.json ./

CMD ["bun", "run", "src/index.ts"]
