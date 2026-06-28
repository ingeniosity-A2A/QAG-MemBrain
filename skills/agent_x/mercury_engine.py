import os, time, json, ssl, hashlib, urllib.request
from dataclasses import dataclass
from pathlib import Path
from src.config import MERCURY_API_URL, MERCURY_API_KEY, MERCURY_MODEL, COST_INPUT_PER_M, COST_OUTPUT_PER_M, MERCURY_CACHE_PATH

@dataclass
class InferenceResult:
    text: str; tokens_in: int; tokens_out: int; latency_ms: float; tokens_per_sec: float; cost_usd: float; cached: bool = False

class TokenBudget:
    def __init__(self, total, used=0): self.total = total; self.used = used
    @property
    def remaining(self): return self.total - self.used
    def can_afford(self, est): return self.remaining >= est
    def record(self, ti, to): self.used += ti + to

class ResponseCache:
    def __init__(self):
        self.path = Path(MERCURY_CACHE_PATH); self.entries = {}
        if self.path.exists():
            try: self.entries = json.loads(self.path.read_text())
            except: pass
    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.entries, indent=2))
    def get(self, k): return self.entries.get(k)
    def put(self, k, v): self.entries[k] = v; self._save()
    def key(self, msgs, sys=""):
        return hashlib.sha256((sys + "|" + "|".join(m.get("content","") for m in msgs)).encode()).hexdigest()[:16]

class MercuryEngine:
    def __init__(self, api_key="", budget=9_992_775):
        self.api_key = api_key or MERCURY_API_KEY
        if not self.api_key: raise ValueError("MERCURY_API_KEY not set")
        self.budget = TokenBudget(budget); self.cache = ResponseCache()
        self.stats = {"calls": 0, "errors": 0, "cache_hits": 0}

    def generate(self, messages, system="", max_tokens=512, temperature=0.1, response_format=None, use_cache=True):
        full = []
        if system: full.append({"role": "system", "content": system})
        full.extend(messages)
        if use_cache:
            k = self.cache.key(full, system); c = self.cache.get(k)
            if c:
                self.stats["cache_hits"] += 1; self.stats["calls"] += 1
                return InferenceResult(c["text"], c["ti"], c["to"], 0, 0, 0, True)
        est = int(len(json.dumps(full).split()) * 1.3 + max_tokens)
        if not self.budget.can_afford(est): raise RuntimeError(f"Budget exhausted: {self.budget.remaining:,}")
        payload = {"model": MERCURY_MODEL, "messages": full, "max_tokens": max_tokens, "temperature": temperature}
        if response_format: payload["response_format"] = response_format
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}
        req = urllib.request.Request(MERCURY_API_URL, json.dumps(payload).encode(), headers, method="POST")
        start = time.time()
        try:
            with urllib.request.urlopen(req, timeout=30, context=ssl.create_default_context()) as resp:
                result = json.loads(resp.read())
        except Exception as e:
            self.stats["errors"] += 1; raise ConnectionError(f"API error: {e}")
        latency = (time.time() - start) * 1000
        content = result["choices"][0]["message"]["content"]
        usage = result.get("usage", {}); ti = usage.get("prompt_tokens", 0); to = usage.get("completion_tokens", 0)
        tps = to / (latency / 1000) if latency > 0 else 0
        cost = (ti / 1_000_000) * COST_INPUT_PER_M + (to / 1_000_000) * COST_OUTPUT_PER_M
        self.budget.record(ti, to); self.stats["calls"] += 1
        if use_cache: self.cache.put(self.cache.key(full, system), {"text": content, "ti": ti, "to": to})
        return InferenceResult(content, ti, to, latency, tps, cost)

    def generate_action_schema(self, task, tools, context=None):
        sys = f"You are Agent X for Help Assembly Services LLC in Metro Atlanta. Generate JSON: {{\"actions\": [...]}}. Tools: {json.dumps(tools)}"
        return self.generate([{"role": "user", "content": f"Task: {task}\nContext: {json.dumps(context or {})}"}], sys, 512, 0.0, {"type": "json_object"})

    def budget_report(self):
        return {"remaining": f"{self.budget.remaining:,}", "used": f"{self.budget.used:,}", "calls": self.stats["calls"], "cache_hits": self.stats["cache_hits"], "errors": self.stats["errors"]}

def run_test():
    print("Mercury 2 Test"); e = MercuryEngine()
    r = e.generate([{"role": "user", "content": "What does a furniture assembly company do?"}], max_tokens=80)
    print(f"{r.text[:100]} | {r.latency_ms:.0f}ms | {r.tokens_per_sec:.0f} tok/s")
    for k, v in e.budget_report().items(): print(f"  {k}: {v}")

if __name__ == "__main__": run_test()
