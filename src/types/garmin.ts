export interface DailySummary {
  date: string;
  steps: number | null;
  floors: number | null;
  hr_min: number | null;
  hr_max: number | null;
  rhr: number | null;
  stress_avg: number | null;
  bb_max: number | null;  // body battery
  bb_min: number | null;
  sleep_score: number | null;
}

export interface Activity {
  activity_id: string;
  name: string;
  type: string;
  start_time: string;
  elapsed_time: number;  // seconds
  distance: number | null;  // meters
  avg_hr: number | null;
  max_hr: number | null;
  avg_speed: number | null;  // m/s
  calories: number | null;
}

export interface SleepSession {
  date: string;
  start_time: string;
  end_time: string;
  total_sleep: number;  // seconds
  deep_sleep: number | null;
  light_sleep: number | null;
  rem_sleep: number | null;
  awake: number | null;
  score: number | null;
}

export interface WeightEntry {
  date: string;
  weight: number;  // kg
}

export interface BodyBatteryEntry {
  date: string;
  bb_max: number;
  bb_min: number;
}
