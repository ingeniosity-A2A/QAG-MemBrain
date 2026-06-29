import os
COMPANY_NAME = os.environ.get("COMPANY_NAME", "Help Assembly Services LLC")
SERVICE_AREA = os.environ.get("SERVICE_AREA", "Metro Atlanta")
BUSINESS_PHONE = os.environ.get("BUSINESS_PHONE", "+14044391350")
MERCURY_API_URL = os.environ.get("MERCURY_API_URL", "https://api.inceptionlabs.ai/v1/chat/completions")
MERCURY_API_KEY = os.environ.get("MERCURY_API_KEY", "")
MERCURY_MODEL = os.environ.get("MERCURY_MODEL", "mercury-2")
COST_INPUT_PER_M = 0.25
COST_OUTPUT_PER_M = 0.75
CORPUS_EXAMPLES_PER_SECTION = int(os.environ.get("CORPUS_EXAMPLES_PER_SECTION", "50"))
CORPUS_BUDGET_TOKENS = int(os.environ.get("CORPUS_BUDGET_TOKENS", "200000"))
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cache")
CORPUS_DIR = os.path.join(DATA_DIR, "corpus")
REFLEX_CACHE_PATH = os.path.join(CACHE_DIR, "reflex", "cache.json")
SKILL_CACHE_PATH = os.path.join(CACHE_DIR, "skills", "arena.json")
MERCURY_CACHE_PATH = os.path.join(CACHE_DIR, "mercury", "response_cache.json")
SERVICES = {
    "standard": {"name": "Standard Assembly", "items": ["IKEA KALLAX", "IKEA MALM dresser", "IKEA HEMNES bed", "IKEA BILLY bookcase", "IKEA PAX wardrobe", "baby crib", "dining table set", "bookshelf", "entertainment center"], "price": (75, 250)},
    "premium": {"name": "Premium Assembly", "items": ["IKEA kitchen island", "walk-in closet system", "Murphy bed", "modular sectional", "treadmill", "home gym power rack"], "price": (200, 600)},
    "outdoor": {"name": "Outdoor Assembly", "items": ["playset/swing set", "outdoor dining set", "patio gazebo", "storage shed", "trampoline"], "price": (150, 500)},
    "commercial": {"name": "Commercial Assembly", "items": ["office desk cluster", "conference table", "reception desk", "cubicle partitions", "retail shelving"], "price": (300, 1500)},
}
SERVICE_AREAS = ["Atlanta","Marietta","Decatur","Alpharetta","Sandy Springs","Roswell","Johns Creek","Duluth","Lawrenceville","Smyrna","Tucker","Brookhaven","Dunwoody","Kennesaw"]
A2A_AGENTS = {
    "scheduler":{"did":"did:helpassembly:scheduler:001","role":"Scheduling"},
    "quote_agent":{"did":"did:helpassembly:quote:001","role":"Quotes"},
    "field_tech":{"did":"did:helpassembly:fieldtech:001","role":"Tech coordination"},
    "dispatch":{"did":"did:helpassembly:dispatch:001","role":"Dispatch"},
    "billing":{"did":"did:helpassembly:billing:001","role":"Billing"},
    "inventory":{"did":"did:helpassembly:inventory:001","role":"Inventory"},
    "marketing":{"did":"did:helpassembly:marketing:001","role":"Marketing"},
    "customer_success":{"did":"did:helpassembly:cs:001","role":"Customer success"},
}
AGENT_X_TOOLS = [
    {"name":"send_sms","params":["number","message"]},
    {"name":"make_call","params":["number","purpose"]},
    {"name":"send_email","params":["to","subject","body"]},
    {"name":"create_quote","params":["customer","items","prices","valid_until"]},
    {"name":"send_quote","params":["quote_id","method"]},
    {"name":"create_booking","params":["customer","service","date","time","technician"]},
    {"name":"reschedule_booking","params":["booking_id","new_date","new_time"]},
    {"name":"cancel_booking","params":["booking_id","reason"]},
    {"name":"assign_technician","params":["booking_id","technician_id"]},
    {"name":"dispatch_technician","params":["technician_id","address","eta"]},
    {"name":"log_job_complete","params":["booking_id","actual_hours","notes"]},
    {"name":"create_invoice","params":["booking_id","amount","items"]},
    {"name":"send_invoice","params":["invoice_id","method"]},
    {"name":"record_payment","params":["invoice_id","amount","method"]},
    {"name":"send_review_request","params":["customer","platform"]},
    {"name":"send_follow_up","params":["customer","type","message"]},
    {"name":"update_inventory","params":["item","quantity","action"]},
    {"name":"check_availability","params":["date","service_area"]},
    {"name":"a2a_send","params":["target_agent","message","priority"]},
    {"name":"a2a_request","params":["target_agent","request_type","data"]},
    {"name":"get_customer_history","params":["customer_id"]},
    {"name":"get_schedule","params":["date","technician"]},
    {"name":"generate_report","params":["report_type","date_range"]},
    {"name":"respond_to_customer","params":["customer","channel","message"]},
    {"name":"tap","params":["x","y"]},
    {"name":"input_text","params":["text"]},
    {"name":"open_app","params":["app_name"]},
    {"name":"screenshot","params":[]},
]
