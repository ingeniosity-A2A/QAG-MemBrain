class TierRouter:
    def __init__(self): self.stats = {"device":0,"server":0}
    def route(self, query, context=None):
        c = context or {}
        if not c.get("network_available", True): self.stats["device"]+=1; return "device"
        if c.get("battery_pct",100) < 15: self.stats["server"]+=1; return "server"
        ql = query.lower()
        sk = sum(1 for kw in ["explain","analyze","plan","write","draft","summarize","research","report","commercial"] if kw in ql)
        dk = sum(1 for kw in ["send","call","text","check","book","schedule","quote","invoice","dispatch"] if kw in ql)
        if len(query.split()) > 40 or sk > dk: self.stats["server"]+=1; return "server"
        self.stats["device"]+=1; return "device"
