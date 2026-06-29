LAUNCH VERIFICATION CHECKLIST

Minimum Live Architecture Verification

Target: AVA007 live on S25 (Authority) + S26 (Execution)
Milestone: Photo → Quote → Booking → Memory loop operational

---

S25 Ultra (Authority Node) - MUST PASS

[ ] Termux environment operational
[ ] AVA007 CoreRuntime initializes
[ ] GovernanceContract evaluates policies
[ ] ContextAssembler assembles context within token budget
[ ] AgentStop intercepts sub-agent outputs
[ ] BoundaryEnforcer validates access requests
[ ] HeadroomManager manages token allocation
[ ] Tashi working memory accessible
[ ] WebLLM runtime loads Gemma 2B fallback
[ ] VibeThinker provider initializes (parallel)
[ ] NPU bridge detects capabilities
[ ] Shared tensor manager allocates memory
[ ] Arrow buffer creates context batches
[ ] Cloudflare tunnel connected
[ ] BEEP mesh discovers peers
[ ] Operator console responsive

---

S26 Ultra (Execution Node) - MUST PASS

[ ] WebLLM runtime loads VibeThinker 3B
[ ] Vision model processes images
[ ] Speech model handles voice
[ ] Document parser (LiteParse) operational
[ ] NPU acceleration via QNN delegate
[ ] Zero-copy memory bridge functional
[ ] Photo → detection inference < 3s
[ ] Quote generation inference < 2s
[ ] Scheduling inference < 1s
[ ] Memory consolidation inference < 2s
[ ] Gemma 4B fallback available
[ ] Memory sync with S25 operational
[ ] Timeline events replicated

---

Core Flow Verification - MUST PASS

Photo Upload
[ ] Camera/gallery capture works
[ ] Image compressed to target size
[ ] Upload to S26 completes
[ ] S25 receives detection request

Product Detection
[ ] VibeThinker identifies product type
[ ] Confidence > 0.7 for known categories
[ ] Brand/model extracted when visible
[ ] Condition assessed correctly
[ ] Dimensions estimated reasonably

Quote Generation
[ ] Quote includes all line items
[ ] Labor hours calculated
[ ] Material costs estimated
[ ] Travel costs included
[ ] Total matches expectations
[ ] Quote valid for 7 days
[ ] Quote ID generated

Customer Acceptance
[ ] Quote presented to customer
[ ] Acceptance recorded
[ ] Quote status → 'accepted'
[ ] Booking workflow triggered

Booking Creation
[ ] Technician assigned
[ ] Time slot confirmed
[ ] Address validated
[ ] Calendar entry created
[ ] Notifications sent

Memory Record
[ ] Job completion recorded
[ ] Entities extracted
[ ] Insights generated
[ ] Tags applied
[ ] Stored in Tashi memory
[ ] Searchable for future jobs

---

End-to-End Test Scenarios

Scenario 1: IKEA Desk Assembly
[ ] Photo of desk box uploaded
[ ] Detected: "IKEA MALM Desk"
[ ] Quote: 2 hours, $150
[ ] Customer accepts
[ ] Booked for tomorrow 10am
[ ] Technician completes
[ ] Memory: "IKEA MALM assembly 2hrs standard"

Scenario 2: Appliance Repair
[ ] Photo of washer error code
[ ] Detected: "LG WM3900HWA Washer - Error FE"
[ ] Quote: 1.5 hours diagnostic + parts
[ ] Customer accepts
[ ] Booked same day 2pm
[ ] Part ordered, return visit scheduled
[ ] Memory: "LG FE error = water inlet valve"

Scenario 3: Furniture Repair
[ ] Photo of damaged chair leg
[ ] Detected: "Wooden dining chair - broken front leg"
[ ] Quote: 1 hour repair + materials
[ ] Customer accepts
[ ] Booked in 3 days
[ ] Completed with wood glue + clamp
[ ] Memory: "Chair leg repair - wood glue + 30min clamp"

---

Performance Targets

[ ] Photo → Detection: < 3 seconds
[ ] Detection → Quote: < 2 seconds
[ ] Quote → Booking: < 2 seconds
[ ] Booking → Memory: < 2 seconds
[ ] Total loop: < 10 seconds
[ ] Memory recall: < 500ms
[ ] Context assembly: < 200ms
[ ] Governance evaluation: < 100ms
[ ] Token usage: < 80% budget
[ ] NPU utilization: > 50% when available

---

Governance Verification

[ ] All actions pass GovernanceContract
[ ] AgentStop blocks unauthorized outputs
[ ] BoundaryEnforcer denies invalid access
[ ] HeadroomManager prevents OOM
[ ] Audit events generated for all decisions
[ ] Timeline events created for all state changes
[ ] Policy violations logged and escalated

---

Compatibility Verification (Existing S25)

[ ] Existing Gemma 2B still runs
[ ] Existing Tashi memory readable
[ ] Existing audit logs intact
[ ] Existing workflows unchanged
[ ] Operator console unchanged
[ ] BEEP mesh compatible
[ ] Cloudflare tunnel unchanged

---

Rollback Criteria (Any = Abort Launch)

[ ] Core flow fails > 3 retries
[ ] Governance blocks legitimate actions
[ ] Memory corruption detected
[ ] S25/S26 sync fails > 5 min
[ ] Operator cannot override
[ ] Audit trail gaps > 1 hour
[ ] Token budget exceeded > 95%

---

Post-Launch Monitoring (First 48 Hours)

[ ] All 3 test scenarios pass daily
[ ] Memory growth < 10%/day
[ ] Inference latency stable
[ ] NPU fallback rate < 10%
[ ] Customer satisfaction > 4.0/5
[ ] Technician on-time > 90%
[ ] Zero critical audit violations
[ ] Zero security incidents

---

Sign-Off

Authority Node (S25): _________________ Date: ___________
Execution Node (S26): _________________ Date: ___________
Operator Approval: _________________ Date: ___________

Go/No-Go: _________________