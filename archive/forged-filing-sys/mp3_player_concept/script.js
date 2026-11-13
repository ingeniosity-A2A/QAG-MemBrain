/* ════════════════════════════════════════
  MP3 Player Concept — behavior
  Visual state at load matches the reference
  exactly: 04:35, 55% seek, mixed EQ silhouette
  with scattered orange peak cells.
═══════════════════════════════════════ */

const $ = id => document.getElementById(id);
const clockEl = $('clock');
const eqEl = $('eq');
const seekEl = $('seek');
const fillEl = $('seek-fill');
const handleEl = $('seek-handle');

/* ── EQ ── */
const BAR_COUNT = 27;

/* silhouette close to the reference's static frame */
const seed = [
  22, 38, 30, 52, 44, 66, 58, 74, 48, 62,
  80, 56, 70, 42, 64, 86, 60, 76, 50, 68,
  40, 58, 72, 46, 62, 34, 26
];

const bars = [];
for (let i = 0; i < BAR_COUNT; i++) {
  const bar = document.createElement('div');
  bar.className = 'bar';
  const peak = Math.min(100, seed[i] + 10 + Math.random() * 8);
  bar.style.setProperty('--h', seed[i] + '%');
  bar.style.setProperty('--p', peak + '%');
  eqEl.appendChild(bar);
  bars.push({ el: bar, phase: Math.random() * Math.PI * 2, speed: 0.9 + Math.random() * 1.4, level: seed[i], peak });
}

/* orange peak cells cap only a few bars, like the shot */
bars.forEach((b) => b.el.style.setProperty('--p', '0%'));
[2, 6, 10, 14, 18, 22].forEach((i) => {
  const b = bars[i];
  b.peak = Math.min(97, b.level + 2.5);
  b.el.style.setProperty('--p', b.peak.toFixed(1) + '%');
});

let playing = false;
let t0 = performance.now();

function eqFrame(now) {
  const t = (now - t0) / 1000;
  for (const b of bars) {
    let target;
    if (playing) {
      target = 34 + 46 * (0.5 + 0.5 * Math.sin(t * b.speed * 2.1 + b.phase)) * (0.6 + 0.4 * Math.sin(t * 0.7 + b.phase * 1.7));
      target = Math.max(14, Math.min(92, target + (Math.random() - 0.5) * 10));
    } else {
      target = b.base ?? (b.base = b.level);
    }
    b.level += (target - b.level) * 0.25;
    b.el.style.setProperty('--h', b.level.toFixed(1) + '%');

    if (playing) {
      if (b.level > b.peak) {
        b.peak = Math.min(97, b.level + 3);
      } else {
        b.peak = Math.max(b.level, b.peak - 0.45);
      }
      b.el.style.setProperty('--p', b.peak.toFixed(1) + '%');
    }
  }
  requestAnimationFrame(eqFrame);
}
requestAnimationFrame(eqFrame);

/* ── CLOCK ── */
let clockSec = 4 * 60 + 35; /* 04:35, as in the reference */

function fmt(n) {
  const m = String(Math.floor(n / 60)).padStart(2, '0');
  const s = String(n % 60).padStart(2, '0');
  return `${m}:${s}`;
}

setInterval(() => {
  if (!playing) return;
  clockSec = (clockSec + 1) % (24 * 3600);
  clockEl.textContent = fmt(clockSec);
}, 1000);

/* ── SEEK ── */
const TRACK_LEN = 3 * 60 + 45; /* (3:45) */
let seekSec = Math.round(TRACK_LEN * 0.55); /* handle at ~55% like the shot */

function paintSeek() {
  const pct = Math.min(100, (seekSec / TRACK_LEN) * 100);
  fillEl.style.width = `calc(${pct}% - 2px)`;
  handleEl.style.left = pct + '%';
}
paintSeek();

setInterval(() => {
  if (!playing) return;
  seekSec += 1;
  if (seekSec >= TRACK_LEN) { seekSec = 0; clockSec = 0; }
  paintSeek();
}, 1000);

function seekFromEvent(e) {
  const rect = seekEl.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  seekSec = Math.max(0, Math.min(1, x)) * TRACK_LEN;
  paintSeek();
}
let dragging = false;
seekEl.addEventListener('pointerdown', (e) => { dragging = true; seekEl.setPointerCapture(e.pointerId); seekFromEvent(e); });
seekEl.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
window.addEventListener('pointerup', () => { dragging = false; });

/* ── TRANSPORT ── */
const btnPlay = $('btn-play');
const btnPause = $('btn-pause');

function setPlaying(on) {
  playing = on;
  btnPlay.classList.toggle('toggled', on);
  btnPause.classList.toggle('toggled', !on);
}
setPlaying(false);

btnPlay.addEventListener('click', () => setPlaying(true));
btnPause.addEventListener('click', () => setPlaying(false));
$('btn-stop').addEventListener('click', () => {
  setPlaying(false);
  seekSec = 0;
  paintSeek();
  clockSec = 4 * 60 + 35;
  clockEl.textContent = fmt(clockSec);
});
$('btn-prev').addEventListener('click', () => { seekSec = 0; paintSeek(); });
$('btn-next').addEventListener('click', () => { seekSec = 0; paintSeek(); });

/* EQ toggle stays green by default, as in the reference */
$('mb-eq').addEventListener('click', () => $('mb-eq').classList.toggle('mb-active'));
