import { Bot } from "grammy";
import { config } from "../config";
import { runAgent } from "../agent";
import { syncGarmin, getLastSyncTime, isBackgroundSyncRunning } from "../garmin";
import { isMemoryAvailable, getUserProfile } from "../memory";
import { MAIN_PROMPT, BOOTSTRAP_PROMPT } from "../prompts";
import { withTimeout, TimeoutError } from "../utils/timeout";

// Ensure tools are registered
import "../tools";

let bot: Bot | null = null;

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

    try {
      // Send typing indicator
      await ctx.replyWithChatAction("typing");

      // Sync Garmin data (skip if background sync is running)
      if (isBackgroundSyncRunning()) {
        const lastSync = getLastSyncTime();
        if (!lastSync) {
          warnings.push("Initial Garmin sync in progress, data may be incomplete");
        } else {
          warnings.push(`Garmin sync in progress, using data from ${formatTimeSince(lastSync)}`);
        }
      } else {
        const syncResult = await syncGarmin().catch((e) => {
          console.warn("Garmin sync failed:", e);
          return { success: false, error: String(e) };
        });

        if (!syncResult.success) {
          const lastSync = getLastSyncTime();
          warnings.push(`Garmin sync failed, using data from ${formatTimeSince(lastSync)}`);
        }
      }

      // Check memory availability and get prompt
      let systemPrompt = MAIN_PROMPT;
      const memoryAvailable = await isMemoryAvailable();

      if (!memoryAvailable) {
        warnings.push("Memory unavailable, I may repeat myself");
      } else {
        const profile = await getUserProfile();
        if (profile.length === 0) {
          systemPrompt = BOOTSTRAP_PROMPT;
        }
      }

      // Run agent with overall timeout
      const response = await withTimeout(
        runAgent(userMessage, systemPrompt),
        config.overallTimeout,
        "Response took too long"
      );

      // Build response text
      let replyText = response.text;
      if (warnings.length > 0) {
        replyText += `\n\n_${warnings.join(". ")}_`;
      }

      // Send response
      await ctx.reply(replyText, { parse_mode: "Markdown" });

      // Log tools used
      if (response.toolsUsed.length > 0) {
        console.log(`Tools used: ${response.toolsUsed.join(", ")}`);
      }
    } catch (error) {
      console.error("Error handling message:", error);

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
