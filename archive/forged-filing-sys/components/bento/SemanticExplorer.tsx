// components/bento/SemanticExplorer.tsx
// BENTO-007-UI: Glassmorphic semantic explorer with turbovec
// Palette lock (docs/FORGED_FILE_STANDARD.md §1): three colors only — neutral / orange / yellow

import { useState, useCallback } from "react";

interface SearchResult {
  id: number | string;
  path: string;
  score: number;
  metadata?: Record<string, any>;
}

interface TurboVecIndex {
  search: (opts: {
    query: number[];
    k: number;
    filters?: Record<string, any>;
  }) => Promise<SearchResult[]>;
}

// Placeholder – replace with real embedding call (HF / local)
declare function embed(text: string): Promise<number[]>;

export const SemanticExplorer = ({ index }: { index: TurboVecIndex }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) return;
      setLoading(true);
      try {
        const queryVec = await embed(q);
        const res = await index.search({
          query: queryVec,
          k: 20,
          filters: { training_ready: true },
        });
        setResults(res);
      } finally {
        setLoading(false);
      }
    },
    [index]
  );

  return (
    <div
      className="
        bento-card glass-panel backdrop-blur-24px
        bg-white/10 dark:bg-slate-800/20
        border border-white/30 rounded-2xl p-6
        col-span-2 row-span-2 relative overflow-hidden
      "
    >
      {/* Outer stroke — neutral */}
      <div className="absolute inset-0 rounded-2xl p-[1px] bg-white/25 pointer-events-none">
        <div className="w-full h-full rounded-2xl bg-transparent" />
      </div>

      <div className="relative z-10">
        <h2 className="text-xl font-semibold text-white/90 mb-4">
          Semantic Explorer
        </h2>

        {/* Rounded prompt input */}
        <div
          className="
            clay-input rounded-full bg-white/5 border border-white/20
            px-6 py-3 flex items-center gap-3 mb-6
          "
        >
          <span className="text-white/40">🔍</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch(query)}
            placeholder="Search your intelligence..."
            className="
              bg-transparent border-none outline-none
              text-white/90 placeholder-white/30 flex-1
            "
          />
          {loading && (
            <span className="text-yellow-300/70 animate-pulse">●</span>
          )}
        </div>

        {/* Results */}
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {results.map((result) => (
            <div
              key={result.id}
              className="
                clay-result rounded-xl bg-white/5 border border-white/10
                px-4 py-3 flex items-center justify-between
                hover:bg-white/10 transition-colors cursor-pointer
              "
              onClick={() => window.open(result.path, "_blank")}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-white/60 shrink-0">📄</span>
                <span className="text-white/80 text-sm truncate">
                  {result.path}
                </span>
              </div>
              <span
                className="
                  clay-badge clay-raised text-xs px-3 py-1 rounded-full
                  bg-orange-500/20 text-orange-300 shrink-0
                "
              >
                {result.score.toFixed(2)}
              </span>
            </div>
          ))}
          {!loading && results.length === 0 && query && (
            <p className="text-white/40 text-sm text-center py-6">
              No matching intelligence found
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
