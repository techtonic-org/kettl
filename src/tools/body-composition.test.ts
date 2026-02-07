import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { BodyCompositionMeasurement } from "../ports/body-composition";

// Mock the Withings adapter
const mockGetLatest = mock(
  (): Promise<BodyCompositionMeasurement | null> =>
    Promise.resolve({
      date: "2026-02-03",
      time: "08:30",
      weight: 80.1,
      fatPercent: 18.2,
      muscleMass: 36.4,
      boneMass: 3.2,
      waterPercent: 55.1,
      bmi: 24.3,
    })
);

const mockGetTrend = mock(
  (): Promise<BodyCompositionMeasurement[]> =>
    Promise.resolve([
      {
        date: "2026-02-03",
        time: "08:30",
        weight: 80.1,
        fatPercent: 18.2,
        muscleMass: 36.4,
        boneMass: 3.2,
        waterPercent: 55.1,
        bmi: 24.3,
      },
      {
        date: "2026-02-01",
        time: "07:45",
        weight: 80.5,
        fatPercent: 18.5,
        muscleMass: 36.2,
        boneMass: 3.2,
        waterPercent: 54.8,
        bmi: 24.4,
      },
    ])
);

const mockGetForDate = mock(
  (): Promise<BodyCompositionMeasurement[]> => Promise.resolve([])
);

mock.module("../adapters/withings", () => ({
  withingsAdapter: {
    getLatest: mockGetLatest,
    getTrend: mockGetTrend,
    getForDate: mockGetForDate,
  },
}));

// Use a test registry (same pattern as garmin.test.ts)
class TestToolRegistry {
  private tools: Map<string, { definition: any; handler: any }> = new Map();

  register(definition: any, handler: any): void {
    this.tools.set(definition.name, { definition, handler });
  }

  async execute(name: string, args: any = {}): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(args);
  }

  getDefinition(name: string): any {
    return this.tools.get(name)?.definition;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

mock.module("./registry", () => {
  const registry = new TestToolRegistry();
  return { toolRegistry: registry };
});

// Import after mocks
const { toolRegistry } = await import("./registry");

// Dynamically import to trigger side-effect registration
await import("./body-composition");

beforeEach(() => {
  mockGetLatest.mockClear();
  mockGetTrend.mockClear();
});

describe("body-composition tools", () => {
  test("get_latest_weight tool is registered", () => {
    const def = (toolRegistry as any).getDefinition("get_latest_weight");
    expect(def).toBeDefined();
    expect(def.name).toBe("get_latest_weight");
  });

  test("get_weight_trend tool is registered", () => {
    const def = (toolRegistry as any).getDefinition("get_weight_trend");
    expect(def).toBeDefined();
    expect(def.name).toBe("get_weight_trend");
  });

  test("get_latest_weight calls adapter.getLatest()", async () => {
    const result = await (toolRegistry as any).execute("get_latest_weight");
    expect(mockGetLatest).toHaveBeenCalledTimes(1);
    expect(result.weight).toBe(80.1);
    expect(result.fatPercent).toBe(18.2);
    expect(result.muscleMass).toBe(36.4);
  });

  test("get_weight_trend uses default 30 days", async () => {
    await (toolRegistry as any).execute("get_weight_trend", {});
    expect(mockGetTrend).toHaveBeenCalledWith(30);
  });

  test("get_weight_trend accepts custom days parameter", async () => {
    await (toolRegistry as any).execute("get_weight_trend", { days: 14 });
    expect(mockGetTrend).toHaveBeenCalledWith(14);
  });

  test("get_weight_trend ignores non-number days", async () => {
    await (toolRegistry as any).execute("get_weight_trend", {
      days: "invalid",
    });
    expect(mockGetTrend).toHaveBeenCalledWith(30);
  });

  test("get_weight_trend returns array of measurements", async () => {
    const result = await (toolRegistry as any).execute("get_weight_trend", {
      days: 30,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].weight).toBe(80.1);
    expect(result[1].weight).toBe(80.5);
  });
});
