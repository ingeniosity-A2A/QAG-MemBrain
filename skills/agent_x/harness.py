import time, json
from src.patterns import match_pattern, generate_from_pattern, list_patterns
from src.reflex_router import ReflexRouter
from src.skill_arena import SkillArena
from src.tier_router import TierRouter
class Harness:
    def __init__(self, mercury_engine=None):
        self.mercury = mercury_engine; self.reflex = ReflexRouter(); self.arena = SkillArena(); self.router = TierRouter()
        self.stats = {"total":0,"t0":0,"t1":0,"t2":0,"reflex":0,"skill":0,"saved":0,"latency":0}
    def process(self, query, context=None):
        ctx = context or {}; self.stats["total"] += 1; start = time.time()
        cached = self.reflex.match(query)
        if cached:
            l = (time.time()-start)*1000; self.stats["reflex"]+=1; self.stats["latency"]+=l
            return {"response":cached["result"],"schema":cached["result"],"tier":"reflex","latency_ms":l,"tokens":0,"saved":800,"confidence":1.0}
        skill = self.arena.find_matching_skill(query)
        if skill:
            l = (time.time()-start)*1000; self.stats["skill"]+=1; self.stats["latency"]+=l
            return {"response":{"skill":skill},"schema":{"skill":skill},"tier":"skill","latency_ms":l,"tokens":0,"saved":800,"confidence":0.8}
        pr = match_pattern(query.lower())
        if pr:
            pn, sc = pr; schema = generate_from_pattern(pn, ctx); self.reflex.learn(query, schema)
            l = (time.time()-start)*1000; self.stats["t0"]+=1; self.stats["saved"]+=800; self.stats["latency"]+=l
            return {"response":schema,"schema":schema,"tier":"tier0","pattern":pn,"latency_ms":l,"tokens":0,"saved":800,"confidence":sc}
        if self._is_template(query):
            schema = self._template(query, ctx)
            if self.mercury:
                try:
                    r = self.mercury.generate([{"role":"user","content":f"Task: {query}\nSchema: {json.dumps(schema)}\nFix if needed. JSON only."}],"Validate. Output {\"actions\": [...]}",256,0.0,{"type":"json_object"})
                    try: v = json.loads(r.text)
                    except: v = schema
                    l = (time.time()-start)*1000; self.stats["t1"]+=1; self.stats["saved"]+=500; self.stats["latency"]+=l
                    self.reflex.learn(query, v)
                    return {"response":v,"schema":v,"tier":"tier1","latency_ms":l,"tokens":r.tokens_in+r.tokens_out,"saved":500,"confidence":0.85}
                except: pass
            l = (time.time()-start)*1000; self.stats["t1"]+=1; self.stats["saved"]+=800; self.stats["latency"]+=l
            return {"response":schema,"schema":schema,"tier":"tier1_raw","latency_ms":l,"tokens":0,"saved":800,"confidence":0.75}
        if self.mercury:
            r = self.mercury.generate_action_schema(query, ctx.get("tools",[]), ctx)
            try: p = json.loads(r.text)
            except: p = {"raw":r.text}
            l = (time.time()-start)*1000; self.stats["t2"]+=1; self.stats["latency"]+=l
            self.reflex.learn(query, p)
            return {"response":p,"schema":p,"tier":"tier2","latency_ms":l,"tokens":r.tokens_in+r.tokens_out,"saved":0,"confidence":0.95}
        l = (time.time()-start)*1000; self.stats["latency"]+=l
        return {"response":{"error":"No engine"},"schema":{},"tier":"fallback","latency_ms":l,"tokens":0,"saved":0,"confidence":0}
    def _is_template(self, q):
        return any(k in q.lower() for k in ["quote","book","schedule","send","call","text","invoice","dispatch","assign","check","cancel","remind","follow"])
    def _template(self, q, c):
        cust = c.get("customer","Customer"); item = c.get("item","furniture"); actions = []
        ql = q.lower()
        if any(k in ql for k in ["quote","estimate","price"]): actions.append({"tool":"create_quote","params":{"customer":cust,"items":[item],"prices":[c.get("price",150)]},"reason":"Quote"})
        if any(k in ql for k in ["book","schedule"]): actions.append({"tool":"create_booking","params":{"customer":cust,"service":item,"date":"TBD","time":"TBD"},"reason":"Book"})
        if any(k in ql for k in ["send","text","notify"]): actions.append({"tool":"send_sms","params":{"number":c.get("phone","+14045550000"),"message":f"Hi {cust}! Help Assembly Services LLC regarding your {item}."},"reason":"SMS"})
        if not actions: actions.append({"tool":"respond_to_customer","params":{"customer":cust,"channel":"sms","message":f"Processing your {item} request."},"reason":"Ack"})
        return {"actions": actions}
    def get_stats(self):
        t = self.stats["total"]
        if t == 0: return self.stats
        zt = self.stats["t0"]+self.stats["reflex"]+self.stats["skill"]
        return {**self.stats, "zero_token_pct":f"{(zt/t)*100:.1f}%", "avg_ms":f"{self.stats['latency']/t:.1f}", "patterns":len(list_patterns())}
def run_benchmark():
    print("Harness Benchmark — Help Assembly Services LLC"); h = Harness()
    tests = [("Send reminder for tomorrow","tier0"),("What's the price for IKEA MALM?","tier0"),("Book appointment in Marietta","tier0"),("Dispatch tech Marcus","tier0"),("Customer complaint wobbling","tier0"),("Send invoice","tier0"),("Check schedule","tier0"),("What areas do you serve?","tier0"),("Request review","tier0"),("Check weather","tier0"),("What's your warranty?","tier0"),("Complex commercial 15 workstations","tier2"),("Analyze quarterly revenue","tier2")]
    for q, exp in tests:
        r = h.process(q, {"customer":"Test","city":"Atlanta"})
        m = "V" if exp in r["tier"] else "X"
        print(f"  {m} [{r['tier']:>12}] {r['latency_ms']:6.1f}ms | {q[:45]}")
    print("\n--- Stats ---")
    for k,v in h.get_stats().items(): print(f"  {k}: {v}")
if __name__ == "__main__": run_benchmark()
