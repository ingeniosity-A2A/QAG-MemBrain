# Dual Brain Cognition (Layer 3)

Reflex (on-device), executive (cloud), and cortex (learning) layers.

## Subdirectories
- /reflex: On-device real-time decisions
- /executive: Planning, routing, identity, policy execution
- /cortex: Learning and adaptation outputs

## Communication
Reflex writes JSONL memories; Tashi syncs; executive reads reconstructed timelines; cortex writes policy updates as new JSONL memories.

## Reference
See docs/specifications for layer handshake details.
