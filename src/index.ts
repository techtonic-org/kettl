import { config } from "./config";
import { getTodaysSummary, getRecentActivities } from "./garmin";

console.log("Kettl starting...");
console.log(`GarminDB path: ${config.garminDbPath}`);

// Test queries
const summary = getTodaysSummary();
console.log("\nToday's summary:", summary);

const activities = getRecentActivities(7);
console.log(`\nRecent activities (${activities.length}):`);
activities.forEach((a) => {
  console.log(`  - ${a.name} (${a.type}): ${a.distance ? (a.distance / 1000).toFixed(2) + "km" : "no distance"}`);
});
