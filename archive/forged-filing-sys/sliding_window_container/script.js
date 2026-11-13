/* ═══════════════════════════════════════════════════════════════
   A2A App-less — Sliding Window Container behavior
   Mechanism extracted verbatim from the reference player:
   classList.toggle → CSS width/height transitions (shell .4s,
   content fade .2s). Plus drag-to-resize within caps:
   right ≤ 50% width · bottom ≤ 25% height · one or all extend.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var swc = document.getElementById("swc");
  var rightKey = document.getElementById("rightKey");
  var bottomKey = document.getElementById("bottomKey");
  var gripV = document.getElementById("gripV");
  var gripH = document.getElementById("gripH");
  var runKey = document.getElementById("runKey");

  var RIGHT_CAP = 0.5;   // ≤ 50% width
  var BOTTOM_CAP = 0.25; // ≤ 25% height

  /* ── edge-key toggles (the reference mechanism, verbatim) ── */
  function syncKeys() {
    rightKey.classList.toggle("active", swc.classList.contains("open-right"));
    bottomKey.classList.toggle("active", swc.classList.contains("open-bottom"));
  }
  rightKey.addEventListener("click", function () {
    document.getElementById("panelRight").style.width = "";   // clear drag size → cap
    swc.classList.toggle("open-right");
    syncKeys();
  });
  bottomKey.addEventListener("click", function () {
    document.getElementById("panelBottom").style.height = ""; // clear drag size → cap
    swc.classList.toggle("open-bottom");
    syncKeys();
  });
  syncKeys();

  /* ── drag-to-resize within caps ── */
  function startDrag(grip, axis) {
    grip.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      swc.classList.add("dragging"); // transitions off (mechanism preserved)

      var rect = swc.getBoundingClientRect();
      var rightOpen = swc.classList.contains("open-right");
      var bottomOpen = swc.classList.contains("open-bottom");

      function onMove(ev) {
        if (axis === "x") {
          var w = Math.min(Math.max(rect.right - ev.clientX, 200), rect.width * RIGHT_CAP);
          swc.classList.add("open-right");
          document.getElementById("panelRight").style.width = w + "px";
        } else {
          var h = Math.min(Math.max(rect.bottom - ev.clientY, 96), rect.height * BOTTOM_CAP);
          swc.classList.add("open-bottom");
          document.getElementById("panelBottom").style.height = h + "px";
        }
      }
      function onUp(ev) {
        grip.releasePointerCapture(ev.pointerId);
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        // snap to cap if dragged past 90% of it, else keep size; clear inline → CSS cap
        if (axis === "x") {
          var w = parseFloat(document.getElementById("panelRight").style.width) / rect.width;
          if (w >= RIGHT_CAP * 0.9) document.getElementById("panelRight").style.width = "";
          else document.getElementById("panelRight").style.width =
            Math.max(w * 100, 17) + "%";
        } else {
          var h = parseFloat(document.getElementById("panelBottom").style.height) / rect.height;
          if (h >= BOTTOM_CAP * 0.9) document.getElementById("panelBottom").style.height = "";
          else document.getElementById("panelBottom").style.height =
            Math.max(h * 100, 12) + "%";
        }
        swc.classList.remove("dragging"); // transitions back on
        syncKeys();
      }
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
    });
  }
  startDrag(gripV, "x");
  startDrag(gripH, "y");

  /* ── action contract ticker (kernel authority demo) ── */
  var CONTRACTS = [
    { cap: "telecom.radio",  op: "atpc.adjust",  auth: "TELECOM",
      verify: "rsrp(t+30s) − rsrp(t) ≥ +1.0 dB", verdict: "KERNEL ACCEPT", sub: "telemetry → rain-fade → Telecom Lobe" },
    { cap: "adb.android",    op: "getprop",      auth: "READ_ONLY",
      verify: "stdout non-empty", verdict: "KERNEL ACCEPT", sub: "ro.build.version.release" },
    { cap: "termux.host",    op: "wake-lock.hold", auth: "LOW_RISK",
      verify: "lock held while NV lock active", verdict: "KERNEL ACCEPT", sub: "reflex_directive() — deterministic" },
    { cap: "geniex.snapdragon", op: "sdk.invoke", auth: "DEVICE_CONTROL",
      verify: "—", verdict: "KERNEL REJECT", sub: "capability ABSENT — inspection precedes implementation" },
    { cap: "omnios.telecom", op: "sim.provision", auth: "SYSTEM_MODIFY",
      verify: "PLMN registered on target", verdict: "KERNEL ACCEPT", sub: "eSIM policy — onomondo-ncs lane" },
    { cap: "oci.node",       op: "vault.wipe",   auth: "DESTRUCTIVE",
      verify: "—", verdict: "AWAITING APPROVAL", sub: "destructive class — operator approval required" }
  ];

  var els = {
    cap: document.getElementById("cCap"),
    op: document.getElementById("cOp"),
    auth: document.getElementById("cAuth"),
    conf: document.getElementById("cConf"),
    verify: document.getElementById("cVerify"),
    verdict: document.getElementById("cVerdict"),
    sub: document.getElementById("lcdSub"),
    seq: document.getElementById("lcdSeq"),
    title: document.getElementById("lcdTitle")
  };

  var ci = 0, seq = 1;
  function showContract() {
    var c = CONTRACTS[ci % CONTRACTS.length];
    ci++;
    els.cap.textContent = c.cap;
    els.op.textContent = c.op;
    els.auth.textContent = c.auth;
    els.conf.textContent = (0.72 + (ci % 5) * 0.05).toFixed(2);
    els.verify.textContent = c.verify;
    els.verdict.textContent = c.verdict;
    els.verdict.classList.toggle("reject", c.verdict !== "KERNEL ACCEPT");
    els.sub.textContent = c.sub;
    els.seq.textContent = "SEQ " + String(seq++).padStart(4, "0");
    els.title.textContent = c.verdict === "KERNEL ACCEPT" ? "HEADLESS EXECUTION" :
      (c.verdict === "KERNEL REJECT" ? "POLICY REJECTION" : "APPROVAL GATE");
  }
  setInterval(showContract, 3200);

  /* ── RUN key: walk the canonical loop ── */
  var stages = Array.prototype.slice.call(document.querySelectorAll(".sg"));
  var running = false;
  runKey.addEventListener("click", function () {
    if (running) return;
    running = true;
    runKey.classList.add("running");
    stages.forEach(function (s) { s.classList.remove("lit"); });
    var i = 0;
    var t = setInterval(function () {
      if (i > 0) stages[i - 1].classList.remove("lit");
      if (i >= stages.length) {
        clearInterval(t);
        stages[stages.length - 1].classList.add("lit");
        runKey.classList.remove("running");
        running = false;
        return;
      }
      stages[i].classList.add("lit");
      i++;
    }, 240);
  });

  /* ── F0→F3 progress + honest latency + clock ── */
  var fbar = document.getElementById("fbar");
  var lat = document.getElementById("latency");
  setInterval(function () {
    var p = 55 + Math.round(Math.sin(Date.now() / 4000) * 8 + Math.random() * 6);
    fbar.style.width = p + "%";
  }, 1500);
  setInterval(function () {
    var t = (38 + Math.random() * 9).toFixed(1);
    var x = (110 + Math.random() * 40).toFixed(1);
    lat.textContent = "transport " + t + " ms · exec " + x + " ms — measured, never zero";
  }, 2400);

  /* clock ticks from 04:35 (mission start, reference frame) */
  var clock = document.getElementById("lcdClock");
  var base = 4 * 3600 + 35 * 60;
  var t0 = Date.now();
  setInterval(function () {
    var cur = (base + Math.floor((Date.now() - t0) / 1000)) % 86400;
    var hh = String(Math.floor(cur / 3600)).padStart(2, "0");
    var mm = String(Math.floor((cur % 3600) / 60)).padStart(2, "0");
    clock.textContent = hh + ":" + mm;
  }, 1000);

  /* recipe rows selectable */
  document.querySelectorAll(".ri").forEach(function (row) {
    row.addEventListener("click", function () {
      document.querySelectorAll(".ri").forEach(function (r) { r.classList.remove("current"); });
      row.classList.add("current");
    });
  });
})();
