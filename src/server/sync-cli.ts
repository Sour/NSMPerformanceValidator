import { config, localToday } from "./config";
import { openDb } from "./db";
import { createIntervalsClient } from "./intervals";
import { sync } from "./sync";

const result = await sync(
  openDb(config.databasePath),
  createIntervalsClient(config.athleteId, config.apiKey),
  localToday(),
);
if (result.nsmStart === null) {
  console.log("No Planned Workout tagged [NSM] found; nothing stored.");
} else {
  console.log(
    `Synced since ${result.nsmStart}: ${result.plannedWorkouts} Planned Workouts, ${result.activities} running Activities.`,
  );
}
