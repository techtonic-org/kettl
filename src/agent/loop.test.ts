import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { GeminiMessage } from "./gemini";

// Mock chat function
const mockChat = mock(() =>
  Promise.resolve({
    text: "Final response",
    toolCalls: [],
    toolCallParts: [],
    finishReason: "STOP",
  })
);

const mockCreateToolResultPart = mock((name: string, result: unknown) => ({
  functionResponse: { name, response: { result } },
}));

mock.module("./gemini", () => ({
  chat: mockChat,
  createToolResultPart: mockCreateToolResultPart,
}));

// Mock tool registry
const mockGetDefinitions = mock(() => [
  { name: "test_tool", description: "Test", parameters: { type: "object", properties: {} } },
]);

const mockExecuteAll = mock(() =>
  Promise.resolve([{ name: "test_tool", result: { data: "tool result" } }])
);

mock.module("../tools", () => ({
  toolRegistry: {
    getDefinitions: mockGetDefinitions,
    executeAll: mockExecuteAll,
  },
}));

// Import after mocking
import { runAgent } from "./loop";

beforeEach(() => {
  mockChat.mockClear();
  mockGetDefinitions.mockClear();
  mockExecuteAll.mockClear();
  mockCreateToolResultPart.mockClear();

  // Reset to default implementation
  mockChat.mockImplementation(() =>
    Promise.resolve({
      text: "Final response",
      toolCalls: [],
      toolCallParts: [],
      finishReason: "STOP",
    })
  );

  // Reset executeAll to default
  mockExecuteAll.mockImplementation(() =>
    Promise.resolve([{ name: "test_tool", result: { data: "tool result" } }])
  );
});

describe("runAgent", () => {
  test("returns text response when no tool calls", async () => {
    const result = await runAgent("Hello", "You are helpful");

    expect(result.text).toBe("Final response");
    expect(result.toolsUsed).toEqual([]);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  test("executes tools and continues conversation", async () => {
    let callCount = 0;
    mockChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          text: null,
          toolCalls: [{ name: "test_tool", args: { input: "test" } }],
          toolCallParts: [{ functionCall: { name: "test_tool", args: { input: "test" } } }],
          finishReason: "STOP",
        });
      }
      return Promise.resolve({
        text: "Got the result!",
        toolCalls: [],
        toolCallParts: [],
        finishReason: "STOP",
      });
    });

    const result = await runAgent("Do something", "System");

    expect(result.text).toBe("Got the result!");
    expect(result.toolsUsed).toEqual(["test_tool"]);
    expect(mockExecuteAll).toHaveBeenCalledTimes(1);
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  test("tracks multiple tools used", async () => {
    let callCount = 0;
    mockChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          text: null,
          toolCalls: [
            { name: "tool1", args: {} },
            { name: "tool2", args: {} },
          ],
          toolCallParts: [
            { functionCall: { name: "tool1", args: {} } },
            { functionCall: { name: "tool2", args: {} } },
          ],
          finishReason: "STOP",
        });
      }
      return Promise.resolve({
        text: "Done",
        toolCalls: [],
        toolCallParts: [],
        finishReason: "STOP",
      });
    });

    mockExecuteAll.mockImplementation(() =>
      Promise.resolve([
        { name: "tool1", result: "result1" },
        { name: "tool2", result: "result2" },
      ])
    );

    const result = await runAgent("Use tools", "System");

    expect(result.toolsUsed).toEqual(["tool1", "tool2"]);
  });

  test("respects max tool rounds", async () => {
    // Always return tool calls to hit the limit
    mockChat.mockImplementation(() =>
      Promise.resolve({
        text: null,
        toolCalls: [{ name: "infinite_tool", args: {} }],
        toolCallParts: [{ functionCall: { name: "infinite_tool", args: {} } }],
        finishReason: "STOP",
      })
    );

    mockExecuteAll.mockImplementation(() =>
      Promise.resolve([{ name: "infinite_tool", result: "keep going" }])
    );

    const result = await runAgent("Loop forever", "System");

    // MAX_TOOL_ROUNDS is 5, plus final call without tools
    expect(mockChat).toHaveBeenCalledTimes(6);
    expect(result.toolsUsed).toHaveLength(5); // 5 rounds of tool use
  });

  test("handles tool errors gracefully", async () => {
    let callCount = 0;
    mockChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          text: null,
          toolCalls: [{ name: "failing_tool", args: {} }],
          toolCallParts: [{ functionCall: { name: "failing_tool", args: {} } }],
          finishReason: "STOP",
        });
      }
      return Promise.resolve({
        text: "Handled the error",
        toolCalls: [],
        toolCallParts: [],
        finishReason: "STOP",
      });
    });

    mockExecuteAll.mockImplementation(() =>
      Promise.resolve([{ name: "failing_tool", result: null, error: "Tool failed" }])
    );

    const result = await runAgent("Try failing tool", "System");

    expect(result.text).toBe("Handled the error");
    expect(result.toolsUsed).toEqual(["failing_tool"]);
    // Error is passed to createToolResultPart
    expect(mockCreateToolResultPart).toHaveBeenCalledWith("failing_tool", "Tool failed");
  });

  test("provides default response when text is null", async () => {
    mockChat.mockImplementation(() =>
      Promise.resolve({
        text: null,
        toolCalls: [],
        finishReason: "STOP",
      })
    );

    const result = await runAgent("Hello", "System");

    expect(result.text).toBe("I couldn't generate a response.");
  });

  test("passes tools to chat function", async () => {
    await runAgent("Test", "System");

    const chatCall = mockChat.mock.calls[0];
    const [, tools] = chatCall as [any, any[], string];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("test_tool");
  });
});

describe("runAgent with session history", () => {
  test("includes session history in conversation", async () => {
    // Explicitly set mock to return no tool calls
    mockChat.mockImplementation(() =>
      Promise.resolve({
        text: "Response with history",
        toolCalls: [],
        toolCallParts: [],
        finishReason: "STOP",
      })
    );

    // Clear mock calls right before our test
    mockChat.mockClear();

    const sessionHistory: GeminiMessage[] = [
      { role: "user", parts: [{ text: "Previous question" }] },
      { role: "model", parts: [{ text: "Previous answer" }] },
    ];

    await runAgent("New question", "System", sessionHistory);

    // First call should include session history
    // Note: messages array gets mutated after chat() returns (model response is added),
    // so we check the first 3 messages which are what was passed to the first chat() call
    const firstCall = mockChat.mock.calls[0];
    const [messages] = firstCall as [any[], any, string];

    // The array now includes the final model response (added after chat returns)
    // We verify the first 3 messages are correct
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages[0].parts[0].text).toBe("Previous question");
    expect(messages[1].parts[0].text).toBe("Previous answer");
    expect(messages[2].parts[0].text).toBe("New question");
  });
});

describe("runAgent message tracking", () => {
  test("returns all new messages from conversation", async () => {
    let callCount = 0;
    mockChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          text: null,
          toolCalls: [{ name: "test_tool", args: {} }],
          toolCallParts: [{ functionCall: { name: "test_tool", args: {} } }],
          finishReason: "STOP",
        });
      }
      return Promise.resolve({
        text: "Final answer",
        toolCalls: [],
        toolCallParts: [],
        finishReason: "STOP",
      });
    });

    const result = await runAgent("Question", "System");

    // Should include: user, model (tool call), function (result), model (final)
    expect(result.newMessages).toHaveLength(4);
    expect(result.newMessages[0].role).toBe("user");
    expect(result.newMessages[1].role).toBe("model");
    expect(result.newMessages[2].role).toBe("function");
    expect(result.newMessages[3].role).toBe("model");
  });

  test("returns newMessages when max rounds exceeded", async () => {
    // Always return tool calls to hit the limit
    mockChat.mockImplementation(() =>
      Promise.resolve({
        text: null,
        toolCalls: [{ name: "loop_tool", args: {} }],
        toolCallParts: [{ functionCall: { name: "loop_tool", args: {} } }],
        finishReason: "STOP",
      })
    );

    mockExecuteAll.mockImplementation(() =>
      Promise.resolve([{ name: "loop_tool", result: "continue" }])
    );

    const result = await runAgent("Loop forever", "System");

    // Should include: user, plus 5 rounds of (model + function), plus final model
    // 1 + 5*2 + 1 = 12 messages
    expect(result.newMessages).toHaveLength(12);
    expect(result.newMessages[0].role).toBe("user");
    expect(result.newMessages[11].role).toBe("model");
  });

  test("newMessages excludes session history", async () => {
    mockChat.mockImplementation(() =>
      Promise.resolve({
        text: "Response",
        toolCalls: [],
        toolCallParts: [],
        finishReason: "STOP",
      })
    );

    const sessionHistory: GeminiMessage[] = [
      { role: "user", parts: [{ text: "Previous question" }] },
      { role: "model", parts: [{ text: "Previous answer" }] },
    ];

    const result = await runAgent("New question", "System", sessionHistory);

    // Only new messages: user + model
    expect(result.newMessages).toHaveLength(2);
    expect(result.newMessages[0].role).toBe("user");
    expect(result.newMessages[0].parts[0]).toEqual({ text: "New question" });
    expect(result.newMessages[1].role).toBe("model");
  });
});
