import type {
  BodyCompositionPort,
  BodyCompositionMeasurement,
} from "../../ports/body-composition";
import { getMeasurements } from "./client";

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfDay(dateStr: string): Date {
  const d = new Date(dateStr + "T00:00:00");
  return d;
}

function endOfDay(dateStr: string): Date {
  const d = new Date(dateStr + "T23:59:59");
  return d;
}

export const withingsAdapter: BodyCompositionPort = {
  async getLatest(): Promise<BodyCompositionMeasurement | null> {
    const measurements = await getMeasurements(daysAgo(30), new Date());
    return measurements[0] ?? null;
  },

  async getForDate(date: string): Promise<BodyCompositionMeasurement[]> {
    return getMeasurements(startOfDay(date), endOfDay(date));
  },

  async getTrend(days: number): Promise<BodyCompositionMeasurement[]> {
    return getMeasurements(daysAgo(days), new Date());
  },
};
