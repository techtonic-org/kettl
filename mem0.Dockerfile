FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir "mem0ai[server]"

EXPOSE 8080

CMD ["mem0", "server", "--host", "0.0.0.0", "--port", "8080"]
