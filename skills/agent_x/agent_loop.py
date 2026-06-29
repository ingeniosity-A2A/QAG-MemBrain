import os, json
from src.harness import Harness
from src.mercury_engine import MercuryEngine
from src.config import COMPANY_NAME, SERVICE_AREA, AGENT_X_TOOLS
def main():
    k = os.environ.get("MERCURY_API_KEY","")
    if not k: print("ERROR: Set MERCURY_API_KEY"); exit(1)
    m = MercuryEngine(k); h = Harness(mercury_engine=m)
    print(f"{COMPANY_NAME} — Agent X v2.0 — {SERVICE_AREA}")
    print(f"Budget: {m.budget.remaining:,} tokens\nType query or 'quit'.\n")
    while True:
        try:
            q = input("You: ").strip()
            if not q or q.lower() in ("quit","exit","q"): break
            r = h.process(q, {"tools": AGENT_X_TOOLS, "network_available": True})
            print(f"  Tier: {r['tier']} | {r['latency_ms']:.1f}ms | {r['tokens']} tok | saved {r['saved']}")
            print(f"  {json.dumps(r['schema'],indent=2)[:250]}\n")
        except KeyboardInterrupt: break
        except Exception as e: print(f"  Error: {e}\n")
    print("Summary:"); [print(f"  {k2}: {v}") for k2,v in h.get_stats().items()]
if __name__ == "__main__": main()
