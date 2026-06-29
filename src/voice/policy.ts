/**
 * Voice Personality — utterance contract and tone policy for Ava.
 *
 * Rules:
 *  - Neutral cadence (rate 1.0) for expected events.
 *  - Slightly slower + apologetic tone for large delays (delta >= 15 min).
 *  - Slightly faster rate on "arriving" to match urgency.
 *  - No ML required; tone escalation is purely rule-based.
 */

export type VoiceEvent =
  | { type: "scheduled"; eta: number }
  | { type: "enroute"; eta: number }
  | { type: "delayed"; eta: number; delta: number }
  | { type: "arriving"; eta: number }
  | { type: "completed" };

export type Utterance = {
  text: string;
  rate: number;
  pitch: number;
  volume: number;
};

const BASE: Omit<Utterance, "text"> = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
};

export function buildUtterance(e: VoiceEvent): Utterance {
  switch (e.type) {
    case "scheduled":
      return {
        ...BASE,
        text: `You're scheduled. Estimated arrival in ${e.eta} minutes.`,
      };

    case "enroute":
      return {
        ...BASE,
        text: `Your technician is on the way. ETA ${e.eta} minutes.`,
      };

    case "delayed": {
      const apology = e.delta >= 15;
      return {
        ...BASE,
        rate: apology ? 0.95 : 1.0,
        text: apology
          ? `We're running late by about ${e.delta} minutes. I'm sorry for the delay.`
          : `Slight delay—about ${e.delta} minutes behind schedule.`,
      };
    }

    case "arriving":
      return {
        ...BASE,
        rate: 1.05,
        text: `Your technician is arriving now.`,
      };

    case "completed":
      return {
        ...BASE,
        text: `Service complete. Thank you for choosing us today.`,
      };
  }
}
