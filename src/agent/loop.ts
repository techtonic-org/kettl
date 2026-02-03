import { chat, createToolResultPart, type GeminiMessage } from "./gemini";
import { toolRegistry } from "../tools";
import type { ToolResult } from "../types";

const MAX_TOOL_ROUNDS = 5;

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
  newMessages: GeminiMessage[];
}

export async function runAgent(
  userMessage: string,
  systemPrompt: string,
  sessionHistory: GeminiMessage[] = []
): Promise<AgentResponse> {
  const tools = toolRegistry.getDefinitions();
  const messages: GeminiMessage[] = [
    ...sessionHistory,
    { role: "user", parts: [{ text: userMessage }] },
  ];
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    console.log(`[AGENT] Round ${round + 1}/${MAX_TOOL_ROUNDS}`);
    const response = await chat(messages, tools, systemPrompt);

    // If no tool calls, we're done
    if (response.toolCalls.length === 0) {
      console.log("[AGENT] No tool calls, returning response");
      const finalText = response.text || "I couldn't generate a response.";
      messages.push({ role: "model", parts: [{ text: finalText }] });
      return {
        text: finalText,
        toolsUsed,
        newMessages: messages.slice(sessionHistory.length),
      };
    }

    // Execute tool calls
    console.log(`[AGENT] Executing tools: ${response.toolCalls.map((t) => t.name).join(", ")}`);
    const results: ToolResult[] = await toolRegistry.executeAll(response.toolCalls);
    toolsUsed.push(...results.map((r) => r.name));

    // Log tool results
    for (const r of results) {
      if (r.error) {
        console.log(`[TOOL] ${r.name}: ERROR - ${r.error}`);
      } else {
        const preview = JSON.stringify(r.result).slice(0, 100);
        console.log(`[TOOL] ${r.name}: ${preview}${preview.length >= 100 ? "..." : ""}`);
      }
    }

    // Add model response to history (preserve original parts with thought_signature)
    messages.push({
      role: "model",
      parts: response.toolCallParts,
    });

    // Add tool results to history (role must be "function" for functionResponse parts)
    messages.push({
      role: "function",
      parts: results.map((r) =>
        createToolResultPart(r.name, r.error || r.result)
      ),
    });
  }

  // Exceeded max rounds, ask for final response without tools
  const finalResponse = await chat(messages, [], systemPrompt);
  const finalText =
    finalResponse.text ||
    "I used several tools but couldn't formulate a final response.";
  messages.push({ role: "model", parts: [{ text: finalText }] });
  return {
    text: finalText,
    toolsUsed,
    newMessages: messages.slice(sessionHistory.length),
  };
}
