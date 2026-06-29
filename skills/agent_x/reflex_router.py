import json, time
from pathlib import Path
from difflib import SequenceMatcher
from src.config import REFLEX_CACHE_PATH
class ReflexRouter:
    def __init__(self):
        self.path = Path(REFLEX_CACHE_PATH); self.entries = []
        if self.path.exists():
            try: self.entries = json.loads(self.path.read_text())
            except: pass
    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.entries, indent=2))
    def match(self, query, threshold=0.85):
        norm = " ".join(query.lower().split()); best_s = 0.0; best_e = None
        for e in self.entries:
            s = SequenceMatcher(None, norm, e["pattern"]).ratio()
            if s > best_s: best_s = s; best_e = e
        if best_e and best_s >= threshold:
            best_e["hits"] = best_e.get("hits",0)+1; self._save(); return best_e
        return None
    def learn(self, query, result):
        norm = " ".join(query.lower().split())
        for e in self.entries:
            if e["pattern"] == norm: e["result"] = result; self._save(); return
        self.entries.append({"pattern": norm, "result": result, "hits": 0}); self._save()
    def stats(self): return {"patterns": len(self.entries), "hits": sum(e.get("hits",0) for e in self.entries)}
