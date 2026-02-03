import { Bot } from "grammy";
import { config } from "../config";
import { runAgent } from "../agent";
import { syncGarmin } from "../garmin";
import { isMemoryAvailable, getUserProfile } from "../memory";
import { MAIN_PROMPT, BOOTSTRAP_PROMPT } from "../prompts";

// Ensure tools are registered
import "../tools";

let bot: Bot | null = null;

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

    try {
      // Send typing indicator
      await ctx.replyWithChatAction("typing");

      // Sync Garmin data (don't block on failure)
      const syncPromise = syncGarmin().catch((e) => {
        console.warn("Garmin sync failed:", e);
        return { success: false };
      });

      // Check if user has profile (determines bootstrap vs main prompt)
      let systemPrompt = MAIN_PROMPT;
      const memoryAvailable = await isMemoryAvailable();

      if (memoryAvailable) {
        const profile = await getUserProfile();
        if (profile.length === 0) {
          systemPrompt = BOOTSTRAP_PROMPT;
        }
      }

      // Wait for sync to complete (with timeout already built in)
      await syncPromise;

      // Run agent
      const response = await runAgent(userMessage, systemPrompt);

      // Send response
      await ctx.reply(response.text, { parse_mode: "Markdown" });

      // Log tools used (for debugging)
      if (response.toolsUsed.length > 0) {
        console.log(`Tools used: ${response.toolsUsed.join(", ")}`);
      }
    } catch (error) {
      console.error("Error handling message:", error);
      await ctx.reply(
        "Sorry, I ran into an issue. Try again in a moment?"
      );
    }
  });

  return bot;
}

export async function startBot(): Promise<void> {
  const b = createBot();
  console.log("Starting Telegram bot...");
  await b.start();
}
