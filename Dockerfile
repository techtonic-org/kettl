FROM oven/bun:1 AS base
WORKDIR /app

# Install Python for GarminDB
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install garmindb --break-system-packages

# Copy package files
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Run
CMD ["bun", "run", "src/index.ts"]
