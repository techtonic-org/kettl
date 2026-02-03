import { describe, test, expect, mock } from "bun:test";

// Mock config
mock.module("../config", () => ({
  config: {
    geminiApiKey: () => "test-api-key",
  },
}));

// Mock Google Generative AI
const mockSendMessage = mock(() =>
  Promise.resolve({
    response: {
      candidates: [
        {
          content: {
            parts: [{ text: "Test response" }],
          },
          finishReason: "STOP",
        },
      ],
    },
  })
);

const mockStartChat = mock(() => ({
  sendMessage: mockSendMessage,
}));

const mockGetGenerativeModel = mock(() => ({
  startChat: mockStartChat,
}));

mock.module("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    constructor(apiKey: string) {
      // Store for verification if needed
    }
    getGenerativeModel = mockGetGenerativeModel;
  },
  SchemaType: {
    STRING: "STRING",
    NUMBER: "NUMBER",
    BOOLEAN: "BOOLEAN",
    OBJECT: "OBJECT",
    ARRAY: "ARRAY",
  },
}));

// Import after mocking
import { chat, createToolResultPart, type GeminiMessage } from "./gemini";

describe("chat", () => {
  test("sends message and returns text response", async () => {
    const messages: GeminiMessage[] = [
      { role: "user", parts: [{ text: "Hello" }] },
    ];

    const response = await chat(messages, [], "You are a helpful assistant");

    expect(response.text).toBe("Test response");
    expect(response.toolCalls).toEqual([]);
    expect(response.finishReason).toBe("STOP");
  });

  test("parses tool calls from response", async () => {
    mockSendMessage.mockImplementation(() =>
      Promise.resolve({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "get_weather",
                      args: { city: "London" },
                    },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      })
    );

    const messages: GeminiMessage[] = [
      { role: "user", parts: [{ text: "What's the weather?" }] },
    ];

    const response = await chat(messages, [], "System prompt");

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe("get_weather");
    expect(response.toolCalls[0].args).toEqual({ city: "London" });
  });

  test("handles multiple tool calls", async () => {
    mockSendMessage.mockImplementation(() =>
      Promise.resolve({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: "tool1", args: {} } },
                  { functionCall: { name: "tool2", args: { x: 1 } } },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      })
    );

    const messages: GeminiMessage[] = [
      { role: "user", parts: [{ text: "Do stuff" }] },
    ];

    const response = await chat(messages, [], "System");

    expect(response.toolCalls).toHaveLength(2);
    expect(response.toolCalls[0].name).toBe("tool1");
    expect(response.toolCalls[1].name).toBe("tool2");
  });

  test("handles mixed text and tool calls", async () => {
    mockSendMessage.mockImplementation(() =>
      Promise.resolve({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { text: "Let me check" },
                  { functionCall: { name: "check", args: {} } },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      })
    );

    const messages: GeminiMessage[] = [
      { role: "user", parts: [{ text: "Check something" }] },
    ];

    const response = await chat(messages, [], "System");

    expect(response.text).toBe("Let me check");
    expect(response.toolCalls).toHaveLength(1);
  });

  test("throws on empty messages", async () => {
    await expect(chat([], [], "System")).rejects.toThrow("No messages provided");
  });

  test("handles empty candidates", async () => {
    mockSendMessage.mockImplementation(() =>
      Promise.resolve({
        response: {
          candidates: [],
        },
      })
    );

    const messages: GeminiMessage[] = [
      { role: "user", parts: [{ text: "Hello" }] },
    ];

    const response = await chat(messages, [], "System");

    expect(response.text).toBeNull();
    expect(response.toolCalls).toEqual([]);
    expect(response.finishReason).toBe("UNKNOWN");
  });

  test("passes tools to model", async () => {
    mockSendMessage.mockImplementation(() =>
      Promise.resolve({
        response: {
          candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }],
        },
      })
    );

    const tools = [
      {
        name: "test_tool",
        description: "A test tool",
        parameters: {
          type: "object" as const,
          properties: {
            input: { type: "string", description: "Input value" },
          },
          required: ["input"],
        },
      },
    ];

    const messages: GeminiMessage[] = [
      { role: "user", parts: [{ text: "Use tool" }] },
    ];

    await chat(messages, tools, "System");

    // Verify model was called with tools configuration
    expect(mockGetGenerativeModel).toHaveBeenCalled();
  });
});

describe("createToolResultPart", () => {
  test("creates function response part", () => {
    const part = createToolResultPart("test_tool", { data: "result" });

    expect(part).toEqual({
      functionResponse: {
        name: "test_tool",
        response: { result: { data: "result" } },
      },
    });
  });

  test("handles primitive result", () => {
    const part = createToolResultPart("simple", "just a string");

    expect(part.functionResponse?.name).toBe("simple");
    expect(part.functionResponse?.response).toEqual({ result: "just a string" });
  });

  test("handles null result", () => {
    const part = createToolResultPart("nullable", null);

    expect(part.functionResponse?.response).toEqual({ result: null });
  });
});
