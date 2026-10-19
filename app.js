(() => {
  'use strict';

  const COLORS = ['#3369e8', '#d50f25', '#eeb211', '#009925'];
  const DEFAULT_ENTRIES = ['Ali', 'Beatriz', 'Charles', 'Diya', 'Eric', 'Fatima', 'Gabriel', 'Hanna'];
  const STORAGE_KEY = 'wheel-state-v1';

  const $ = (id) => document.getElementById(id);
  const canvas = $('wheel');
  const ctx = canvas.getContext('2d');
  const entriesEl = $('entries');
  const resultsEl = $('results');
  const dialog = $('winner-dialog');
  const spinTimeEl = $('spin-time');

  const state = {
    rotation: 0,       // radians, current wheel rotation
    spinning: false,
    muted: false,
    results: [],
    lastWinnerIndex: -1,
  };

  // ---------- persistence ----------
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        entriesEl.value = saved.entries ?? DEFAULT_ENTRIES.join('\n');
        state.results = saved.results ?? [];
        state.muted = !!saved.muted;
        spinTimeEl.value = saved.spinTime ?? 6;
        return;
      }
    } catch {}
    entriesEl.value = DEFAULT_ENTRIES.join('\n');
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        entries: entriesEl.value,
        results: state.results,
        muted: state.muted,
        spinTime: Number(spinTimeEl.value),
      }));
    } catch {}
  }

  // ---------- URL parameters ----------
  // Supported:
  //   ?names=Ali,Bea,Charles       comma-separated entries
  //   ?name=Smith, John&name=Bea   repeated, for entries that contain commas
  //   &title=Team%20Picker         heading + tab title
  //   &spin=10                     spin time in seconds (2–20)
  function readUrlParams() {
    const params = new URLSearchParams(location.search);
    const entries = [
      ...params.getAll('names').flatMap((v) => v.split(',')),
      ...params.getAll('name'),
    ].map((s) => s.trim()).filter(Boolean);

    if (entries.length) entriesEl.value = entries.join('\n');

    const title = params.get('title')?.trim();
    if (title) setTitle(title);

    const spinTime = Number(params.get('spin'));
    if (spinTime >= 2 && spinTime <= 20) spinTimeEl.value = Math.round(spinTime);

    return entries.length > 0;
  }

  function setTitle(title) {
    $('wheel-title').textContent = title;
    document.title = title;
  }

  function buildShareUrl() {
    const entries = getEntries();
    const params = new URLSearchParams();
    if (entries.some((e) => e.includes(','))) entries.forEach((e) => params.append('name', e));
    else if (entries.length) params.set('names', entries.join(','));
    const title = $('wheel-title').textContent;
    if (title !== 'Wheel Spinner') params.set('title', title);
    if (spinTimeEl.value !== '6') params.set('spin', spinTimeEl.value);
    const url = new URL(location.href);
    url.search = params.toString();
    url.hash = '';
    return url.toString();
  }

  async function shareLink() {
    const url = buildShareUrl();
    const btn = $('btn-share');
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Copied!';
    } catch {
      prompt('Copy this link:', url);
    }
    setTimeout(() => { btn.textContent = 'Share link'; }, 1500);
  }

  function getEntries() {
    return entriesEl.value.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  // ---------- drawing ----------
  function textColorFor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1d1f24' : '#ffffff';
  }

  function draw() {
    const entries = getEntries();
    const size = canvas.width;
    const c = size / 2;
    const radius = c - 6;
    ctx.clearRect(0, 0, size, size);

    if (entries.length === 0) {
      ctx.beginPath();
      ctx.arc(c, c, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ccc';
      ctx.fill();
      return;
    }

    const arc = (Math.PI * 2) / entries.length;
    // Avoid two adjacent slices sharing a color when count % palette === 1.
    const palette = entries.length % COLORS.length === 1 && entries.length > 1
      ? [...COLORS, '#8e44ad'] : COLORS;
    const fontSize = Math.max(12, Math.min(48, (radius * arc) / 2.2, 900 / entries.length));

    entries.forEach((label, i) => {
      const start = state.rotation + i * arc;
      const color = palette[i % palette.length];

      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, radius, start, start + arc);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      if (entries.length > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(start + arc / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = textColorFor(color);
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      const maxWidth = radius * 0.72;
      let text = label;
      while (ctx.measureText(text).width > maxWidth && text.length > 1) text = text.slice(0, -1);
      if (text !== label) text = text.slice(0, -1) + '…';
      ctx.fillText(text, radius - 20, 0);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  // Index of the slice currently under the pointer (pointer sits at angle 0, i.e. 3 o'clock).
  function indexAtPointer(count) {
    const arc = (Math.PI * 2) / count;
    const a = ((-state.rotation) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(a / arc) % count;
  }

  // ---------- sound ----------
  let audioCtx;
  function tick() {
    if (state.muted) return;
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 900;
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.04);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
  }

  function fanfare() {
    if (state.muted || !audioCtx) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      const t = audioCtx.currentTime + i * 0.12;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.45);
    });
  }

  // ---------- spin ----------
  const easeOut = (t) => 1 - Math.pow(1 - t, 4);

  function spin() {
    const entries = getEntries();
    if (state.spinning || entries.length === 0) return;
    state.spinning = true;
    entriesEl.disabled = true;

    const duration = Number(spinTimeEl.value) * 1000;
    const start = state.rotation;
    // Uniformly random final angle, plus several full turns scaled to duration.
    const turns = Math.max(3, Math.round(duration / 1000) * 1.5);
    const delta = turns * Math.PI * 2 + Math.random() * Math.PI * 2;
    const t0 = performance.now();
    let lastIndex = indexAtPointer(entries.length);

    function frame(now) {
      const t = Math.min(1, (now - t0) / duration);
      state.rotation = start + delta * easeOut(t);
      draw();
      const idx = indexAtPointer(entries.length);
      if (idx !== lastIndex) { tick(); lastIndex = idx; }
      if (t < 1) requestAnimationFrame(frame);
      else finish(entries);
    }
    requestAnimationFrame(frame);
  }

  function finish(entries) {
    state.spinning = false;
    entriesEl.disabled = false;
    state.rotation %= Math.PI * 2;
    const idx = indexAtPointer(entries.length);
    const winner = entries[idx];
    state.lastWinnerIndex = idx;
    state.results.unshift(winner);
    renderResults();
    save();

    $('winner-name').textContent = winner;
    $('btn-remove').hidden = entries.length <= 1;
    dialog.showModal();
    fanfare();
    confetti();
  }

  function removeWinner() {
    const lines = entriesEl.value.split('\n');
    // Map the winning entry index back to its raw textarea line.
    let n = -1;
    const lineIdx = lines.findIndex((l) => l.trim() && ++n === state.lastWinnerIndex);
    if (lineIdx >= 0) lines.splice(lineIdx, 1);
    entriesEl.value = lines.join('\n');
    onEntriesChanged();
    dialog.close();
  }

  // ---------- confetti ----------
  const confettiCanvas = $('confetti');
  const cctx = confettiCanvas.getContext('2d');
  function confetti() {
    confettiCanvas.width = innerWidth;
    confettiCanvas.height = innerHeight;
    const pieces = Array.from({ length: 180 }, () => ({
      x: innerWidth / 2,
      y: innerHeight / 3,
      vx: (Math.random() - 0.5) * 18,
      vy: Math.random() * -16 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
    const t0 = performance.now();
    (function step(now) {
      cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      pieces.forEach((p) => {
        p.vy += 0.4; p.vx *= 0.99;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        cctx.save();
        cctx.translate(p.x, p.y);
        cctx.rotate(p.r);
        cctx.fillStyle = p.color;
        cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        cctx.restore();
      });
      if (now - t0 < 4000) requestAnimationFrame(step);
      else cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    })(t0);
  }

  // ---------- UI ----------
  function renderResults() {
    resultsEl.innerHTML = '';
    state.results.forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      resultsEl.appendChild(li);
    });
    $('count-results').textContent = state.results.length;
  }

  function onEntriesChanged() {
    $('count-entries').textContent = getEntries().length;
    draw();
    save();
  }

  function setEntries(list) {
    entriesEl.value = list.join('\n');
    onEntriesChanged();
  }

  function updateMuteIcon() { $('btn-mute').textContent = state.muted ? '🔇' : '🔊'; }

  canvas.addEventListener('click', spin);
  $('hub').addEventListener('click', spin);
  entriesEl.addEventListener('input', onEntriesChanged);

  $('btn-shuffle').addEventListener('click', () => {
    const list = getEntries();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    setEntries(list);
  });
  $('btn-sort').addEventListener('click', () =>
    setEntries(getEntries().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))));
  $('btn-clear').addEventListener('click', () => { if (confirm('Clear all entries?')) setEntries([]); });
  $('btn-clear-results').addEventListener('click', () => { state.results = []; renderResults(); save(); });

  $('btn-close').addEventListener('click', () => dialog.close());
  $('btn-remove').addEventListener('click', removeWinner);

  $('btn-mute').addEventListener('click', () => { state.muted = !state.muted; updateMuteIcon(); save(); });
  $('btn-fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });

  spinTimeEl.addEventListener('input', () => {
    $('spin-time-label').textContent = `${spinTimeEl.value}s`;
    save();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('panel-entries').classList.toggle('hidden', tab.dataset.tab !== 'entries');
      $('panel-results').classList.toggle('hidden', tab.dataset.tab !== 'results');
    });
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); spin(); }
  });

  $('btn-share').addEventListener('click', shareLink);

  load();
  // A shared link's entries replace whatever this browser had saved.
  if (readUrlParams()) state.results = [];
  $('spin-time-label').textContent = `${spinTimeEl.value}s`;
  updateMuteIcon();
  renderResults();
  onEntriesChanged();
})();
