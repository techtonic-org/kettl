import { Bot, type Context } from "grammy";
import { config } from "../config";
import { runAgent } from "../agent";
import { getLastSyncTime, getSyncProgress } from "../garmin";
import { isMemoryAvailable, getUserProfile } from "../memory";
import { buildMainPrompt, BOOTSTRAP_PROMPT } from "../prompts";
import type { PromptContext } from "../prompts";
import { withTimeout, TimeoutError } from "../utils/timeout";
import { appendChat } from "../chats/store";
import { SessionManager } from "./session-manager";

// Ensure tools are registered
import "../tools";

let bot: Bot | null = null;
const sessionManager = new SessionManager();

// Keep typing indicator alive during long operations
function startTypingIndicator(ctx: Context): () => void {
  const interval = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);

  // Send immediately
  ctx.replyWithChatAction("typing").catch(() => {});

  return () => clearInterval(interval);
}

function formatTimeSince(date: Date | null): string {
  if (!date) return "unknown";
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  return `${hours} hours ago`;
}

function getMessageTimeLocal(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function createBot(): Bot {
  if (bot) return bot;

  bot = new Bot(config.telegramBotToken());

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hey! I'm Kettl, your health coach. I have access to your Garmin data and I'll remember our conversations.\n\n" +
        "Just message me about your workouts, sleep, goals, or anything health-related."
    );
  });

  bot.command("clear", async (ctx) => {
    sessionManager.clear();
    await ctx.reply("Session cleared. Starting fresh!");
  });

  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const warnings: string[] = [];
    const startTime = Date.now();
    const messageTime = new Date();

    console.log(`[MSG] Received: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? "..." : ""}"`);

    // Check if initial sync is running - respond immediately with status
    const syncStatus = getSyncProgress();
    if (syncStatus.running && !getLastSyncTime()) {
      console.log("[SYNC] Initial sync in progress, responding with status");

      let statusLines = [`*Phase:* ${syncStatus.phase}`];

      if (syncStatus.percent) {
        statusLines.push(`*Progress:* ${syncStatus.percent}`);

        // Extract ETA from percent string (format: "5% (200/4052) - 02:30<45:00")
        const etaMatch = syncStatus.percent.match(/<([^,\]]+)/);
        if (etaMatch) {
          statusLines.push(`*ETA:* ${etaMatch[1]}`);
        }
      }

      await ctx.reply(
        `🔄 *Initial Garmin sync in progress*\n\n` +
        `${statusLines.join("\n")}\n\n` +
        `I'll be ready to help once this completes. This only happens on first startup.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Start typing indicator (keeps refreshing every 4s)
    const stopTyping = startTypingIndicator(ctx);

    try {
      // Check data freshness - scheduler handles sync, just warn if stale
      const lastSync = getLastSyncTime();

      if (!lastSync) {
        warnings.push("SQLite data not yet synced, using instant API");
      } else {
        const syncAgeHours = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
        if (syncAgeHours > 4) {
          warnings.push(`Data is ${Math.floor(syncAgeHours)}h old, using instant API for recent data`);
        }
      }

      // Check memory availability and get prompt
      console.log("[MEM] Checking memory service...");
      let systemPrompt: string;
      const memoryAvailable = await isMemoryAvailable();

      if (!memoryAvailable) {
        console.log("[MEM] Memory unavailable");
        warnings.push("Memory unavailable, I may repeat myself");
        // Use dynamic prompt with context even without memory
        const context: PromptContext = {
          lastSyncTime: lastSync ?? new Date(0),
          lastSyncAgo: lastSync ? formatTimeSince(lastSync) : "never",
          messageTime,
          messageTimeLocal: getMessageTimeLocal(messageTime),
        };
        systemPrompt = buildMainPrompt(context);
      } else {
        console.log("[MEM] Memory available, fetching profile...");
        const profile = await getUserProfile();
        if (profile.length === 0) {
          console.log("[MEM] No profile found, using bootstrap prompt");
          systemPrompt = BOOTSTRAP_PROMPT;
        } else {
          console.log(`[MEM] Profile loaded (${profile.length} memories)`);
          // Build dynamic prompt with sync time context
          const context: PromptContext = {
            lastSyncTime: lastSync ?? new Date(0),
            lastSyncAgo: lastSync ? formatTimeSince(lastSync) : "never",
            messageTime,
            messageTimeLocal: getMessageTimeLocal(messageTime),
          };
          systemPrompt = buildMainPrompt(context);
        }
      }

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

      const duration = Date.now() - startTime;
      console.log(`[LLM] Completed in ${duration}ms, tools: ${response.toolsUsed.join(", ") || "none"}`);

      // Build response text
      let replyText = response.text;
      if (warnings.length > 0) {
        replyText += `\n\n_${warnings.join(". ")}_`;
      }

      // Stop typing and send response
      stopTyping();
      await ctx.reply(replyText, { parse_mode: "Markdown" });

      console.log(`[MSG] Response sent (${duration}ms total)`);

      // Persist chat for daily summaries
      try {
        await appendChat(userMessage, response.text, messageTime);
      } catch (chatError) {
        console.error("[Chat] Failed to persist:", chatError);
      }
    } catch (error) {
      stopTyping();
      console.error("[ERR] Error handling message:", error);

      if (error instanceof TimeoutError) {
        await ctx.reply(
          "That took too long, sorry! Try again with a simpler question?"
        );
      } else {
        await ctx.reply(
          "Sorry, I ran into an issue. Try again in a moment?"
        );
      }
    }
  });

  return bot;
}

export async function startBot(): Promise<void> {
  const b = createBot();
  console.log("Starting Telegram bot...");
  await b.start();
}
