#!/usr/bin/env python3
# Simple SIP client using pjsua (requires pjsua library)
# This is a stub – replace with actual pjsua2 or sip library.

import os
import time

# Placeholder: In production, use pjsua2 or softphone library.
# For now, just logs that it would register.

TELNYX_SIP_USER = os.environ.get("TELNYX_SIP_USER")
TELNYX_SIP_PASS = os.environ.get("TELNYX_SIP_PASS")
TELNYX_SIP_DOMAIN = "sip.telnyx.com"

if not TELNYX_SIP_USER:
    print("Telnyx SIP not configured – skipping")
    exit(0)

print(f"Registering SIP client for {TELNYX_SIP_USER}@{TELNYX_SIP_DOMAIN} ...")
# ... actual SIP registration would go here ...

while True:
    time.sleep(60)  # Keep alive
