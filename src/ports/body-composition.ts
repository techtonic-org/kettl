export interface BodyCompositionMeasurement {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  weight: number; // kg
  fatPercent?: number; // %
  muscleMass?: number; // kg
  boneMass?: number; // kg
  waterPercent?: number; // %
  bmi?: number;
}

export interface BodyCompositionPort {
  getLatest(): Promise<BodyCompositionMeasurement | null>;
  getForDate(date: string): Promise<BodyCompositionMeasurement[]>;
  getTrend(days: number): Promise<BodyCompositionMeasurement[]>;
}
