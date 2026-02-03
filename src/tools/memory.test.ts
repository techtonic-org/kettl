import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock the memory module
const mockSearchMemories = mock(() => Promise.resolve([]));
const mockSaveInsight = mock(() =>
  Promise.resolve({ id: "mem-123", content: "test", category: "goals", timestamp: new Date() })
);
const mockGetUserProfile = mock(() => Promise.resolve([]));
const mockIsMemoryAvailable = mock(() => Promise.resolve(true));

mock.module("../memory", () => ({
  searchMemories: mockSearchMemories,
  saveInsight: mockSaveInsight,
  getUserProfile: mockGetUserProfile,
  isMemoryAvailable: mockIsMemoryAvailable,
}));

// Create a test registry
class TestToolRegistry {
  private tools: Map<string, { definition: any; handler: any }> = new Map();

  register(definition: any, handler: any): void {
    this.tools.set(definition.name, { definition, handler });
  }

  getDefinitions(): any[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(args);
  }
}

// Set up registry with memory tools
const registry = new TestToolRegistry();

const VALID_CATEGORIES = [
  "user_profile",
  "goals",
  "food_impacts",
  "training_patterns",
  "weekly_summaries",
];

// Register tools (mirroring memory.ts)
registry.register(
  {
    name: "search_memories",
    description: "Search past conversations",
    parameters: { type: "object", properties: {}, required: ["query"] },
  },
  async (args: any) => {
    if (!(await mockIsMemoryAvailable())) {
      return { error: "Memory service unavailable" };
    }
    const query = String(args.query);
    const category = args.category;
    const results = await mockSearchMemories(query, category);
    return (results as any[]).map((r: any) => ({
      content: r.memory.content,
      category: r.memory.category,
      relevance: r.score,
    }));
  }
);

registry.register(
  {
    name: "save_insight",
    description: "Save an insight",
    parameters: { type: "object", properties: {}, required: ["content", "category"] },
  },
  async (args: any) => {
    if (!(await mockIsMemoryAvailable())) {
      return { error: "Memory service unavailable" };
    }
    const content = String(args.content);
    const category = args.category;
    if (!VALID_CATEGORIES.includes(category)) {
      return { error: `Invalid category. Use one of: ${VALID_CATEGORIES.join(", ")}` };
    }
    const memory = await mockSaveInsight(content, category);
    return { saved: true, id: memory.id };
  }
);

registry.register(
  {
    name: "get_user_profile",
    description: "Get user profile",
    parameters: { type: "object", properties: {} },
  },
  async () => {
    if (!(await mockIsMemoryAvailable())) {
      return { error: "Memory service unavailable" };
    }
    const memories = await mockGetUserProfile();
    if ((memories as any[]).length === 0) {
      return { hasProfile: false, message: "No user profile found. This may be a new user." };
    }
    return {
      hasProfile: true,
      profile: (memories as any[]).map((m: any) => m.content),
    };
  }
);

beforeEach(() => {
  mockSearchMemories.mockClear();
  mockSaveInsight.mockClear();
  mockGetUserProfile.mockClear();
  mockIsMemoryAvailable.mockClear();
  mockIsMemoryAvailable.mockImplementation(() => Promise.resolve(true));
});

describe("search_memories tool", () => {
  test("returns empty array when no results", async () => {
    mockSearchMemories.mockImplementation(() => Promise.resolve([]));
    const result = await registry.execute("search_memories", { query: "test" });
    expect(result).toEqual([]);
  });

  test("formats search results correctly", async () => {
    mockSearchMemories.mockImplementation(() =>
      Promise.resolve([
        { memory: { content: "goal 1", category: "goals" }, score: 0.9 },
        { memory: { content: "goal 2", category: "goals" }, score: 0.7 },
      ])
    );
    const result = await registry.execute("search_memories", { query: "goals" });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ content: "goal 1", category: "goals", relevance: 0.9 });
  });

  test("passes category filter to searchMemories", async () => {
    mockSearchMemories.mockImplementation(() => Promise.resolve([]));
    await registry.execute("search_memories", { query: "test", category: "goals" });
    expect(mockSearchMemories).toHaveBeenCalledWith("test", "goals");
  });

  test("returns error when memory unavailable", async () => {
    mockIsMemoryAvailable.mockImplementation(() => Promise.resolve(false));
    const result = await registry.execute("search_memories", { query: "test" });
    expect(result).toEqual({ error: "Memory service unavailable" });
  });
});

describe("save_insight tool", () => {
  test("saves insight and returns id", async () => {
    const result = await registry.execute("save_insight", {
      content: "User prefers morning runs",
      category: "user_profile",
    });
    expect(result).toEqual({ saved: true, id: "mem-123" });
    expect(mockSaveInsight).toHaveBeenCalledWith("User prefers morning runs", "user_profile");
  });

  test("rejects invalid category", async () => {
    const result = await registry.execute("save_insight", {
      content: "test",
      category: "invalid_category",
    });
    expect(result.error).toContain("Invalid category");
  });

  test("returns error when memory unavailable", async () => {
    mockIsMemoryAvailable.mockImplementation(() => Promise.resolve(false));
    const result = await registry.execute("save_insight", {
      content: "test",
      category: "goals",
    });
    expect(result).toEqual({ error: "Memory service unavailable" });
  });
});

describe("get_user_profile tool", () => {
  test("returns hasProfile false for new user", async () => {
    mockGetUserProfile.mockImplementation(() => Promise.resolve([]));
    const result = await registry.execute("get_user_profile", {});
    expect(result.hasProfile).toBe(false);
    expect(result.message).toContain("new user");
  });

  test("returns profile contents for existing user", async () => {
    mockGetUserProfile.mockImplementation(() =>
      Promise.resolve([{ content: "Prefers zone 2 training" }, { content: "Goal: marathon in 2026" }])
    );
    const result = await registry.execute("get_user_profile", {});
    expect(result.hasProfile).toBe(true);
    expect(result.profile).toEqual(["Prefers zone 2 training", "Goal: marathon in 2026"]);
  });

  test("returns error when memory unavailable", async () => {
    mockIsMemoryAvailable.mockImplementation(() => Promise.resolve(false));
    const result = await registry.execute("get_user_profile", {});
    expect(result).toEqual({ error: "Memory service unavailable" });
  });
});
