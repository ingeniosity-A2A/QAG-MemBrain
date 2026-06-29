import json, os, time
from http.server import HTTPServer, BaseHTTPRequestHandler
from src.harness import Harness
from src.mercury_engine import MercuryEngine
from src.patterns import list_patterns
from src.config import COMPANY_NAME, AGENT_X_TOOLS
harness = None
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _j(self, d, s=200):
        self.send_response(s); self.send_header("Content-Type","application/json"); self.end_headers()
        self.wfile.write(json.dumps(d).encode())
    def do_GET(self):
        if self.path=="/health": self._j({"ok":True,"company":COMPANY_NAME,"stats":harness.get_stats() if harness else {}})
        elif self.path=="/patterns": self._j({"patterns":list_patterns()})
        else: self._j({"error":"not found"}, 404)
    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers.get("Content-Length",0))))
        if self.path=="/process":
            try: self._j(harness.process(b.get("query",""), b.get("context",{})))
            except Exception as e: self._j({"error":str(e)}, 500)
        else: self._j({"error":"not found"}, 404)
def main():
    global harness
    k = os.environ.get("MERCURY_API_KEY","")
    if not k: print("ERROR: MERCURY_API_KEY"); exit(1)
    harness = Harness(mercury_engine=MercuryEngine(k))
    print(f"{COMPANY_NAME} API on http://0.0.0.0:7474")
    HTTPServer(("0.0.0.0",7474), H).serve_forever()
if __name__ == "__main__": main()
