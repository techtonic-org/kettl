import { config } from "../config";
import type { Memory, MemoryCategory, MemorySearchResult } from "../types";

const USER_ID = "kettl-user"; // Single user, hardcoded

async function mem0Fetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = `${config.mem0Url}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mem0 error (${response.status}): ${text}`);
  }

  return response;
}

export async function searchMemories(
  query: string,
  category?: MemoryCategory,
  limit: number = 5
): Promise<MemorySearchResult[]> {
  const body: Record<string, unknown> = {
    query,
    user_id: USER_ID,
    limit,
  };

  if (category) {
    body.metadata = { category };
  }

  const response = await mem0Fetch("/v1/memories/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return (data.results || []).map((r: any) => ({
    memory: {
      id: r.id,
      content: r.memory,
      category: r.metadata?.category || "user_profile",
      createdAt: r.created_at,
      metadata: r.metadata,
    },
    score: r.score,
  }));
}

export async function saveInsight(
  content: string,
  category: MemoryCategory
): Promise<Memory> {
  const response = await mem0Fetch("/v1/memories", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content }],
      user_id: USER_ID,
      metadata: { category },
    }),
  });

  const data = await response.json();
  const created = data.results?.[0];

  return {
    id: created?.id || "unknown",
    content,
    category,
    createdAt: new Date().toISOString(),
    metadata: { category },
  };
}

export async function getUserProfile(): Promise<Memory[]> {
  return (await searchMemories("user profile goals preferences", "user_profile", 10))
    .map((r) => r.memory);
}

export async function isMemoryAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.mem0Url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
