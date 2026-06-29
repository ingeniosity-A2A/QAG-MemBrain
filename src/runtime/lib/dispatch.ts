/**
 * Auto-Dispatch AI: Deterministic scoring + adaptive ranking
 * Inputs: Job location/type, Tech availability/skill, System load
 * Output: Ranked list of best-fit technicians (no opaque decisions)
 */

type Tech = {
  id: string;
  lat: number;
  lng: number;
  status: string;
  skill?: string;
};

type Job = {
  lat: number;
  lng: number;
  type?: string;
};

type RankedTech = {
  t: Tech;
  s: number; // score
};

/**
 * Weights for scoring function
 * Higher distance weight = proximity priority
 * availability = must be "available" status
 * skill = bonus if tech skill matches job type
 */
const W = {
  distance: 0.55, // 55% proximity
  availability: 0.25, // 25% availability
  skill: 0.20, // 20% skill match
};

/**
 * Calculate Euclidean distance between two points (km approximate)
 * Lat/Lng treated as scaled coordinates (1 degree ≈ 111 km)
 */
function dist(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Score a single technician against a job
 * Returns 0-1 normalized score
 */
function score(job: Job, tech: Tech): number {
  // Distance component: 1/(1+dist) = nearer techs get higher score
  const d = 1 / (1 + dist(job, tech));

  // Availability component: 1 if available, 0 otherwise
  const a = tech.status === 'available' ? 1 : 0;

  // Skill component: 1 if skill matches job type, 0.5 as default
  const s = job.type && tech.skill === job.type ? 1 : 0.5;

  return d * W.distance + a * W.availability + s * W.skill;
}

/**
 * Rank all available technicians for a job
 * Returns sorted array [best, second-best, third-best, ...]
 */
export function rank(job: Job, techs: Tech[]): RankedTech[] {
  return techs
    .filter((t) => t.status === 'available')
    .map((t) => ({ t, s: score(job, t) }))
    .sort((x, y) => y.s - x.s);
}

/**
 * Get best-fit technician for immediate assignment
 * Returns the single highest-scoring tech or null
 */
export function selectBest(job: Job, techs: Tech[]): Tech | null {
  const ranked = rank(job, techs);
  return ranked.length > 0 ? ranked[0].t : null;
}

/**
 * Get top N candidates (for manual override/backup)
 */
export function selectTop(job: Job, techs: Tech[], n: number = 3): Tech[] {
  const ranked = rank(job, techs);
  return ranked.slice(0, n).map((r) => r.t);
}

/**
 * Explain the score for a single technician
 * Returns breakdown of distance/availability/skill contributions
 */
export function explainScore(job: Job, tech: Tech): {
  distance: number;
  availability: number;
  skill: number;
  total: number;
} {
  const d = 1 / (1 + dist(job, tech));
  const a = tech.status === 'available' ? 1 : 0;
  const s = job.type && tech.skill === job.type ? 1 : 0.5;

  return {
    distance: d * W.distance,
    availability: a * W.availability,
    skill: s * W.skill,
    total: d * W.distance + a * W.availability + s * W.skill,
  };
}
