import { startBot } from "./telegram";

// Ensure all tools are registered
import "./tools";

console.log("Kettl starting...");

startBot()
  .then(() => console.log("Bot started successfully"))
  .catch((error) => {
    console.error("Failed to start bot:", error);
    process.exit(1);
  });
