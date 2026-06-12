export interface CognitionResult {
  insight: string;
  confidence: number;
}

export function synthesizeCognition(input: string): CognitionResult {
  return { insight: input.trim(), confidence: input.length > 0 ? 0.7 : 0 };
}
