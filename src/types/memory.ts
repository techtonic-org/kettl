export type MemoryCategory =
  | "user_profile"
  | "goals"
  | "food_impacts"
  | "training_patterns"
  | "weekly_summaries";

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
}
