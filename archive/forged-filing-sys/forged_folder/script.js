/* ════════════════════════════════════════
  FORGEDxFolder — GSAP Data Kernel Simulator
  Implements: instant(), morph(), stagger(), seek()

  Handoff notes (2026-09-30):
  - Deduplicated a corrupted double-paste of this file.
  - Kernel.stagger() now receives the created DOM elements
    (it was called on raw data objects and would throw).
  - render() removes only .file nodes so the #empty state
    survives innerHTML wipes (was: getElementById('empty')
    on a detached node → TypeError on first render).
═══════════════════════════════════════ */

const ICONS = { folder: '📁', code: '📜', image: '🖼️', doc: '📄' };
const KINDS = { folder: 'Folder', code: 'Mercury Stream', image: 'VLM Weight', doc: 'Arrow Buffer' };
const $ = id => document.getElementById(id);

let DB = null;
let current = 'root';
let selected = null;
let view = 'grid';
let filter = 'all';
let sortKey = 'name';
let query = '';
let playheadTime = 0.425; // Simulated 42.5% training/processing state

/* ── GSAP KERNEL SIMULATION ── */
const Kernel = {
  // 1. instant() / gsap.set(): Atomic state override, zero frame delay
  set: (target, state) => {
    target.classList.add('inject-flash');
    setTimeout(() => target.classList.remove('inject-flash'), 400);
    console.log(`[Kernel.set] Atomic override applied to ${state}`);
  },

  // 2. morph(): Interpolates data structures (simulated via UI transition)
  morph: (item) => {
    const preview = $('insp-preview');
    preview.style.transform = 'scale(0.8) rotate(5deg)';
    preview.style.opacity = '0.5';

    setTimeout(() => {
      preview.textContent = '🔄';
      $('insp-note').textContent = "Morphing tensor weights... resolving dimensional mismatch via pseudo-point mapping.";

      setTimeout(() => {
        preview.textContent = ICONS[item.type];
        preview.style.transform = 'scale(1) rotate(0deg)';
        preview.style.opacity = '1';
        $('insp-note').textContent = item.note + " [Morph Complete: Structural continuity maintained.]";
      }, 600);
    }, 300);
  },

  // 3. stagger(): Progressive execution offset (DOM elements only)
  stagger: (elements, delay) => {
    elements.forEach((el, i) => {
      el.style.animationDelay = `${i * delay}ms`;
    });
  },

  // 4. seek(): Deterministic state auditing at exact playhead position
  seek: (progress) => {
    playheadTime = Math.max(0, Math.min(1, progress));
    $('playhead-progress').style.width = `${playheadTime * 100}%`;
    $('playhead-thumb').style.left = `${playheadTime * 100}%`;

    // Simulate querying state at this exact microsecond
    const stateMsg = playheadTime === 0.425
      ? "Querying kernel state at 42.5%... Checkpoint resolved instantly without replay."
      : `Scrubbed to ${(playheadTime * 100).toFixed(1)}%. State interpolated.`;

    $('status').textContent = stateMsg;
  }
};

/* ── INITIALIZATION ── */
try {
  DB = JSON.parse($('fs-data').textContent);
  $('status').textContent = 'Apache Arrow zero-copy bridge engaged ✓';
} catch (err) {
  $('status').textContent = '⚠ Could not parse #fs-data';
  console.error(err);
}

/* ── HELPERS ── */
function fmtSize(b) {
  if (!b) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ── RENDER ── */
function render() {
  if (!DB) return;
  const folder = DB[current];
  let items = [...folder.items];

  if (filter !== 'all') items = items.filter(i => i.type === filter || i.type === 'folder');
  if (query) items = items.filter(i => i.name.toLowerCase().includes(query.toLowerCase()));

  items.sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (b.type === 'folder' && a.type !== 'folder') return 1;
    if (sortKey === 'size') return b.size - a.size;
    if (sortKey === 'date') return new Date(b.date) - new Date(a.date);
    if (sortKey === 'type') return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });

  const filesContainer = $('files');
  filesContainer.className = 'files ' + view;
  /* Remove only .file nodes — #empty must survive (it lives inside #files) */
  filesContainer.querySelectorAll('.file').forEach(el => el.remove());
  $('empty').hidden = items.length > 0;

  const created = [];
  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'file' + (selected === item.id ? ' sel' : '');
    el.dataset.type = item.type;
    el.innerHTML =
      `<span class="f-icon">${ICONS[item.type]}</span>` +
      `<span class="f-name">${item.name}</span>` +
      `<span class="f-sub">${item.type === 'folder' ? 'Folder' : fmtSize(item.size)}</span>` +
      `<span class="f-date">${fmtDate(item.date)}</span>`;

    el.addEventListener('click', () => { selected = item.id; inspect(item); render(); });
    el.addEventListener('dblclick', () => { if (item.type === 'folder') goto(item.id); });
    filesContainer.appendChild(el);
    created.push(el);
  });

  // Apply Kernel.stagger for fluid learning entrance (on real DOM nodes)
  Kernel.stagger(created, 22);

  /* Path + Crumbs */
  const chain = [];
  let c = current;
  while (c) { chain.unshift(DB[c]); c = DB[c].parent; }
  $('path').textContent = '~/' + chain.map(f => f.name.toLowerCase()).join('/');

  const crumbs = $('crumbs');
  crumbs.innerHTML = '';
  chain.forEach((f, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      crumbs.appendChild(sep);
    }
    const b = document.createElement('button');
    b.className = 'crumb' + (i === chain.length - 1 ? ' here' : '');
    b.textContent = f.name;
    const key = Object.keys(DB).find(k => DB[k] === f);
    b.addEventListener('click', () => goto(key));
    crumbs.appendChild(b);
  });

  const total = Object.values(DB).reduce((n, f) => n + f.items.length, 0);
  $('file-count').textContent = total;
  $('status').textContent = `${items.length} item${items.length === 1 ? '' : 's'} in ${folder.name}`;
}

/* ── INSPECTOR ── */
function inspect(item) {
  $('insp-empty').hidden = true;
  $('insp-body').hidden = false;

  const preview = $('insp-preview');
  preview.textContent = ICONS[item.type];

  $('insp-name').textContent = item.name;
  $('insp-kind').textContent = KINDS[item.type];
  $('insp-size').textContent = item.type === 'folder' ? '—' : fmtSize(item.size);
  $('insp-date').textContent = fmtDate(item.date);
  $('insp-where').textContent = DB[current].name;
  $('insp-note').textContent = item.note;
}

function goto(id) {
  if (!DB || !DB[id]) return;
  current = id;
  selected = null;
  $('insp-empty').hidden = false;
  $('insp-body').hidden = true;
  document.querySelectorAll('[data-goto]').forEach(b => b.classList.toggle('active', b.dataset.goto === id));
  render();
}

/* ── CONTROLS & KERNEL TRIGGERS ── */
$('back').addEventListener('click', () => {
  const p = DB && DB[current].parent;
  if (p) goto(p);
});

$('search').addEventListener('input', e => { query = e.target.value; render(); });
$('sort').addEventListener('change', e => { sortKey = e.target.value; render(); });

document.querySelectorAll('.vt').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.vt').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    view = b.dataset.view;
    render();
  });
});

document.querySelectorAll('[data-goto]').forEach(b => {
  b.addEventListener('click', () => goto(b.dataset.goto));
});

document.querySelectorAll('[data-filter]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    filter = b.dataset.filter;
    render();
  });
});

// Kernel Action Buttons
$('btn-inject').addEventListener('click', () => {
  if (!selected) return;
  Kernel.set($('insp-body'), 'ava007 Context');
  $('insp-state').textContent = "Injected (0ms latency)";
  $('insp-note').textContent = `[gsap.set] Atomic pointer swap executed. ava007 context instantly shifted without thread locks.`;
});

$('btn-morph').addEventListener('click', () => {
  if (!selected) return;
  const item = DB[current].items.find(i => i.id === selected);
  Kernel.morph(item);
});

// Playhead Scrubbing (Deterministic State Auditing)
let isDragging = false;
const track = $('playhead-track');

const updatePlayhead = (e) => {
  const rect = track.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const progress = Math.max(0, Math.min(1, x / rect.width));
  Kernel.seek(progress);
};

track.addEventListener('mousedown', (e) => { isDragging = true; updatePlayhead(e); });
window.addEventListener('mousemove', (e) => { if (isDragging) updatePlayhead(e); });
window.addEventListener('mouseup', () => { isDragging = false; });

// Microsecond Clock
setInterval(() => {
  const now = new Date();
  $('clock').textContent = now.toISOString().split('T')[1].replace('Z', '');
}, 33); // ~30fps tick, mimicking GSAP ticker

// Initial Render — render first, then seek, so the playhead status wins
render();
Kernel.seek(playheadTime);
