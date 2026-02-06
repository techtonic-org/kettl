"""Minimal mem0 REST API server."""
import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from mem0 import Memory
from mem0.embeddings.base import EmbeddingBase
from mem0.configs.embeddings.base import BaseEmbedderConfig
import litellm

app = FastAPI(title="Mem0 Server")


# Custom litellm embedder with dimension support
class LitellmEmbedding(EmbeddingBase):
    """Embedding class using litellm for Gemini embedding models."""

    def __init__(self, config: Optional[BaseEmbedderConfig] = None):
        super().__init__(config)
        self.config.model = self.config.model or "gemini/gemini-embedding-001"
        self.config.embedding_dims = self.config.embedding_dims or 768
        self.api_key = self.config.api_key or os.getenv("OPENAI_API_KEY")

    def embed(self, text, memory_action=None):
        """Get embedding using litellm with dimension support."""
        text = text.replace("\n", " ")
        response = litellm.embedding(
            model=self.config.model,
            input=[text],
            api_key=self.api_key,
            dimensions=self.config.embedding_dims
        )
        return response.data[0]["embedding"]


# Register custom embedder with mem0 by patching the factory
# Use "gemini" as the provider name to pass validation, but intercept to use our custom class
from mem0.utils.factory import EmbedderFactory
from mem0.configs.embeddings.base import BaseEmbedderConfig

_original_create = EmbedderFactory.create

@classmethod
def _patched_create(cls, provider_name, config):
    # Intercept "gemini" provider to use our custom litellm-based embedder
    if provider_name == "gemini":
        base_config = BaseEmbedderConfig(**config)
        return LitellmEmbedding(base_config)
    return _original_create(provider_name, config)

EmbedderFactory.create = _patched_create


# Configure mem0 with Qdrant
config = {
    "vector_store": {
        "provider": "qdrant",
        "config": {
            "host": os.getenv("QDRANT_HOST", "localhost"),
            "port": int(os.getenv("QDRANT_PORT", 6333)),
        }
    },
    "llm": {
        "provider": "litellm",
        "config": {
            "model": "gemini/gemini-2.0-flash",
            "api_key": os.getenv("OPENAI_API_KEY"),  # Actually Gemini key
        }
    },
    "embedder": {
        "provider": "gemini",  # Use gemini to pass validation, but factory returns our custom embedder
        "config": {
            "model": "gemini/gemini-embedding-001",
            "embedding_dims": 768,
            "api_key": os.getenv("OPENAI_API_KEY"),  # Actually Gemini key
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
