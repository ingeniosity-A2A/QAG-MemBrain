/* Forged File Explorer — browser kernel.
   Merges native Web APIs into the existing FFS surface. Not a second site.
   Three-color locked (neutral / orange / yellow). DEV is a rear-locked card.

   APIs that enhance Forged (wired):
     File System Access → F0 ingest from disk
     IndexedDB          → persist FILES / QUEUE / zone
     Web Worker         → F1 chunk off the main thread
     Fetch + Streams    → ingest progress when /api/ingest is absent
     MediaRecorder      → LENS capture → F0
     BroadcastChannel   → multi-tab queue sync
     IntersectionObserver → card reveal
     OffscreenCanvas    → confidence chip
   APIs that do not enhance (left out of the chrome):
     demo WebSocket echo, rAF FPS meters, CodePen TOC
*/
/* global FILES, QUEUE, state, renderCanvas, renderStack, refreshStats,
   asciiRipple, el, ZONE_LABELS */
(() => {
  const CHANNEL = "ffs-ava007";
  const DB_NAME = "ffs-island";
  const DB_VER = 1;
  const CHUNK = 900;

  const status = {
    idb: "locked",
    fs: "showOpenFilePicker" in window ? "ready" : "fallback",
    worker: "ready",
    lens: "idle",
    channel: "BroadcastChannel" in window ? "open" : "locked",
    stream: "idle",
    lastBytes: 0,
  };

  let db = null;
  let worker = null;
  let channel = null;
  let rearOpen = false;
  let persistTimer = 0;
  let hydrating = false;

  function hint(msg) {
    const node = document.getElementById("ingesthint");
    if (node) node.textContent = msg;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        status.idb = "unavailable";
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const store = req.result;
        if (!store.objectStoreNames.contains("island")) store.createObjectStore("island");
      };
      req.onsuccess = () => {
        db = req.result;
        status.idb = "ready";
        resolve(db);
      };
      req.onerror = () => {
        status.idb = "locked";
        reject(req.error);
      };
    });
  }

  function persist() {
    if (!db || hydrating || typeof FILES === "undefined") return;
    try {
      const tx = db.transaction("island", "readwrite");
      tx.objectStore("island").put(
        {
          files: FILES,
          queue: QUEUE,
          zone: state.zone,
          view: state.view,
          savedAt: new Date().toISOString(),
        },
        "v1",
      );
    } catch {
      /* quota / private mode — stay visible, inert persist */
    }
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 180);
  }

  async function hydrate() {
    if (!db) return;
    hydrating = true;
    try {
      const row = await new Promise((resolve) => {
        const tx = db.transaction("island", "readonly");
        const req = tx.objectStore("island").get("v1");
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      if (row && Array.isArray(row.files) && row.files.length) {
        FILES.splice(0, FILES.length, ...row.files);
        QUEUE.splice(0, QUEUE.length, ...(row.queue || []));
        if (row.zone) state.zone = row.zone;
        if (row.view) state.view = row.view;
        document.querySelectorAll(".leftnav button.zone").forEach((x) => {
          x.setAttribute("aria-current", String(x.dataset.zone === state.zone));
        });
        if (typeof setView === "function" && row.view) setView(row.view);
        refreshStats();
        renderCanvas();
        if (typeof renderStack === "function") renderStack();
      }
    } finally {
      hydrating = false;
    }
  }

  function makeWorker() {
    const code = `
      self.onmessage = ({ data }) => {
        const text = String(data.text || "");
        const size = data.size || 900;
        const n = Math.max(1, Math.ceil(text.length / size) || 1);
        const preview = text.slice(0, size);
        self.postMessage({ chunks: n, bytes: text.length, preview });
      };
    `;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
      status.worker = "ready";
    } catch {
      worker = null;
      status.worker = "locked";
    }
  }

  function chunkText(text) {
    return new Promise((resolve) => {
      if (!worker) {
        const n = Math.max(1, Math.ceil(text.length / CHUNK) || 1);
        resolve({ chunks: n, bytes: text.length, preview: text.slice(0, CHUNK) });
        return;
      }
      const once = (e) => {
        worker.removeEventListener("message", once);
        resolve(e.data);
      };
      worker.addEventListener("message", once);
      worker.postMessage({ text, size: CHUNK });
    });
  }

  function f0Card(partial) {
    return {
      id: "f0_" + Math.random().toString(16).slice(2, 10),
      stage: "F0",
      title: "untitled",
      subtitle: "RAW INGEST",
      destination: "NONE",
      confidence: 0,
      chunks: 1,
      sizeBytes: 0,
      domain: "ingest",
      source: "raw://kernel",
      createdAt: new Date().toISOString(),
      devLocked: false,
      capability: {
        dependencies: { kernel: "browser-apis" },
        tools: { fs: true, idb: true, worker: true },
        harness: { boundary: "exoskeleton" },
      },
      curation: undefined,
      ...partial,
    };
  }

  function admit(cards) {
    if (!cards.length) return;
    FILES.unshift(...cards);
    QUEUE.unshift(...cards.map((c) => c.id));
    state.zone = "f0_raw";
    document.querySelectorAll(".leftnav button.zone").forEach((x) => {
      x.setAttribute("aria-current", String(x.dataset.zone === "f0_raw"));
    });
    const strip = document.getElementById("f1strip");
    const line = document.getElementById("splitline");
    if (strip && line && typeof asciiRipple === "function") {
      strip.hidden = false;
      asciiRipple(line, "F0 « " + String(cards[0].title || "INGEST").slice(0, 18).toUpperCase() + " »", 10);
      setTimeout(() => {
        strip.hidden = true;
      }, 2200);
    }
    refreshStats();
    renderCanvas();
    if (typeof renderStack === "function") renderStack();
    if (typeof chatBadge === "function") chatBadge();
    observeCards();
    schedulePersist();
    broadcast({ type: "admit", ids: cards.map((c) => c.id) });
    paintRear();
  }

  async function ingestFileList(fileList) {
    const files = Array.from(fileList || []).slice(0, 24);
    if (!files.length) return;
    hint("worker · chunk " + files.length + " file" + (files.length === 1 ? "" : "s"));
    const incoming = [];
    for (const file of files) {
      const text = await file.text().catch(() => "");
      const cut = await chunkText(text);
      incoming.push(
        f0Card({
          title: file.name.slice(0, 48) || "file",
          subtitle: "DISK FILE",
          chunks: cut.chunks,
          sizeBytes: file.size || cut.bytes,
          domain: (file.type || "file").split("/")[0] || "file",
          source: "fs://" + file.name,
        }),
      );
    }
    admit(incoming);
    hint("F0 · " + incoming.length + " file" + (incoming.length === 1 ? "" : "s") + " admitted");
  }

  async function pickFiles() {
    try {
      if (window.showOpenFilePicker) {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          excludeAcceptAllOption: false,
        });
        const files = [];
        for (const h of handles.slice(0, 24)) files.push(await h.getFile());
        await ingestFileList(files);
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
    const input = document.getElementById("kernelfile");
    if (input) input.click();
  }

  async function pickDirectory() {
    if (!window.showDirectoryPicker) {
      pickFiles();
      return;
    }
    try {
      const dir = await window.showDirectoryPicker();
      const files = [];
      for await (const entry of dir.values()) {
        if (entry.kind === "file") files.push(await entry.getFile());
        if (files.length >= 24) break;
      }
      await ingestFileList(files);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      pickFiles();
    }
  }

  async function startLens() {
    const stage = document.getElementById("kernellens");
    const video = document.getElementById("kernellensvideo");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hint("lens DEV-locked · getUserMedia unavailable");
      status.lens = "locked";
      paintRear();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: true,
      });
      video.srcObject = stream;
      await video.play();
      stage.hidden = false;
      status.lens = "live";
      paintRear();
      hint("lens live · capture writes F0");
    } catch (err) {
      status.lens = "locked";
      hint("lens DEV-locked · " + (err && err.message ? err.message : "permission"));
      paintRear();
    }
  }

  function stopLens() {
    const stage = document.getElementById("kernellens");
    const video = document.getElementById("kernellensvideo");
    const stream = video && video.srcObject;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    if (stage) stage.hidden = true;
    status.lens = "idle";
    paintRear();
  }

  async function captureLens() {
    const video = document.getElementById("kernellensvideo");
    if (!video || !video.srcObject) {
      await startLens();
      return;
    }
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    let blob;
    if (window.OffscreenCanvas) {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(video, 0, 0, w, h);
      blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    }
    const recStream = video.srcObject;
    let recorded = null;
    if (window.MediaRecorder && recStream) {
      recorded = await new Promise((resolve) => {
        const chunks = [];
        let rec;
        try {
          rec = new MediaRecorder(recStream, { mimeType: "video/webm" });
        } catch {
          resolve(null);
          return;
        }
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
        rec.start();
        setTimeout(() => {
          try {
            rec.stop();
          } catch {
            resolve(null);
          }
        }, 900);
      });
    }
    const bytes = (blob && blob.size) || 0;
    status.lastBytes = bytes;
    admit([
      f0Card({
        title: "LENS " + new Date().toISOString().slice(11, 19),
        subtitle: recorded && recorded.size ? "LENS CLIP" : "LENS STILL",
        chunks: 1,
        sizeBytes: bytes + ((recorded && recorded.size) || 0),
        domain: "lens",
        source: "lens://ava007",
        capability: {
          dependencies: { kernel: "browser-apis" },
          tools: { getUserMedia: true, MediaRecorder: !!recorded, OffscreenCanvas: "OffscreenCanvas" in window },
          harness: { boundary: "exoskeleton" },
        },
      }),
    ]);
    hint("lens → F0");
    stopLens();
  }

  function broadcast(msg) {
    if (!channel) return;
    try {
      channel.postMessage(msg);
    } catch {
      /* closed */
    }
  }

  function observeCards() {
    if (!("IntersectionObserver" in window)) return;
    const root = document.getElementById("gridview") || document.querySelector(".grid");
    if (!root) return;
    if (observeCards.obs) observeCards.obs.disconnect();
    observeCards.obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("inview");
        });
      },
      { root: null, threshold: 0.08 },
    );
    root.querySelectorAll(".card").forEach((c) => observeCards.obs.observe(c));
  }

  function paintRear() {
    const body = document.getElementById("devrearbody");
    if (!body) return;
    const rows = [
      ["SYS_BUS", status.worker === "ready" ? "OPTIMAL" : "LOCKED"],
      ["INDEXED_DB", status.idb.toUpperCase()],
      ["FILE_ACCESS", status.fs.toUpperCase()],
      ["LENS", status.lens.toUpperCase()],
      ["CHANNEL", status.channel.toUpperCase()],
      ["STREAM", status.stream.toUpperCase()],
      ["LAST_BYTES", String(status.lastBytes)],
      ["ASSETS", String(typeof FILES !== "undefined" ? FILES.length : 0)],
    ];
    body.innerHTML = rows
      .map(([k, v]) => "<div><span>" + k + "</span> " + v + "</div>")
      .join("");
  }

  function setRear(open) {
    rearOpen = open;
    const insp = document.getElementById("inspector");
    const panel = document.getElementById("devrear");
    const btn = document.getElementById("devrearlock");
    if (insp) insp.classList.toggle("rear-open", open);
    if (panel) {
      panel.style.transform = open ? "translateX(-100%)" : "translateX(0)";
      panel.style.opacity = open ? "1" : "0";
    }
    if (btn) {
      btn.title = open ? "Lock DEV rear" : "Unlock DEV rear";
      btn.setAttribute("aria-pressed", String(open));
      btn.textContent = open ? "🔓" : "🔒";
    }
    paintRear();
  }

  async function streamFallback(url) {
    status.stream = "live";
    paintRear();
    hint("stream · " + url);
    const ac = new AbortController();
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    let total = 0;
    let text = "";
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        text += decoder.decode(value, { stream: true });
        status.lastBytes = total;
        hint("stream · " + total + " bytes");
      }
    } else {
      text = await res.text();
      total = text.length;
    }
    status.stream = "idle";
    status.lastBytes = total;
    const cut = await chunkText(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    admit([
      f0Card({
        title: (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, url])[1]
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 48),
        subtitle: "STREAM INGEST",
        chunks: cut.chunks,
        sizeBytes: total,
        source: "http://" + url.replace(/^https?:\/\//, ""),
      }),
    ]);
    hint("F0 · stream complete · " + total + " bytes");
    paintRear();
  }

  function wrapIngest() {
    const orig = window.submitIngest;
    if (typeof orig !== "function") return;
    window.submitIngest = async function patched(e) {
      e.preventDefault();
      const url = (document.getElementById("ingesturl") || {}).value;
      try {
        await orig(e);
        schedulePersist();
      } catch (err) {
        try {
          await streamFallback(String(url || "").trim());
        } catch (err2) {
          hint("ingest DEV-locked · " + (err2.message || err.message || "offline"));
        }
      }
    };
    const form = document.getElementById("ingestform");
    if (form) {
      form.removeEventListener("submit", orig);
      form.addEventListener("submit", window.submitIngest);
    }
  }

  function hookMutations() {
    const origDecide = window.decide;
    if (typeof origDecide === "function") {
      window.decide = function (id, decision) {
        origDecide(id, decision);
        schedulePersist();
        broadcast({ type: "decide", id, decision });
        paintRear();
      };
    }
    const origRender = window.renderCanvas;
    if (typeof origRender === "function") {
      window.renderCanvas = function () {
        origRender();
        observeCards();
      };
    }
  }

  function init() {
    makeWorker();
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type === "admit" || msg.type === "decide") {
          /* peer tab mutated — hydrate from IDB after it persists */
          setTimeout(hydrate, 240);
        }
      };
    }
    openDb()
      .then(hydrate)
      .catch(() => {})
      .then(() => {
        wrapIngest();
        hookMutations();
        observeCards();
        paintRear();
      });

    document.getElementById("kernelfilebtn")?.addEventListener("click", pickFiles);
    document.getElementById("kerneldirbtn")?.addEventListener("click", pickDirectory);
    document.getElementById("kernellensbtn")?.addEventListener("click", startLens);
    document.getElementById("kernelcapture")?.addEventListener("click", captureLens);
    document.getElementById("kernellensclose")?.addEventListener("click", stopLens);
    document.getElementById("kernelfile")?.addEventListener("change", (e) => {
      ingestFileList(e.target.files);
      e.target.value = "";
    });
    document.getElementById("devrearlock")?.addEventListener("click", () => setRear(!rearOpen));
    document.getElementById("devrearclose")?.addEventListener("click", () => setRear(false));
    setRear(false);

    window.addEventListener("pagehide", persist);
  }

  window.FFSKernel = {
    init,
    persist,
    hydrate,
    pickFiles,
    pickDirectory,
    startLens,
    captureLens,
    streamFallback,
    status,
  };
})();
