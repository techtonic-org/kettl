import { runAgent } from "./agent";
import { MAIN_PROMPT } from "./prompts";
import { createInterface } from "readline";

// Ensure tools are registered
import "./tools";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("Kettl CLI Test Harness");
console.log("Type your message and press Enter. Type 'exit' to quit.\n");

function prompt(): void {
  rl.question("You: ", async (input) => {
    const trimmed = input.trim();
    if (trimmed.toLowerCase() === "exit") {
      console.log("Goodbye!");
      rl.close();
      return;
    }

    if (!trimmed) {
      prompt();
      return;
    }

    try {
      console.log("\n[Processing...]");
      const response = await runAgent(trimmed, MAIN_PROMPT);
      console.log(`\nKettl: ${response.text}`);
      if (response.toolsUsed.length > 0) {
        console.log(`[Tools used: ${response.toolsUsed.join(", ")}]`);
      }
      console.log();
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : error
      );
      console.log();
    }

    prompt();
  });
}

prompt();
