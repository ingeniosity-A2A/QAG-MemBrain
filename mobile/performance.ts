// Performance budgets — AMOS v2.1
// Target: Samsung Galaxy S25/S26 Ultra (Snapdragon 8 Elite)
export const performanceBudgets = {
  // Hot path latency targets (ms)
  rev_ike_reflex: 20,        // REV.IKE sub-20ms reflex
  ava007_decision: 100,      // AVA007 executive loop
  meta_harness_overhead: 5,  // Meta Harness per-call overhead
  constellation_routing: 30, // Constellation model selection
  gsap_reconstruction: 16,   // GSAP single-frame budget (60fps)

  // Memory budgets (MB)
  webllm_model: 4096,        // Max model size in RAM (4GB)
  arrow_buffer_pool: 512,    // Arrow zero-copy buffer pool
  tashi_l0_ram: 256,         // TASHI L0 RAM cache

  // Thermal / battery
  maxNpuUtilization: 0.85,
  maxCpuUtilization: 0.70,
  batteryBudgetPerSession: 5, // % per session
};
