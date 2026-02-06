"""Minimal mem0 REST API server."""
import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from mem0 import Memory

app = FastAPI(title="Mem0 Server")

# Configure mem0 with Qdrant
config = {
    "vector_store": {
        "provider": "qdrant",
        "config": {
            "host": os.getenv("QDRANT_HOST", "localhost"),
            "port": int(os.getenv("QDRANT_PORT", 6333)),
            "embedding_model_dims": 3072,  # Gemini gemini-embedding-001 dimension
        }
    },
    "llm": {
        "provider": "gemini",
        "config": {
            "model": "gemini-2.0-flash",
            "api_key": os.getenv("OPENAI_API_KEY"),  # Actually Gemini key
        }
    },
    "embedder": {
        "provider": "gemini",
        "config": {
            "model": "gemini-embedding-001",
            "api_key": os.getenv("OPENAI_API_KEY"),
        }
    }
}

memory: Optional[Memory] = None

def get_memory() -> Memory:
    global memory
    if memory is None:
        memory = Memory.from_config(config)
    return memory

class AddRequest(BaseModel):
    messages: list[dict]
    user_id: str
    metadata: Optional[dict] = None

class SearchRequest(BaseModel):
    query: str
    user_id: str
    limit: int = 10

class MemoryUpdate(BaseModel):
    data: str

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/v1/memories/")
def add_memory(req: AddRequest):
    try:
        m = get_memory()
        result = m.add(req.messages, user_id=req.user_id, metadata=req.metadata)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/memories/search/")
def search_memories(req: SearchRequest):
    try:
        m = get_memory()
        results = m.search(req.query, user_id=req.user_id, limit=req.limit)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/memories/")
def get_all_memories(user_id: str):
    try:
        m = get_memory()
        results = m.get_all(user_id=user_id)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/memories/{memory_id}/")
def get_memory_by_id(memory_id: str):
    try:
        m = get_memory()
        result = m.get(memory_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/v1/memories/{memory_id}/")
def update_memory(memory_id: str, update: MemoryUpdate):
    try:
        m = get_memory()
        result = m.update(memory_id, update.data)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/v1/memories/{memory_id}/")
def delete_memory(memory_id: str):
    try:
        m = get_memory()
        m.delete(memory_id)
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
