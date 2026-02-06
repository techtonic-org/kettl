FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir mem0ai==0.1.60 fastapi uvicorn google-generativeai litellm

COPY mem0_server.py .

EXPOSE 8080

CMD ["python", "mem0_server.py"]
