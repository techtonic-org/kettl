import type { BodyCompositionMeasurement } from "../../ports/body-composition";
import { getAccessToken } from "./auth";

// Withings meastype IDs
const MEASTYPE_WEIGHT = 1;
const MEASTYPE_FAT_PERCENT = 6;
const MEASTYPE_MUSCLE_MASS = 76;
const MEASTYPE_BONE_MASS = 88;
const MEASTYPE_WATER_MASS = 77; // kg, needs conversion to %
const MEASTYPE_BMI = 91;

const ALL_MEASTYPES = [
  MEASTYPE_WEIGHT,
  MEASTYPE_FAT_PERCENT,
  MEASTYPE_MUSCLE_MASS,
  MEASTYPE_BONE_MASS,
  MEASTYPE_WATER_MASS,
  MEASTYPE_BMI,
].join(",");

interface WithingsMeasure {
  value: number;
  type: number;
  unit: number;
}

interface WithingsMeasureGroup {
  grpid: number;
  date: number; // unix timestamp
  measures: WithingsMeasure[];
  category: number;
}

interface WithingsResponse {
  status: number;
  body: {
    measuregrps: WithingsMeasureGroup[];
  };
}

function realValue(measure: WithingsMeasure): number {
  return measure.value * Math.pow(10, measure.unit);
}

function parseMeasureGroup(
  grp: WithingsMeasureGroup
): BodyCompositionMeasurement | null {
  const weightMeasure = grp.measures.find((m) => m.type === MEASTYPE_WEIGHT);
  if (!weightMeasure) return null;

  const weight = realValue(weightMeasure);
  const dt = new Date(grp.date * 1000);

  const result: BodyCompositionMeasurement = {
    date: dt.toISOString().split("T")[0]!,
    time: dt.toTimeString().slice(0, 5),
    weight: Math.round(weight * 100) / 100,
  };

  for (const m of grp.measures) {
    const val = realValue(m);
    switch (m.type) {
      case MEASTYPE_FAT_PERCENT:
        result.fatPercent = Math.round(val * 100) / 100;
        break;
      case MEASTYPE_MUSCLE_MASS:
        result.muscleMass = Math.round(val * 100) / 100;
        break;
      case MEASTYPE_BONE_MASS:
        result.boneMass = Math.round(val * 100) / 100;
        break;
      case MEASTYPE_WATER_MASS:
        // Convert kg to % using weight
        result.waterPercent =
          Math.round((val / weight) * 100 * 100) / 100;
        break;
      case MEASTYPE_BMI:
        result.bmi = Math.round(val * 100) / 100;
        break;
    }
  }

  return result;
}

export async function getMeasurements(
  startDate: Date,
  endDate: Date
): Promise<BodyCompositionMeasurement[]> {
  const accessToken = await getAccessToken();

  const response = await fetch("https://wbsapi.withings.net/measure", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      action: "getmeas",
      meastypes: ALL_MEASTYPES,
      category: "1", // real measurements only
      startdate: Math.floor(startDate.getTime() / 1000).toString(),
      enddate: Math.floor(endDate.getTime() / 1000).toString(),
    }),
  });

  const data = (await response.json()) as WithingsResponse;

  if (data.status !== 0) {
    throw new Error(`Withings API error (status ${data.status}): ${JSON.stringify(data)}`);
  }

  const measurements = data.body.measuregrps
    .filter((grp) => grp.category === 1) // real measurements only
    .map(parseMeasureGroup)
    .filter((m): m is BodyCompositionMeasurement => m !== null);

  // Sort by date desc (most recent first)
  measurements.sort(
    (a, b) =>
      new Date(`${b.date}T${b.time}`).getTime() -
      new Date(`${a.date}T${a.time}`).getTime()
  );

  return measurements;
}
