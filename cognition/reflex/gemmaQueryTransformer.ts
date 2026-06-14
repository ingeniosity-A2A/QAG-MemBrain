export type RevikeTheme =
  | "Overcoming_Obstacles"
  | "Commanding_Reality"
  | "Prosperity_Consciousness"
  | "Self_Actualization"
  | "Refusing_Delay";

export interface GemmaTransformResult {
  query: string;
  themes: RevikeTheme[];
  keywords: string[];
}

const DEFAULT_THEMES: RevikeTheme[] = [
  "Overcoming_Obstacles",
  "Commanding_Reality",
  "Prosperity_Consciousness",
  "Self_Actualization",
  "Refusing_Delay",
];

export function buildGemmaTransformerPrompt(tacticalSituation: string): string {
  return [
    "You are the Query Transformer for Rev.IKE subconscious.",
    "Convert tactical emergency input into a philosophical search string.",
    `Tactical situation: ${tacticalSituation}`,
    "Output JSON: {\"query\":\"...\",\"themes\":[...]}.",
  ].join(" ");
}

export function transformTacticalToPhilosophical(
  tacticalSituation: string,
  availableThemes: RevikeTheme[] = DEFAULT_THEMES,
): GemmaTransformResult {
  const normalized = tacticalSituation.toLowerCase();
  const selectedThemes: RevikeTheme[] = [];

  if (containsAny(normalized, ["stall", "stalled", "delay", "late", "blocked"])) {
    selectedThemes.push("Refusing_Delay", "Overcoming_Obstacles");
  }

  if (containsAny(normalized, ["command", "authority", "execute", "direct"])) {
    selectedThemes.push("Commanding_Reality");
  }

  if (containsAny(normalized, ["customer", "confidence", "identity", "mindset"])) {
    selectedThemes.push("Self_Actualization");
  }

  if (containsAny(normalized, ["wealth", "prosper", "money", "value"])) {
    selectedThemes.push("Prosperity_Consciousness");
  }

  const deduped = [...new Set(selectedThemes)].filter((theme) => availableThemes.includes(theme));
  const themes = deduped.length > 0 ? deduped.slice(0, 2) : [availableThemes[0], availableThemes[1]].filter(Boolean);

  const keywords = tacticalSituation
    .split(/[^a-zA-Z0-9_]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4)
    .slice(0, 8);

  return {
    query: `Reframe tactical pressure into command authority and decisive movement: ${tacticalSituation}`,
    themes,
    keywords,
  };
}

function containsAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}
