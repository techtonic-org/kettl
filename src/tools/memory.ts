import { toolRegistry } from "./registry";
import {
  searchMemories,
  saveInsight,
  getUserProfile,
  isMemoryAvailable,
} from "../memory";
import type { MemoryCategory } from "../types";

const VALID_CATEGORIES: MemoryCategory[] = [
  "user_profile",
  "goals",
  "food_impacts",
  "training_patterns",
  "weekly_summaries",
];

// search_memories
toolRegistry.register(
  {
    name: "search_memories",
    description:
      "Search past conversations and saved insights for relevant context. Use when user references past discussions, goals, or patterns.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for",
        },
        category: {
          type: "string",
          description: "Optional category to filter by",
          enum: VALID_CATEGORIES,
        },
      },
      required: ["query"],
    },
  },
  async (args) => {
    if (!(await isMemoryAvailable())) {
      return { error: "Memory service unavailable" };
    }
    const query = String(args.query);
    const category = args.category as MemoryCategory | undefined;
    const results = await searchMemories(query, category);
    return results.map((r) => ({
      content: r.memory.content,
      category: r.memory.category,
      relevance: r.score,
    }));
  }
);

// save_insight
toolRegistry.register(
  {
    name: "save_insight",
    description:
      "Save an important insight, pattern, or user preference for future reference. Be selective - only save things worth remembering.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The insight to save",
        },
        category: {
          type: "string",
          description: "Category for organizing",
          enum: VALID_CATEGORIES,
        },
      },
      required: ["content", "category"],
    },
  },
  async (args) => {
    if (!(await isMemoryAvailable())) {
      return { error: "Memory service unavailable" };
    }
    const content = String(args.content);
    const category = args.category as MemoryCategory;
    if (!VALID_CATEGORIES.includes(category)) {
      return { error: `Invalid category. Use one of: ${VALID_CATEGORIES.join(", ")}` };
    }
    const memory = await saveInsight(content, category);
    return { saved: true, id: memory.id };
  }
);

// get_user_profile
toolRegistry.register(
  {
    name: "get_user_profile",
    description:
      "Retrieve the user's core profile: goals, preferences, coaching style, constraints.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    if (!(await isMemoryAvailable())) {
      return { error: "Memory service unavailable" };
    }
    const memories = await getUserProfile();
    if (memories.length === 0) {
      return { hasProfile: false, message: "No user profile found. This may be a new user." };
    }
    return {
      hasProfile: true,
      profile: memories.map((m) => m.content),
    };
  }
);
