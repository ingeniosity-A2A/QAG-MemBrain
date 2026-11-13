/* S26 native layer — bootstrap. Loaded with `defer`, so it runs after the
   data-island script has been parsed and executed; it shares the global scope
   with it (chat, ingest, QUEUE, $, setChatOpen, submitIngest…).
   All DOM wiring happens at window load — DEV-lock safe, three-color locked. */
/* global chat, ingest, $, setChatOpen, setIngestOpen, sendChat, submitIngest, chatBadge,
   renderDisplayMode */
(() => {
  window.addEventListener("load", () => {
    if (typeof chat !== "object" || !chat) return; // engine script missing — stay inert

    chat.dock = document.getElementById("chatdock");
    chat.log = document.getElementById("chatlog");
    chat.form = document.getElementById("chatform");
    chat.input = document.getElementById("chatinput");
    chat.send = document.getElementById("chatsend");
    chat.state = document.getElementById("chatstate");
    chat.mode = document.getElementById("chatmode");
    chat.fab = document.getElementById("fabchat");

    ingest.sheet = document.getElementById("ingestsheet");
    ingest.form = document.getElementById("ingestform");
    ingest.url = document.getElementById("ingesturl");
    ingest.go = document.getElementById("ingestgo");
    ingest.hint = document.getElementById("ingesthint");
    ingest.fab = document.getElementById("fabingest");

    chat.fab.addEventListener("click", () => setChatOpen(!chat.open));
    document.getElementById("chatclose").addEventListener("click", () => setChatOpen(false));
    chat.mode.addEventListener("click", (e) => {
      const b = e.target.closest("b[data-mode]");
      if (!b) return;
      chat.modeSel = b.dataset.mode;
      chat.mode.querySelectorAll("b").forEach((x) => { x.dataset.on = String(x === b); });
    });
    chat.form.addEventListener("submit", (e) => { e.preventDefault(); sendChat(); });

    ingest.fab.addEventListener("click", () => setIngestOpen(!ingest.sheet.classList.contains("open")));
    document.getElementById("ingestclose").addEventListener("click", () => setIngestOpen(false));
    ingest.form.addEventListener("submit", submitIngest);
    /* VIEW CATALOG: the catalog is packaged with the service and renders as
       cards — open the in-app card inventory (F0 lane), don't fetch anything */
    document.getElementById("ingestcatalog").addEventListener("click", () => {
      setIngestOpen(false);
      if (typeof setView === "function") setView("grid");
      state.zone = "f0_raw";
      document.querySelectorAll(".leftnav button.zone").forEach((x) => {
        x.setAttribute("aria-current", String(x.dataset.zone === "f0_raw"));
      });
      renderCanvas();
      const first = document.querySelector("#gridview .card");
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    /* tap-outside closes the phone inspector bottom-sheet */
    document.addEventListener("click", (e) => {
      const insp = document.getElementById("inspector");
      if (insp.classList.contains("open") && !insp.contains(e.target) && !e.target.closest(".card")) {
        insp.classList.remove("open");
      }
    });

    chatBadge();

    /* display-mode awareness: TR corner chip reports how the app is displayed
       (standalone / minimal-ui / fullscreen / browser); the INSTALL pill in the
       BR corner triggers the captured beforeinstallprompt when available */
    if (typeof renderDisplayMode === "function") renderDisplayMode();
    const pill = document.getElementById("installpill");
    if (pill) {
      const installable = !!window.__avaInstallEvent &&
        !window.matchMedia("(display-mode: standalone)").matches &&
        !window.matchMedia("(display-mode: minimal-ui)").matches;
      if (installable) pill.hidden = false;
      pill.addEventListener("click", async () => {
        const evt = window.__avaInstallEvent;
        if (!evt) return;
        evt.prompt();
        try {
          const choice = await evt.userChoice;
          if (choice && choice.outcome === "accepted") pill.hidden = true;
        } catch { /* choice unavailable — leave pill as-is */ }
      });
    }
    /* the standalone media query flips when the installed app launches */
    window.matchMedia("(display-mode: standalone)").addEventListener?.("change", () => {
      if (typeof renderDisplayMode === "function") renderDisplayMode();
    });

    /* PWA: installable on the S26 Ultra home screen (https/localhost only) */
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      const swUrl = new URL("sw.js", document.baseURI || location.href);
      navigator.serviceWorker.register(swUrl.href).catch(() => {});
    }

    if (window.FFSKernel && typeof window.FFSKernel.init === "function") {
      window.FFSKernel.init();
    }
  });
})();
