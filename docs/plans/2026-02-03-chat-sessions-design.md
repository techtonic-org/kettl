# Chat Sessions Design

## Problem

Currently each message to the bot is stateless. The conversation history during tool rounds is kept, but between user messages there's no memory of what was just discussed. Additionally, Gemini sometimes retries failed tools and over-saves memories for casual chat.

## Goals

1. Continuous chat sessions with full context across messages
2. `/clear` command to start fresh
3. `/continue` command to resume previous sessions
4. More conservative tool usage (especially `save_insight`)

## Design

### Session Storage

**Location:** `chats/sessions/`

**Naming:** `YYYY-MM-DDTHH-mm-ss.jsonl` (session start time)

**Format:** Each line is a Gemini message object:
```json
{"_meta": true, "startedAt": "2024-02-03T14:30:45Z", "userId": "kettl-user"}
{"role": "user", "parts": [{"text": "How did I sleep?"}]}
{"role": "model", "parts": [{"text": "Let me check..."}, {"functionCall": {...}}]}
{"role": "function", "parts": [{"functionResponse": {...}}]}
{"role": "model", "parts": [{"text": "You slept 7.5 hours..."}]}
```

First line is metadata for display in `/continue`.

### Session Lifecycle

**Starting:** First message with no active session creates new file.

**During:** Each message/response appended to file and kept in memory.

**Auto-expiration:** If last message > 4 hours old, start new session automatically.

**`/clear`:** Reset in-memory session, next message starts fresh.

**Restart:** On bot startup, load latest session if < 4 hours old.

### Gemini Context

Full session history sent as conversation history:
```
[System prompt]
[All previous session messages...]
[New user message]
```

Changes to `loop.ts`: Accept `sessionHistory` parameter, return updated messages.

Changes to `bot.ts`: Load session, pass to agent, persist results.

### `/continue` Command

- `/continue` - list recent sessions (last 5)
- `/continue 1` - resume specific session

Shows preview: timestamp, message count, last message snippet.

### Prompt Changes

Add to system prompt:
- Be conservative with tool calls for casual chat
- Only `save_insight` for meaningful information
- Don't retry failed tools, explain and continue

## Files

**Change:**
- `src/prompts.ts` - tool usage guidelines
- `src/telegram/bot.ts` - session handling, commands
- `src/agent/loop.ts` - session history parameter

**Create:**
- `src/sessions/store.ts` - session CRUD operations

## Future

- Token limit handling (truncate/summarize old messages if needed)
- Daily summary integration (update path to `chats/sessions/`)
