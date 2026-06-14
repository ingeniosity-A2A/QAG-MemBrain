/**
 * GRPO Training Harness
 * Records episodes, computes advantages, exports JSONL for fine-tuning.
 */
import * as fs from 'fs';
import * as path from 'path';

// ─── Inline types ────────────────────────────────────────────────────

type Importance = 'low' | 'medium' | 'high' | 'critical';

interface AVA007Decision {
  action: string;
  params: Record<string, unknown>;
  escalate: boolean;
  confidence: number;
  reason: string;
}

interface AtomicMemory {
  id: string;
  type: string;
  source: string;
  timestamp: number;
  title: string;
  content: string;
  tags: string[];
  embedding: number[] | null;
  metadata: { confidence: number; importance: Importance; [key: string]: unknown };
}

async function appendAtom(atom: AtomicMemory, filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    stream.write(JSON.stringify(atom) + '\n', (err) => {
      stream.close();
      err ? reject(err) : resolve();
    });
  });
}

// ─── GRPO types ──────────────────────────────────────────────────────

export interface GRPOEpisode {
  id: string;
  queryGroup: string;
  actions: AVA007Decision[];
  rewards: number[];
  totalReward: number;
  timestamp: string;
}

export interface GRPOBatch {
  queryGroup: string;
  episodes: GRPOEpisode[];
  meanReward: number;
  stdReward: number;
  advantages: number[];
}

export class GRPOHarness {
  private episodes: Map<string, GRPOEpisode[]> = new Map();

  async recordEpisode(
    queryGroup: string,
    actions: AVA007Decision[],
    rewards: number[],
    totalReward: number,
  ): Promise<void> {
    const episode: GRPOEpisode = {
      id: `grpo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      queryGroup,
      actions,
      rewards,
      totalReward,
      timestamp: new Date().toISOString(),
    };
    if (!this.episodes.has(queryGroup)) this.episodes.set(queryGroup, []);
    this.episodes.get(queryGroup)!.push(episode);

    await appendAtom(
      {
        id: episode.id,
        type: 'memory',
        source: 'system',
        timestamp: Date.now(),
        title: `GRPO episode: ${queryGroup}`,
        content: JSON.stringify({
          actions: actions.map((a) => a.action),
          rewards,
          totalReward,
        }),
        tags: ['grpo', 'training'],
        embedding: null,
        metadata: {
          confidence: totalReward,
          importance: totalReward > 0.7 ? 'high' : 'medium',
        },
      },
      './data/grpo_episodes.jsonl',
    );
  }

  static computeReward(
    exactMatch: boolean,
    memoryEfficiency: number,
    contextPrecision: number,
    llmJudgeScore: number,
  ): number {
    return (
      (exactMatch ? 1 : 0) * 0.4 +
      memoryEfficiency * 0.2 +
      contextPrecision * 0.2 +
      llmJudgeScore * 0.2
    );
  }

  computeAdvantages(queryGroup: string): GRPOBatch | null {
    const episodes = this.episodes.get(queryGroup);
    if (!episodes || episodes.length === 0) return null;

    const totalRewards = episodes.map((e) => e.totalReward);
    const mean = totalRewards.reduce((a, b) => a + b, 0) / totalRewards.length;
    const variance =
      totalRewards.reduce((acc, r) => acc + (r - mean) ** 2, 0) / totalRewards.length;
    const std = Math.sqrt(variance + 1e-8);
    const advantages = totalRewards.map((r) => (r - mean) / std);

    return { queryGroup, episodes: episodes.slice(), meanReward: mean, stdReward: std, advantages };
  }

  async exportGRPOBatch(
    queryGroup: string,
    filePath: string = './data/grpo_batch.jsonl',
  ): Promise<void> {
    const batch = this.computeAdvantages(queryGroup);
    if (!batch) return;

    for (let i = 0; i < batch.episodes.length; i++) {
      const ep = batch.episodes[i];
      const advantage = batch.advantages[i];
      await appendAtom(
        {
          id: `export_${ep.id}`,
          type: 'memory',
          source: 'system',
          timestamp: Date.now(),
          title: `GRPO export: ${queryGroup}`,
          content: JSON.stringify({
            episode_id: ep.id,
            query_group: queryGroup,
            actions: ep.actions,
            rewards: ep.rewards,
            total_reward: ep.totalReward,
            advantage,
            timestamp: ep.timestamp,
          }),
          tags: ['grpo', 'export'],
          embedding: null,
          metadata: { confidence: advantage, importance: 'medium' },
        },
        filePath,
      );
    }
  }

  clearEpisodes(queryGroup: string): void {
    this.episodes.delete(queryGroup);
  }
}
