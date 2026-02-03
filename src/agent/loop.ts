import { chat, createToolResultPart, type GeminiMessage } from "./gemini";
import { toolRegistry } from "../tools";
import type { ToolResult } from "../types";

const MAX_TOOL_ROUNDS = 5;

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
}

export async function runAgent(
  userMessage: string,
  systemPrompt: string
): Promise<AgentResponse> {
  const tools = toolRegistry.getDefinitions();
  const messages: GeminiMessage[] = [
    { role: "user", parts: [{ text: userMessage }] },
  ];
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chat(messages, tools, systemPrompt);

    // If no tool calls, we're done
    if (response.toolCalls.length === 0) {
      return {
        text: response.text || "I couldn't generate a response.",
        toolsUsed,
      };
    }

    // Execute tool calls
    const results: ToolResult[] = await toolRegistry.executeAll(response.toolCalls);
    toolsUsed.push(...results.map((r) => r.name));

    // Add model response to history
    messages.push({
      role: "model",
      parts: response.toolCalls.map((tc) => ({
        functionCall: { name: tc.name, args: tc.args },
      })),
    });

    // Add tool results to history
    messages.push({
      role: "user",
      parts: results.map((r) =>
        createToolResultPart(r.name, r.error || r.result)
      ),
    });
  }

  // Exceeded max rounds, ask for final response without tools
  const finalResponse = await chat(messages, [], systemPrompt);
  return {
    text:
      finalResponse.text ||
      "I used several tools but couldn't formulate a final response.",
    toolsUsed,
  };
}
