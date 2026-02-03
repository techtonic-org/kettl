import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// Store original fetch
const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

// Mock config
mock.module("../config", () => ({
  config: {
    mem0Url: "http://localhost:8000",
  },
}));

// Import after mocking
import {
  searchMemories,
  saveInsight,
  getUserProfile,
  isMemoryAvailable,
} from "./client";

beforeEach(() => {
  mockFetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
  );
  globalThis.fetch = mockFetch as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("searchMemories", () => {
  test("sends correct request", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }))
    );

    await searchMemories("test query");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/v1/memories/search/");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string);
    expect(body.query).toBe("test query");
    expect(body.user_id).toBe("kettl-user");
  });

  test("includes category filter when provided", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }))
    );

    await searchMemories("test", "goals");

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.metadata).toEqual({ category: "goals" });
  });

  test("parses array response", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { id: "1", memory: "content", score: 0.9, metadata: { category: "goals" } },
          ]),
          { status: 200 }
        )
      )
    );

    const results = await searchMemories("test");

    expect(results).toHaveLength(1);
    expect(results[0].memory.content).toBe("content");
    expect(results[0].score).toBe(0.9);
  });

  test("parses results object response", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [{ id: "1", memory: "content", score: 0.8, metadata: {} }],
          }),
          { status: 200 }
        )
      )
    );

    const results = await searchMemories("test");
    expect(results).toHaveLength(1);
  });

  test("handles nested results response", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: {
              results: [{ id: "1", memory: "content", score: 0.7, metadata: {} }],
            },
          }),
          { status: 200 }
        )
      )
    );

    const results = await searchMemories("test");
    expect(results).toHaveLength(1);
  });

  test("returns empty array for unexpected format", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ unexpected: "format" }), { status: 200 })
      )
    );

    const results = await searchMemories("test");
    expect(results).toEqual([]);
  });

  test("throws on API error (non-retryable)", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response("Bad Request", { status: 400 }))
    );

    await expect(searchMemories("test")).rejects.toThrow("Mem0 error (400)");
  });

  test("retries on 429 then succeeds", async () => {
    let calls = 0;
    mockFetch.mockImplementation(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(new Response("Rate limited", { status: 429 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ results: [] }), { status: 200 })
      );
    });

    const results = await searchMemories("test");
    expect(results).toEqual([]);
    expect(calls).toBe(2);
  });
});

describe("saveInsight", () => {
  test("sends correct request", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ results: [{ id: "mem-123" }] }),
          { status: 200 }
        )
      )
    );

    await saveInsight("Test insight", "goals");

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/v1/memories/");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].content).toBe("Test insight");
    expect(body.metadata.category).toBe("goals");
  });

  test("returns memory with id from response", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ results: [{ id: "mem-456" }] }),
          { status: 200 }
        )
      )
    );

    const memory = await saveInsight("content", "user_profile");

    expect(memory.id).toBe("mem-456");
    expect(memory.content).toBe("content");
    expect(memory.category).toBe("user_profile");
  });

  test("returns unknown id when response missing", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    );

    const memory = await saveInsight("content", "goals");
    expect(memory.id).toBe("unknown");
  });
});

describe("getUserProfile", () => {
  test("calls searchMemories with user_profile category", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              { id: "1", memory: "profile info", score: 0.9, metadata: { category: "user_profile" } },
            ],
          }),
          { status: 200 }
        )
      )
    );

    const profile = await getUserProfile();

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.metadata).toEqual({ category: "user_profile" });
    expect(profile).toHaveLength(1);
    expect(profile[0].content).toBe("profile info");
  });
});

describe("isMemoryAvailable", () => {
  test("returns true when health check succeeds", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response("OK", { status: 200 }))
    );

    const available = await isMemoryAvailable();
    expect(available).toBe(true);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/health");
  });

  test("returns false when health check fails", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response("Not Found", { status: 404 }))
    );

    const available = await isMemoryAvailable();
    expect(available).toBe(false);
  });

  test("returns false on network error", async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error("Network error")));

    const available = await isMemoryAvailable();
    expect(available).toBe(false);
  });
});
