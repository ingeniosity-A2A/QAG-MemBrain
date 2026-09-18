# Telecom boundary — QAG-MemBrain

**Retain (intelligence / policy / memory):**

- backhaul selection policy
- RF *observation* records / learning
- connectivity policy
- identity-*state* (not SoftSIM hardware provisioning)
- receipts and connectivity memory

**Move hardware execution to Agent-X containers:**

| Was mixed in skills/telecom | Goes to |
|-----------------------------|--------|
| termux_usb_serial drivers | Agent-X `containers/hardware-io/` |
| lora_sx1262 drivers | Agent-X `containers/rf-edge/` |
| modem/nRF91 execution | Agent-X `containers/cellular-edge/` |
| Telnyx API calls | Agent-X `containers/telecom-gateway/` |

```text
QAG-MemBrain  →  "select backhaul" / "observe RF" / "record event"
        ↓ A2A capability contract
Agent-X       →  USB modem / nRF91 / SX1262 / SDR / Telnyx
```

Phase 1: document only. Do not delete paths until Agent-X shims exist and tests pass.
