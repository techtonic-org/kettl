import type { ToolDefinition, ToolCall, ToolResult } from "../types";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
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

  async executeAll(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.execute(call)));
  }
}

export const toolRegistry = new ToolRegistry();
