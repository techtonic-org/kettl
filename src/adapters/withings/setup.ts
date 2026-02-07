import { setupAuth } from "./auth";
import { config } from "../../config";

// Validate required env vars
try {
  config.withingsClientId();
  config.withingsClientSecret();
} catch {
  console.error("Missing required environment variables:");
  console.error("  WITHINGS_CLIENT_ID");
  console.error("  WITHINGS_CLIENT_SECRET");
  console.error("\nGet these from https://developer.withings.com/dashboard/");
  process.exit(1);
}

console.log("[Withings Setup] Starting OAuth2 authorization flow...");

try {
  await setupAuth();
  console.log(`\n[Withings Setup] Success! Tokens saved to ${config.withingsTokensPath}`);
} catch (error) {
  console.error("[Withings Setup] Failed:", error);
  process.exit(1);
}
