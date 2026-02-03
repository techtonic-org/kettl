import { startBot } from "./telegram";
import { syncGarminBackground } from "./garmin";

// Ensure all tools are registered
import "./tools";

console.log("Kettl starting...");

// Kick off initial Garmin sync in background (don't wait)
console.log("Starting initial Garmin sync in background...");
syncGarminBackground().catch((e) => console.warn("Background sync failed:", e));

startBot()
  .then(() => console.log("Bot started successfully"))
  .catch((error) => {
    console.error("Failed to start bot:", error);
    process.exit(1);
  });
