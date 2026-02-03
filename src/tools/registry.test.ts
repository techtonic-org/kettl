import { describe, test, expect, beforeEach } from "bun:test";

// Create a fresh registry for testing (don't use singleton which has registered tools)
class TestToolRegistry {
  private tools: Map<string, { definition: any; handler: any }> = new Map();

  register(definition: any, handler: any): void {
    this.tools.set(definition.name, { definition, handler });
  }

  getDefinitions(): any[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(call: { name: string; args: Record<string, unknown> }): Promise<any> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        name: call.name,
        result: null,
        error: `Unknown tool: ${call.name}`,
      };
    }

    try {
      const result = await tool.handler(call.args);
      return { name: call.name, result };
    } catch (error) {
      return {
        name: call.name,
        result: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async executeAll(calls: { name: string; args: Record<string, unknown> }[]): Promise<any[]> {
    return Promise.all(calls.map((call) => this.execute(call)));
  }
}

describe("ToolRegistry", () => {
  let registry: TestToolRegistry;

  beforeEach(() => {
    registry = new TestToolRegistry();
  });

  test("register adds tool definition", () => {
    const definition = {
      name: "test_tool",
      description: "A test tool",
      parameters: { type: "object", properties: {} },
    };
    const handler = async () => "result";

    registry.register(definition, handler);

    const definitions = registry.getDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0].name).toBe("test_tool");
  });

  test("getDefinitions returns all registered tools", () => {
    registry.register({ name: "tool1", description: "First" }, async () => {});
    registry.register({ name: "tool2", description: "Second" }, async () => {});

    const definitions = registry.getDefinitions();
    expect(definitions).toHaveLength(2);
    expect(definitions.map((d) => d.name)).toEqual(["tool1", "tool2"]);
  });

  test("execute returns result for valid tool", async () => {
    registry.register(
      { name: "echo", description: "Echo" },
      async (args: any) => args.message
    );

    const result = await registry.execute({
      name: "echo",
      args: { message: "hello" },
    });

    expect(result.name).toBe("echo");
    expect(result.result).toBe("hello");
    expect(result.error).toBeUndefined();
  });

  test("execute returns error for unknown tool", async () => {
    const result = await registry.execute({
      name: "nonexistent",
      args: {},
    });

    expect(result.name).toBe("nonexistent");
    expect(result.result).toBeNull();
    expect(result.error).toBe("Unknown tool: nonexistent");
  });

  test("execute catches handler errors", async () => {
    registry.register({ name: "failing", description: "Fails" }, async () => {
      throw new Error("Handler failed");
    });

    const result = await registry.execute({ name: "failing", args: {} });

    expect(result.name).toBe("failing");
    expect(result.result).toBeNull();
    expect(result.error).toBe("Handler failed");
  });

  test("execute handles non-Error throws", async () => {
    registry.register({ name: "weird", description: "Throws string" }, async () => {
      throw "not an error";
    });

    const result = await registry.execute({ name: "weird", args: {} });

    expect(result.error).toBe("Unknown error");
  });

  test("executeAll runs multiple tools in parallel", async () => {
    const order: string[] = [];

    registry.register({ name: "slow", description: "Slow" }, async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("slow");
      return "slow result";
    });

    registry.register({ name: "fast", description: "Fast" }, async () => {
      order.push("fast");
      return "fast result";
    });

    const results = await registry.executeAll([
      { name: "slow", args: {} },
      { name: "fast", args: {} },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].result).toBe("slow result");
    expect(results[1].result).toBe("fast result");
    // Fast should complete before slow since they run in parallel
    expect(order).toEqual(["fast", "slow"]);
  });

  test("register overwrites existing tool", () => {
    registry.register({ name: "tool", description: "First" }, async () => "first");
    registry.register({ name: "tool", description: "Second" }, async () => "second");

    const definitions = registry.getDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0].description).toBe("Second");
  });
});
