import {
  GoogleGenerativeAI,
  SchemaType,
  type Part,
  type FunctionDeclarationSchema,
} from "@google/generative-ai";
import { config } from "../config";
import type { ToolDefinition, ToolCall } from "../types";

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(config.geminiApiKey());
  }
  return client;
}

export interface GeminiResponse {
  text: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}

export interface GeminiMessage {
  role: "user" | "model";
  parts: Part[];
}

function convertToFunctionDeclarationSchema(
  params: ToolDefinition["parameters"]
): FunctionDeclarationSchema {
  const properties: FunctionDeclarationSchema["properties"] = {};
  for (const [key, value] of Object.entries(params.properties)) {
    properties[key] = {
      type: value.type as SchemaType,
      description: value.description,
      enum: value.enum,
    };
  }
  return {
    type: SchemaType.OBJECT,
    properties,
    required: params.required,
  };
}

export async function chat(
  messages: GeminiMessage[],
  tools: ToolDefinition[],
  systemPrompt: string
): Promise<GeminiResponse> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    systemInstruction: systemPrompt,
    tools: tools.length > 0
      ? [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: convertToFunctionDeclarationSchema(t.parameters),
            })),
          },
        ]
      : undefined,
  });

  const chatSession = model.startChat({
    history: messages.slice(0, -1),
  });

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    throw new Error("No messages provided");
  }
  const result = await chatSession.sendMessage(lastMessage.parts);
  const response = result.response;

  const toolCalls: ToolCall[] = [];
  let text: string | null = null;

  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if ("text" in part && part.text) {
        text = part.text;
      }
      if ("functionCall" in part && part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name,
          args: (part.functionCall.args as Record<string, unknown>) || {},
        });
      }
    }
  }

  return {
    text,
    toolCalls,
    finishReason: response.candidates?.[0]?.finishReason || "UNKNOWN",
  };
}

export function createToolResultPart(
  name: string,
  result: unknown
): Part {
  return {
    functionResponse: {
      name,
      response: { result },
    },
  };
}
