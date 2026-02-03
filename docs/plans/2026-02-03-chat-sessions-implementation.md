# Chat Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent chat sessions to Kettl bot so Gemini has full conversation context across messages.

**Architecture:** Session state stored in JSONL files (`chats/sessions/TIMESTAMP.jsonl`). Bot loads active session on message, passes full history to agent loop, appends new messages. Auto-expires after 4 hours inactivity.

**Tech Stack:** Bun, Grammy (Telegram), Gemini API, JSONL storage

---

## Task 1: Session Store - Core Types and Helpers

**Files:**
- Create: `src/sessions/store.ts`
- Test: `src/sessions/store.test.ts`

**Step 1: Write the failing test for session file naming**

```typescript
// src/sessions/store.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

testDir = await mkdtemp(join(tmpdir(), "sessions-test-"));

mock.module("../config", () => ({
  config: {
    sessionsPath: testDir,
    timezone: "UTC",
  },
}));

const { getSessionFileName } = await import("./store");

afterEach(async () => {
  const files = await readdir(testDir);
  for (const f of files) {
    await rm(join(testDir, f), { force: true });
  }
});

process.on("beforeExit", async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Session Store", () => {
  test("getSessionFileName returns ISO-formatted filename", () => {
    const date = new Date("2026-02-03T14:30:45.123Z");
    const name = getSessionFileName(date);
    expect(name).toBe("2026-02-03T14-30-45.jsonl");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/sessions/store.test.ts`
Expected: FAIL with "getSessionFileName not found" or similar module error

**Step 3: Write minimal implementation**

```typescript
// src/sessions/store.ts
import { mkdir, appendFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import type { GeminiMessage } from "../agent/gemini";

export interface SessionMeta {
  _meta: true;
  startedAt: string;
  userId: string;
}

export type SessionEntry = SessionMeta | GeminiMessage;

export function getSessionFileName(date: Date): string {
  const iso = date.toISOString();
  // Format: YYYY-MM-DDTHH-mm-ss.jsonl (replace colons for filesystem safety)
  return iso.slice(0, 19).replace(/:/g, "-") + ".jsonl";
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/sessions/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sessions/store.ts src/sessions/store.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): add session store with file naming helper

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Session Store - Create and Append

**Files:**
- Modify: `src/sessions/store.ts`
- Modify: `src/sessions/store.test.ts`

**Step 1: Write failing tests for createSession and appendToSession**

Add to `src/sessions/store.test.ts`:

```typescript
describe("createSession", () => {
  test("creates session file with metadata", async () => {
    const { createSession, getSessionFileName } = await import("./store");

    const startTime = new Date("2026-02-03T14:30:45Z");
    await createSession(startTime, "test-user");

    const expectedFile = join(testDir, getSessionFileName(startTime));
    const content = await Bun.file(expectedFile).text();
    const meta = JSON.parse(content.trim());

    expect(meta._meta).toBe(true);
    expect(meta.startedAt).toBe("2026-02-03T14:30:45.000Z");
    expect(meta.userId).toBe("test-user");
  });
});

describe("appendToSession", () => {
  test("appends message to session file", async () => {
    const { createSession, appendToSession, getSessionFileName } = await import("./store");

    const startTime = new Date("2026-02-03T14:30:45Z");
    await createSession(startTime, "test-user");

    const message: GeminiMessage = {
      role: "user",
      parts: [{ text: "Hello" }],
    };
    await appendToSession(getSessionFileName(startTime), message);

    const expectedFile = join(testDir, getSessionFileName(startTime));
    const lines = (await Bun.file(expectedFile).text()).trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toEqual(message);
  });
});
```

Also add import at the top:
```typescript
import type { GeminiMessage } from "../agent/gemini";
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/sessions/store.test.ts`
Expected: FAIL with "createSession not found"

**Step 3: Write implementation**

Add to `src/sessions/store.ts`:

```typescript
function getSessionFilePath(filename: string): string {
  return join(config.sessionsPath, filename);
}

export async function createSession(
  startTime: Date,
  userId: string
): Promise<string> {
  const filename = getSessionFileName(startTime);
  const filePath = getSessionFilePath(filename);

  await mkdir(config.sessionsPath, { recursive: true });

  const meta: SessionMeta = {
    _meta: true,
    startedAt: startTime.toISOString(),
    userId,
  };

  await appendFile(filePath, JSON.stringify(meta) + "\n");
  return filename;
}

export async function appendToSession(
  filename: string,
  entry: GeminiMessage
): Promise<void> {
  const filePath = getSessionFilePath(filename);
  await appendFile(filePath, JSON.stringify(entry) + "\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/sessions/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sessions/store.ts src/sessions/store.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): add createSession and appendToSession

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Session Store - Load Session

**Files:**
- Modify: `src/sessions/store.ts`
- Modify: `src/sessions/store.test.ts`

**Step 1: Write failing test for loadSession**

Add to `src/sessions/store.test.ts`:

```typescript
describe("loadSession", () => {
  test("loads all messages from session file", async () => {
    const { createSession, appendToSession, loadSession, getSessionFileName } = await import("./store");

    const startTime = new Date("2026-02-03T14:30:45Z");
    await createSession(startTime, "test-user");

    const filename = getSessionFileName(startTime);
    await appendToSession(filename, { role: "user", parts: [{ text: "Hello" }] });
    await appendToSession(filename, { role: "model", parts: [{ text: "Hi there!" }] });

    const session = await loadSession(filename);

    expect(session.meta.startedAt).toBe("2026-02-03T14:30:45.000Z");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[1].role).toBe("model");
  });

  test("returns null for missing session", async () => {
    const { loadSession } = await import("./store");

    const session = await loadSession("nonexistent.jsonl");
    expect(session).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/sessions/store.test.ts`
Expected: FAIL with "loadSession not found"

**Step 3: Write implementation**

Add to `src/sessions/store.ts`:

```typescript
export interface LoadedSession {
  meta: SessionMeta;
  messages: GeminiMessage[];
  filename: string;
}

export async function loadSession(filename: string): Promise<LoadedSession | null> {
  const filePath = getSessionFilePath(filename);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  const lines = content.trim().split("\n").filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const meta = JSON.parse(lines[0]) as SessionMeta;
  const messages = lines.slice(1).map((line) => JSON.parse(line) as GeminiMessage);

  return { meta, messages, filename };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/sessions/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sessions/store.ts src/sessions/store.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): add loadSession for reading session history

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Session Store - Get Active/Recent Sessions

**Files:**
- Modify: `src/sessions/store.ts`
- Modify: `src/sessions/store.test.ts`

**Step 1: Write failing tests for getActiveSession and getRecentSessions**

Add to `src/sessions/store.test.ts`:

```typescript
describe("getActiveSession", () => {
  test("returns most recent session if within expiry window", async () => {
    const { createSession, getActiveSession, getSessionFileName } = await import("./store");

    // Create session 1 hour ago (within 4 hour window)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await createSession(oneHourAgo, "test-user");

    const session = await getActiveSession(4);

    expect(session).not.toBeNull();
    expect(session!.filename).toBe(getSessionFileName(oneHourAgo));
  });

  test("returns null if session is expired", async () => {
    const { createSession, getActiveSession } = await import("./store");

    // Create session 5 hours ago (outside 4 hour window)
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await createSession(fiveHoursAgo, "test-user");

    const session = await getActiveSession(4);

    expect(session).toBeNull();
  });

  test("returns null if no sessions exist", async () => {
    const { getActiveSession } = await import("./store");

    const session = await getActiveSession(4);
    expect(session).toBeNull();
  });
});

describe("getRecentSessions", () => {
  test("returns sessions sorted by most recent first", async () => {
    const { createSession, getRecentSessions } = await import("./store");

    const time1 = new Date("2026-02-03T10:00:00Z");
    const time2 = new Date("2026-02-03T12:00:00Z");
    const time3 = new Date("2026-02-03T14:00:00Z");

    await createSession(time1, "user");
    await createSession(time2, "user");
    await createSession(time3, "user");

    const sessions = await getRecentSessions(5);

    expect(sessions).toHaveLength(3);
    expect(sessions[0].meta.startedAt).toBe(time3.toISOString());
    expect(sessions[1].meta.startedAt).toBe(time2.toISOString());
    expect(sessions[2].meta.startedAt).toBe(time1.toISOString());
  });

  test("limits number of sessions returned", async () => {
    const { createSession, getRecentSessions } = await import("./store");

    for (let i = 0; i < 10; i++) {
      await createSession(new Date(Date.now() - i * 60000), "user");
    }

    const sessions = await getRecentSessions(3);
    expect(sessions).toHaveLength(3);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/sessions/store.test.ts`
Expected: FAIL with "getActiveSession not found"

**Step 3: Write implementation**

Add to `src/sessions/store.ts`:

```typescript
export async function getActiveSession(
  expiryHours: number
): Promise<LoadedSession | null> {
  const sessions = await getRecentSessions(1);

  if (sessions.length === 0) {
    return null;
  }

  const latest = sessions[0];
  const sessionAge = Date.now() - new Date(latest.meta.startedAt).getTime();
  const expiryMs = expiryHours * 60 * 60 * 1000;

  if (sessionAge > expiryMs) {
    return null;
  }

  return latest;
}

export async function getRecentSessions(limit: number): Promise<LoadedSession[]> {
  try {
    const files = await readdir(config.sessionsPath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort().reverse();

    const sessions: LoadedSession[] = [];

    for (const filename of jsonlFiles.slice(0, limit)) {
      const session = await loadSession(filename);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  } catch (err) {
    // Directory doesn't exist yet
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/sessions/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sessions/store.ts src/sessions/store.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): add getActiveSession and getRecentSessions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add sessionsPath to Config

**Files:**
- Modify: `src/config.ts`

**Step 1: Add sessionsPath configuration**

In `src/config.ts`, add after `chatsPath`:

```typescript
  sessionsPath: expandPath(getEnvOrDefault("SESSIONS_PATH", "./data/sessions")),
```

**Step 2: Run all session tests to verify config works**

Run: `bun test src/sessions/store.test.ts`
Expected: PASS (tests mock config, but this ensures real config compiles)

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "$(cat <<'EOF'
feat(config): add sessionsPath for chat session storage

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Session Store - Index Export

**Files:**
- Create: `src/sessions/index.ts`

**Step 1: Create index file**

```typescript
// src/sessions/index.ts
export {
  createSession,
  appendToSession,
  loadSession,
  getActiveSession,
  getRecentSessions,
  getSessionFileName,
  type SessionMeta,
  type LoadedSession,
} from "./store";
```

**Step 2: Verify import works**

Run: `bun -e "import { createSession } from './src/sessions'; console.log(typeof createSession)"`
Expected: "function"

**Step 3: Commit**

```bash
git add src/sessions/index.ts
git commit -m "$(cat <<'EOF'
feat(sessions): add index.ts barrel export

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Agent Loop - Accept Session History

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `src/agent/loop.test.ts`

**Step 1: Write failing test for session history parameter**

Add to `src/agent/loop.test.ts`:

```typescript
describe("runAgent with session history", () => {
  test("includes session history in conversation", async () => {
    const sessionHistory: GeminiMessage[] = [
      { role: "user", parts: [{ text: "Previous question" }] },
      { role: "model", parts: [{ text: "Previous answer" }] },
    ];

    await runAgent("New question", "System", sessionHistory);

    // First call should include session history
    const firstCall = mockChat.mock.calls[0];
    const [messages] = firstCall as [any[], any, string];

    expect(messages).toHaveLength(3); // 2 history + 1 new
    expect(messages[0].parts[0].text).toBe("Previous question");
    expect(messages[1].parts[0].text).toBe("Previous answer");
    expect(messages[2].parts[0].text).toBe("New question");
  });
});
```

Also add import at top:
```typescript
import type { GeminiMessage } from "./gemini";
```

**Step 2: Run test to verify it fails**

Run: `bun test src/agent/loop.test.ts`
Expected: FAIL (runAgent doesn't accept third parameter)

**Step 3: Modify implementation**

Update `src/agent/loop.ts`:

```typescript
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

  // ... rest unchanged
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/agent/loop.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/loop.ts src/agent/loop.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): accept sessionHistory parameter in runAgent

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Agent Loop - Return New Messages

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `src/agent/loop.test.ts`

**Step 1: Write failing test for returned messages**

Add to `src/agent/loop.test.ts`:

```typescript
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
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/agent/loop.test.ts`
Expected: FAIL (newMessages not in result)

**Step 3: Modify implementation**

Update `src/agent/loop.ts`:

1. Update AgentResponse interface:
```typescript
export interface AgentResponse {
  text: string;
  toolsUsed: string[];
  newMessages: GeminiMessage[];
}
```

2. Track new messages throughout the function. Replace the entire function:

```typescript
export async function runAgent(
  userMessage: string,
  systemPrompt: string,
  sessionHistory: GeminiMessage[] = []
): Promise<AgentResponse> {
  const tools = toolRegistry.getDefinitions();
  const newMessages: GeminiMessage[] = [
    { role: "user", parts: [{ text: userMessage }] },
  ];
  const messages: GeminiMessage[] = [...sessionHistory, ...newMessages];
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    console.log(`[AGENT] Round ${round + 1}/${MAX_TOOL_ROUNDS}`);
    const response = await chat(messages, tools, systemPrompt);

    // If no tool calls, we're done
    if (response.toolCalls.length === 0) {
      console.log("[AGENT] No tool calls, returning response");
      const finalMsg: GeminiMessage = {
        role: "model",
        parts: [{ text: response.text || "I couldn't generate a response." }],
      };
      newMessages.push(finalMsg);
      return {
        text: response.text || "I couldn't generate a response.",
        toolsUsed,
        newMessages,
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

    // Add model response to history
    const modelMsg: GeminiMessage = {
      role: "model",
      parts: response.toolCallParts,
    };
    messages.push(modelMsg);
    newMessages.push(modelMsg);

    // Add tool results to history
    const functionMsg: GeminiMessage = {
      role: "function",
      parts: results.map((r) =>
        createToolResultPart(r.name, r.error || r.result)
      ),
    };
    messages.push(functionMsg);
    newMessages.push(functionMsg);
  }

  // Exceeded max rounds, ask for final response without tools
  const finalResponse = await chat(messages, [], systemPrompt);
  const finalText = finalResponse.text || "I used several tools but couldn't formulate a final response.";
  const finalMsg: GeminiMessage = {
    role: "model",
    parts: [{ text: finalText }],
  };
  newMessages.push(finalMsg);

  return {
    text: finalText,
    toolsUsed,
    newMessages,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/agent/loop.test.ts`
Expected: PASS (some tests may need toolCallParts added to mock)

**Step 5: Fix any failing tests**

If existing tests fail due to missing `toolCallParts`, update the mock default:

```typescript
mockChat.mockImplementation(() =>
  Promise.resolve({
    text: "Final response",
    toolCalls: [],
    toolCallParts: [],
    finishReason: "STOP",
  })
);
```

**Step 6: Run all tests again**

Run: `bun test src/agent/loop.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/agent/loop.ts src/agent/loop.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): return newMessages from runAgent for session persistence

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Bot - Session Manager Class

**Files:**
- Create: `src/telegram/session-manager.ts`
- Create: `src/telegram/session-manager.test.ts`

**Step 1: Write failing test for SessionManager**

```typescript
// src/telegram/session-manager.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

testDir = await mkdtemp(join(tmpdir(), "session-mgr-test-"));

mock.module("../config", () => ({
  config: {
    sessionsPath: testDir,
    timezone: "UTC",
  },
}));

const { SessionManager } = await import("./session-manager");

afterEach(async () => {
  const files = await readdir(testDir);
  for (const f of files) {
    await rm(join(testDir, f), { force: true });
  }
});

process.on("beforeExit", async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("SessionManager", () => {
  test("getOrCreateSession creates new session when none exists", async () => {
    const manager = new SessionManager();
    const session = await manager.getOrCreateSession("user-123");

    expect(session.messages).toEqual([]);
    expect(session.meta.userId).toBe("user-123");
  });

  test("getOrCreateSession returns existing active session", async () => {
    const manager = new SessionManager();

    const session1 = await manager.getOrCreateSession("user-123");
    const session2 = await manager.getOrCreateSession("user-123");

    expect(session1.filename).toBe(session2.filename);
  });

  test("clear resets session", async () => {
    const manager = new SessionManager();

    await manager.getOrCreateSession("user-123");
    manager.clear();

    const session = await manager.getOrCreateSession("user-123");
    // Should be a new session (different timestamp)
    expect(session.messages).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/telegram/session-manager.test.ts`
Expected: FAIL with module not found

**Step 3: Write implementation**

```typescript
// src/telegram/session-manager.ts
import {
  createSession,
  appendToSession,
  getActiveSession,
  type LoadedSession,
} from "../sessions";
import type { GeminiMessage } from "../agent/gemini";

const SESSION_EXPIRY_HOURS = 4;

export class SessionManager {
  private currentSession: LoadedSession | null = null;

  async getOrCreateSession(userId: string): Promise<LoadedSession> {
    // Return cached session if available
    if (this.currentSession) {
      return this.currentSession;
    }

    // Try to load active session from disk
    const active = await getActiveSession(SESSION_EXPIRY_HOURS);
    if (active) {
      this.currentSession = active;
      return active;
    }

    // Create new session
    const startTime = new Date();
    const filename = await createSession(startTime, userId);
    this.currentSession = {
      meta: {
        _meta: true,
        startedAt: startTime.toISOString(),
        userId,
      },
      messages: [],
      filename,
    };

    return this.currentSession;
  }

  async appendMessages(messages: GeminiMessage[]): Promise<void> {
    if (!this.currentSession) {
      throw new Error("No active session");
    }

    for (const msg of messages) {
      await appendToSession(this.currentSession.filename, msg);
      this.currentSession.messages.push(msg);
    }
  }

  clear(): void {
    this.currentSession = null;
  }

  hasActiveSession(): boolean {
    return this.currentSession !== null;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/telegram/session-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/telegram/session-manager.ts src/telegram/session-manager.test.ts
git commit -m "$(cat <<'EOF'
feat(bot): add SessionManager for in-memory session state

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Bot - Integrate Session into Message Handler

**Files:**
- Modify: `src/telegram/bot.ts`

**Step 1: Import SessionManager and update handler**

At top of `src/telegram/bot.ts`, add import:
```typescript
import { SessionManager } from "./session-manager";
```

After `let bot: Bot | null = null;`, add:
```typescript
const sessionManager = new SessionManager();
```

**Step 2: Update message handler to use sessions**

In the `bot.on("message:text"` handler, replace the agent call section. Change:

```typescript
      // Run agent with overall timeout
      console.log("[LLM] Starting agent...");
      const response = await withTimeout(
        runAgent(userMessage, systemPrompt),
        config.overallTimeout,
        "Response took too long"
      );
```

To:

```typescript
      // Get or create session
      const session = await sessionManager.getOrCreateSession("kettl-user");
      console.log(`[SESSION] Using session ${session.filename} with ${session.messages.length} messages`);

      // Run agent with session history and overall timeout
      console.log("[LLM] Starting agent...");
      const response = await withTimeout(
        runAgent(userMessage, systemPrompt, session.messages),
        config.overallTimeout,
        "Response took too long"
      );

      // Persist new messages to session
      await sessionManager.appendMessages(response.newMessages);
```

**Step 3: Verify it compiles**

Run: `bun build src/telegram/bot.ts --outdir /tmp/check`
Expected: No errors

**Step 4: Commit**

```bash
git add src/telegram/bot.ts
git commit -m "$(cat <<'EOF'
feat(bot): integrate SessionManager into message handler

Messages now persist to session files and Gemini receives full
conversation history for context.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Bot - Add /clear Command

**Files:**
- Modify: `src/telegram/bot.ts`

**Step 1: Add /clear command handler**

After the `/start` command handler in `src/telegram/bot.ts`, add:

```typescript
  bot.command("clear", async (ctx) => {
    sessionManager.clear();
    await ctx.reply("Session cleared. Starting fresh!");
  });
```

**Step 2: Verify it compiles**

Run: `bun build src/telegram/bot.ts --outdir /tmp/check`
Expected: No errors

**Step 3: Commit**

```bash
git add src/telegram/bot.ts
git commit -m "$(cat <<'EOF'
feat(bot): add /clear command to reset session

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Bot - Add /continue Command

**Files:**
- Modify: `src/telegram/bot.ts`
- Modify: `src/telegram/session-manager.ts`

**Step 1: Add setSession method to SessionManager**

Add to `src/telegram/session-manager.ts`:

```typescript
  setSession(session: LoadedSession): void {
    this.currentSession = session;
  }
```

**Step 2: Add /continue command handler**

After the `/clear` command in `src/telegram/bot.ts`, add import:
```typescript
import { getRecentSessions } from "../sessions";
```

Then add the command:

```typescript
  bot.command("continue", async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    const sessions = await getRecentSessions(5);

    if (sessions.length === 0) {
      await ctx.reply("No previous sessions found.");
      return;
    }

    // If number provided, resume that session
    if (args[0]) {
      const index = parseInt(args[0], 10) - 1;
      if (isNaN(index) || index < 0 || index >= sessions.length) {
        await ctx.reply(`Invalid session number. Use 1-${sessions.length}`);
        return;
      }

      const session = sessions[index];
      sessionManager.setSession(session);
      await ctx.reply(`Resumed session from ${formatSessionTime(session.meta.startedAt)} (${session.messages.length} messages)`);
      return;
    }

    // List recent sessions
    const lines = sessions.map((s, i) => {
      const time = formatSessionTime(s.meta.startedAt);
      const lastMsg = getLastUserMessage(s.messages);
      const preview = lastMsg ? `"${lastMsg.slice(0, 30)}${lastMsg.length > 30 ? "..." : ""}"` : "(empty)";
      return `${i + 1}. ${time} - ${s.messages.length} msgs - ${preview}`;
    });

    await ctx.reply(
      "*Recent sessions:*\n\n" +
      lines.join("\n") +
      "\n\nUse `/continue N` to resume a session.",
      { parse_mode: "Markdown" }
    );
  });
```

**Step 3: Add helper functions**

Add before `export function createBot()`:

```typescript
function formatSessionTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-GB", {
    timeZone: config.timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getLastUserMessage(messages: GeminiMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      const textPart = msg.parts.find((p) => "text" in p);
      if (textPart && "text" in textPart) {
        return textPart.text;
      }
    }
  }
  return null;
}
```

Also add import:
```typescript
import type { GeminiMessage } from "../agent/gemini";
```

**Step 4: Verify it compiles**

Run: `bun build src/telegram/bot.ts --outdir /tmp/check`
Expected: No errors

**Step 5: Commit**

```bash
git add src/telegram/bot.ts src/telegram/session-manager.ts
git commit -m "$(cat <<'EOF'
feat(bot): add /continue command to resume previous sessions

Lists 5 most recent sessions with timestamps and preview.
Use /continue N to resume a specific session.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Prompt Changes - Conservative Tool Usage

**Files:**
- Modify: `src/prompts.ts`
- Modify: `src/prompts.test.ts`

**Step 1: Add tool usage guidelines to MAIN_PROMPT**

In `src/prompts.ts`, find the `Tool usage:` section in MAIN_PROMPT and replace it with:

```typescript
Tool usage:
- Always get_todays_summary for context on general check-ins
- Sync is automatic, but call sync_garmin if user just finished a workout
- Be conservative with tools for casual conversation
- Don't retry failed tools - explain what happened and continue
- Only use save_insight for genuinely useful information worth remembering

Memory (Mem0):
...
```

**Step 2: Write test for prompt content**

Add to `src/prompts.test.ts`:

```typescript
test("MAIN_PROMPT includes conservative tool guidance", () => {
  expect(MAIN_PROMPT).toContain("Be conservative with tools");
  expect(MAIN_PROMPT).toContain("Don't retry failed tools");
  expect(MAIN_PROMPT).toContain("Only use save_insight for genuinely useful");
});
```

**Step 3: Run test to verify it passes**

Run: `bun test src/prompts.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/prompts.ts src/prompts.test.ts
git commit -m "$(cat <<'EOF'
feat(prompts): add conservative tool usage guidelines

- Don't retry failed tools, explain and continue
- save_insight only for genuinely useful information
- Be conservative with tools during casual chat

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Integration Test - Full Session Flow

**Files:**
- Create: `src/sessions/integration.test.ts`

**Step 1: Write integration test**

```typescript
// src/sessions/integration.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "bun:test";

let testDir: string;

testDir = await mkdtemp(join(tmpdir(), "integration-test-"));

mock.module("../config", () => ({
  config: {
    sessionsPath: testDir,
    timezone: "UTC",
  },
}));

const {
  createSession,
  appendToSession,
  loadSession,
  getActiveSession,
  getSessionFileName,
} = await import("./store");

afterEach(async () => {
  const files = await readdir(testDir);
  for (const f of files) {
    await rm(join(testDir, f), { force: true });
  }
});

process.on("beforeExit", async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Session Integration", () => {
  test("full conversation flow persists and reloads", async () => {
    // 1. Create session
    const startTime = new Date();
    const filename = await createSession(startTime, "test-user");

    // 2. Simulate conversation
    await appendToSession(filename, {
      role: "user",
      parts: [{ text: "How did I sleep last night?" }],
    });
    await appendToSession(filename, {
      role: "model",
      parts: [{ text: "Let me check your sleep data..." }],
    });
    await appendToSession(filename, {
      role: "function",
      parts: [{
        functionResponse: {
          name: "get_todays_sleep_instant",
          response: { result: { duration: 7.5, score: 85 } },
        },
      }],
    });
    await appendToSession(filename, {
      role: "model",
      parts: [{ text: "You slept 7.5 hours with a score of 85!" }],
    });

    // 3. Reload session
    const loaded = await loadSession(filename);

    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(4);
    expect(loaded!.messages[0].role).toBe("user");
    expect(loaded!.messages[3].role).toBe("model");

    // 4. Verify getActiveSession finds it
    const active = await getActiveSession(4);
    expect(active).not.toBeNull();
    expect(active!.filename).toBe(filename);
  });
});
```

**Step 2: Run integration test**

Run: `bun test src/sessions/integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/sessions/integration.test.ts
git commit -m "$(cat <<'EOF'
test(sessions): add integration test for full conversation flow

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Run All Tests

**Step 1: Run complete test suite**

Run: `for f in src/**/*.test.ts; do echo "=== $f ===" && bun test "$f" || true; done`
Expected: All tests pass

**Step 2: If any tests fail, debug and fix**

Review failures and update as needed.

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: resolve test failures from session integration

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Manual Testing

**Step 1: Start the bot**

Run: `bun run src/index.ts`

**Step 2: Test conversation continuity**

1. Send a message: "Hi, how am I doing today?"
2. Wait for response
3. Send follow-up: "What about yesterday?"
4. Verify Gemini has context from first message

**Step 3: Test /clear**

1. Send: `/clear`
2. Verify response: "Session cleared. Starting fresh!"
3. Send: "What were we talking about?"
4. Verify Gemini has no previous context

**Step 4: Test /continue**

1. Send: `/continue`
2. Verify list of sessions appears
3. Send: `/continue 1`
4. Verify session is restored

**Step 5: Check session files**

Run: `ls -la data/sessions/`
Verify: JSONL files exist with correct naming

---

Plan complete and saved to `docs/plans/2026-02-03-chat-sessions-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?