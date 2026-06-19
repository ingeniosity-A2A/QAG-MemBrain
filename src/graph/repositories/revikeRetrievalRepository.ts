import neo4j, { Driver } from "neo4j-driver";
import { RevikeTheme } from "../../../cognition/reflex/gemmaQueryTransformer.js";

export interface RevikeMemoryChunk {
  id: string;
  content: string;
  timestamp: number;
  theme: string;
  metadata: Record<string, unknown>;
}

export interface RevikeRetrievalQuery {
  query: string;
  themes: RevikeTheme[];
  keywords: string[];
  location?: string;
  limit?: number;
}

export interface RevikeRetrievalRepository {
  retrieveRelevantMemories(input: RevikeRetrievalQuery): Promise<RevikeMemoryChunk[]>;
}

export class InMemoryRevikeRetrievalRepository implements RevikeRetrievalRepository {
  constructor(private readonly memories: RevikeMemoryChunk[]) {}

  async retrieveRelevantMemories(input: RevikeRetrievalQuery): Promise<RevikeMemoryChunk[]> {
    const limit = input.limit ?? 4;
    const loweredKeywords = input.keywords.map((keyword) => keyword.toLowerCase());
    const loweredLocation = input.location?.toLowerCase();

    return this.memories
      .filter((memory) => input.themes.includes(memory.theme as RevikeTheme))
      .filter((memory) => {
        const content = memory.content.toLowerCase();
        const keywordMatch = loweredKeywords.length === 0 || loweredKeywords.some((keyword) => content.includes(keyword));
        const spatialTag = String(memory.metadata.spatial_tag ?? "").toLowerCase();
        const locationMatch = !loweredLocation || spatialTag.includes(loweredLocation);
        return keywordMatch && locationMatch;
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
}

export class Neo4jRevikeRetrievalRepository implements RevikeRetrievalRepository {
  private readonly driver: Driver;

  constructor(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  static fromEnv(): Neo4jRevikeRetrievalRepository {
    const uri = process.env.NEO4J_URI ?? "bolt://127.0.0.1:7687";
    const user = process.env.NEO4J_USER ?? "neo4j";
    const password = process.env.NEO4J_PASSWORD ?? "password";
    return new Neo4jRevikeRetrievalRepository(uri, user, password);
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  async retrieveRelevantMemories(input: RevikeRetrievalQuery): Promise<RevikeMemoryChunk[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory)-[:HAS_THEME]->(t:Theme)
        WHERE t.name IN $themes
          AND (
            size($keywords) = 0 OR
            any(keyword IN $keywords WHERE toLower(m.content) CONTAINS keyword)
          )
          AND (
            $location IS NULL OR
            toLower(coalesce(m.spatial_tag, '')) CONTAINS toLower($location) OR
            toLower(coalesce(m.location, '')) CONTAINS toLower($location)
          )
        RETURN m.id AS id,
               m.content AS content,
               toInteger(m.timestamp) AS timestamp,
               t.name AS theme,
               properties(m) AS metadata
        ORDER BY m.timestamp DESC
        LIMIT $limit
        `,
        {
          themes: input.themes,
          keywords: input.keywords.map((keyword) => keyword.toLowerCase()),
          location: input.location ?? null,
          limit: neo4j.int(input.limit ?? 4),
        },
      );

      return result.records.map((record) => ({
        id: String(record.get("id")),
        content: String(record.get("content")),
        timestamp: Number(record.get("timestamp")),
        theme: String(record.get("theme")),
        metadata: (record.get("metadata") as Record<string, unknown>) ?? {},
      }));
    } finally {
      await session.close();
    }
  }
}

export const DEFAULT_REVIKE_MEMORIES: RevikeMemoryChunk[] = [
  {
    id: "revike_001",
    content: "Delay is a mental agreement. Command the moment and movement follows.",
    timestamp: 1717200000000,
    theme: "Refusing_Delay",
    metadata: {
      spatial_tag: "atlanta",
      source: "youtube",
    },
  },
  {
    id: "revike_002",
    content: "Obstacles collapse under sustained identity and declared authority.",
    timestamp: 1717200300000,
    theme: "Overcoming_Obstacles",
    metadata: {
      spatial_tag: "buckhead",
      source: "youtube",
    },
  },
  {
    id: "revike_003",
    content: "Prosperity responds to clarity, not apology.",
    timestamp: 1717200600000,
    theme: "Prosperity_Consciousness",
    metadata: {
      spatial_tag: "atlanta",
      source: "youtube",
    },
  },
];
