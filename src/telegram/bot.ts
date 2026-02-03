import { Bot, type Context } from "grammy";
import { config } from "../config";
import { runAgent } from "../agent";
import { syncGarmin, getLastSyncTime, isBackgroundSyncRunning, getSyncProgress } from "../garmin";
import { isMemoryAvailable, getUserProfile } from "../memory";
import { MAIN_PROMPT, BOOTSTRAP_PROMPT } from "../prompts";
import { withTimeout, TimeoutError } from "../utils/timeout";

// Ensure tools are registered
import "../tools";

let bot: Bot | null = null;

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

export function createBot(): Bot {
  if (bot) return bot;

  bot = new Bot(config.telegramBotToken());

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hey! I'm Kettl, your health coach. I have access to your Garmin data and I'll remember our conversations.\n\n" +
        "Just message me about your workouts, sleep, goals, or anything health-related."
    );
  });

  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const warnings: string[] = [];
    const startTime = Date.now();

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
      // Sync latest Garmin activity (fast incremental sync)
      if (isBackgroundSyncRunning()) {
        console.log("[SYNC] Background sync in progress, skipping");
        const lastSync = getLastSyncTime();
        if (!lastSync) {
          warnings.push("Initial Garmin sync in progress, data may be incomplete");
        }
      } else {
        console.log("[SYNC] Syncing latest activity...");
        const syncResult = await syncGarmin().catch((e) => {
          console.warn("[SYNC] Failed:", e);
          return { success: false, error: String(e) };
        });

        if (syncResult.success) {
          console.log(`[SYNC] Completed in ${syncResult.durationMs}ms`);
        } else {
          const lastSync = getLastSyncTime();
          warnings.push(`Garmin sync failed, using data from ${formatTimeSince(lastSync)}`);
        }
      }

      // Check memory availability and get prompt
      console.log("[MEM] Checking memory service...");
      let systemPrompt = MAIN_PROMPT;
      const memoryAvailable = await isMemoryAvailable();

      if (!memoryAvailable) {
        console.log("[MEM] Memory unavailable");
        warnings.push("Memory unavailable, I may repeat myself");
      } else {
        console.log("[MEM] Memory available, fetching profile...");
        const profile = await getUserProfile();
        if (profile.length === 0) {
          console.log("[MEM] No profile found, using bootstrap prompt");
          systemPrompt = BOOTSTRAP_PROMPT;
        } else {
          console.log(`[MEM] Profile loaded (${profile.length} memories)`);
        }
      }

      // Run agent with overall timeout
      console.log("[LLM] Starting agent...");
      const response = await withTimeout(
        runAgent(userMessage, systemPrompt),
        config.overallTimeout,
        "Response took too long"
      );

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
