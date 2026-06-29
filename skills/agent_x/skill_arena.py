import json, time
from pathlib import Path
from src.config import SKILL_CACHE_PATH
class SkillArena:
    def __init__(self):
        self.path = Path(SKILL_CACHE_PATH); self.skills = {}
        if self.path.exists():
            try: self.skills = json.loads(self.path.read_text())
            except: pass
    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.skills, indent=2))
    def find_matching_skill(self, query):
        ql = query.lower()
        kw = {"send_quote_sms":["send quote","text quote"],"book_appointment":["book","schedule"],"send_reminder":["reminder"],"dispatch_tech":["dispatch","send technician"],"log_completion":["job complete","finished"],"send_invoice":["invoice","bill"],"follow_up":["follow up","check in"]}
        for skill, keys in kw.items():
            if any(k in ql for k in keys):
                s = self.skills.get(skill)
                if s and s.get("executions",0) >= 3 and self.score(skill) >= 0.6: return skill
        return None
    def score(self, name):
        s = self.skills.get(name)
        if not s or s["executions"]==0: return 0.0
        return 0.4*(s["successes"]/s["executions"]) + 0.6*max(0,1-s.get("total_tokens",0)/10000/s["executions"])
    def record_execution(self, name, result):
        if name not in self.skills: self.skills[name] = {"executions":0,"successes":0,"total_tokens":0}
        s = self.skills[name]; s["executions"] += 1
        if result.get("success",True): s["successes"] += 1
        s["total_tokens"] += result.get("tokens_used",0); self._save()
    def get_skill(self, name): return self.skills.get(name, {})
