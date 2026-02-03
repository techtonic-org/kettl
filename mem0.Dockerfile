FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir mem0ai fastapi uvicorn litellm

COPY mem0_server.py .

EXPOSE 8080

CMD ["python", "mem0_server.py"]
