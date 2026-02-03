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

  async clear(userId: string): Promise<void> {
    // Create a new empty session (so getActiveSession won't load the old one)
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
  }

  setSession(session: LoadedSession): void {
    this.currentSession = session;
  }

  hasActiveSession(): boolean {
    return this.currentSession !== null;
  }
}
