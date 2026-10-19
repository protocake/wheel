(() => {
  'use strict';

  const SKINS = window.WHEEL_SKINS;
  const DEFAULT_SKIN = window.WHEEL_DEFAULT_SKIN;
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
    winnerMode: 'stay', // 'stay': winners can come up again; 'leave': winners come off the wheel
    pendingRemoval: false,
    skin: document.documentElement.dataset.skin in SKINS ? document.documentElement.dataset.skin : DEFAULT_SKIN,
  };
  const skin = () => SKINS[state.skin];

  // ---------- persistence ----------
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        entriesEl.value = saved.entries ?? DEFAULT_ENTRIES.join('\n');
        state.results = saved.results ?? [];
        state.muted = !!saved.muted;
        spinTimeEl.value = saved.spinTime ?? 6;
        if (saved.winnerMode === 'leave') state.winnerMode = 'leave';
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
        skin: state.skin,
        winnerMode: state.winnerMode,
      }));
    } catch {}
  }

  // ---------- URL parameters ----------
  // Supported:
  //   ?names=Ali,Bea,Charles       comma-separated entries
  //   ?name=Smith, John&name=Bea   repeated, for entries that contain commas
  //   &title=Team%20Picker         heading + tab title
  //   &spin=10                     spin time in seconds (2–20)
  //   &skin=sticker                one of the ids in skins.js (applied in index.html before first paint)
  //   &remove=1                    winners leave the wheel after each spin (remove=0 keeps them)
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

    const remove = params.get('remove');
    if (remove !== null) state.winnerMode = /^(1|true|yes)$/i.test(remove) ? 'leave' : 'stay';

    return entries.length > 0;
  }

  function setTitle(title) {
    $('wheel-title').textContent = title;
    document.title = title;
    fitTitle();
  }

  // Shrink a long title to fit the header instead of cutting it off. If one line would get
  // too small (narrow phones), let it wrap onto a second line and keep shrinking from there.
  function fitTitle() {
    const h1 = $('wheel-title');
    h1.classList.remove('wrap');
    h1.style.fontSize = '';
    let px = parseFloat(getComputedStyle(h1).fontSize);
    while (h1.scrollWidth > h1.clientWidth && px > 13) {
      px = Math.max(13, px * Math.min(0.95, h1.clientWidth / h1.scrollWidth));
      h1.style.fontSize = `${px}px`;
    }
    if (h1.scrollWidth <= h1.clientWidth) return;
    h1.classList.add('wrap');
    while (h1.scrollHeight > h1.clientHeight + 1 && px > 9) {
      px = Math.max(9, px * 0.92);
      h1.style.fontSize = `${px}px`;
    }
  }

  function buildShareUrl() {
    const entries = getEntries();
    const params = new URLSearchParams();
    if (entries.some((e) => e.includes(','))) entries.forEach((e) => params.append('name', e));
    else if (entries.length) params.set('names', entries.join(','));
    const title = $('wheel-title').textContent;
    if (title !== 'Wheel Spinner') params.set('title', title);
    if (spinTimeEl.value !== '6') params.set('spin', spinTimeEl.value);
    if (state.skin !== DEFAULT_SKIN) params.set('skin', state.skin);
    if (state.winnerMode === 'leave') params.set('remove', '1');
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
  function textColorFor(hex, dark) {
    const n = parseInt(hex.slice(1), 16);
    const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? dark : '#ffffff';
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const resolve = (color) => (color.startsWith('--') ? cssVar(color) : color);

  function circle(c, r) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
  }

  function sliceColor(colors, i, n) {
    // Don't let the last slice match the first one it wraps around to.
    if (n > 1 && i === n - 1 && i % colors.length === 0) return colors[2 % colors.length];
    return colors[i % colors.length];
  }

  // Pointed lotus petals around the outside of the wheel (Mandala).
  function drawPetals(c, outer, inner, p) {
    const step = (Math.PI * 2) / p.count;
    const half = inner * Math.sin(step / 2) * 1.15;
    ctx.lineWidth = canvas.width * 0.0035;
    ctx.strokeStyle = p.stroke;
    ctx.lineJoin = 'round';
    for (let i = 0; i < p.count; i++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(state.rotation + i * step + step / 2);
      const base = inner - half * 0.4;
      const ctrl = base + (outer - base) * 0.55;
      ctx.beginPath();
      ctx.moveTo(base, -half);
      ctx.quadraticCurveTo(ctrl, -half, outer, 0);
      ctx.quadraticCurveTo(ctrl, half, base, half);
      ctx.closePath();
      ctx.fillStyle = p.colors[i % p.colors.length];
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // Heart with its point at +y, sized to roughly r.
  function heartPath(g, r) {
    g.beginPath();
    g.moveTo(0, r * 0.8);
    g.bezierCurveTo(-r * 1.25, 0, -r * 0.6, -r * 1.05, 0, -r * 0.35);
    g.bezierCurveTo(r * 0.6, -r * 1.05, r * 1.25, 0, 0, r * 0.8);
    g.closePath();
  }

  function drawPeg(shape, x, y, r, angle, color, center) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    if (shape === 'dot') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'heart') {
      ctx.rotate(Math.PI / 2); // point the heart at the hub
      heartPath(ctx, r);
      ctx.fill();
    } else if (shape === 'flower') {
      for (let k = 0; k < 5; k++) {
        ctx.save();
        ctx.rotate((k * Math.PI * 2) / 5);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.62, r * 0.42, r * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = center;
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    const s = skin();
    const entries = getEntries();
    const n = entries.length;
    const size = canvas.width;
    const c = size / 2;
    ctx.clearRect(0, 0, size, size);

    let outer = c - 2;
    if (s.petals) {
      const inner = outer - size * s.petals.depth;
      drawPetals(c, outer, inner, s.petals);
      outer = inner;
    }

    // Rim
    const rimWidth = size * s.rim.width;
    circle(c, outer);
    ctx.fillStyle = resolve(s.rim.color);
    ctx.fill();
    if (s.rim.stroke) {
      const w = size * s.rim.strokeWidth;
      circle(c, outer - w / 2);
      ctx.lineWidth = w;
      ctx.strokeStyle = s.rim.stroke;
      ctx.stroke();
    }
    const radius = outer - rimWidth;
    if (s.rim.stitch) {
      circle(c, outer - rimWidth * 0.5);
      ctx.lineWidth = size * 0.003;
      ctx.strokeStyle = s.rim.stitch;
      ctx.setLineDash([size * 0.012, size * 0.009]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (s.rim.inner) {
      circle(c, radius + size * 0.002);
      ctx.lineWidth = size * 0.005;
      ctx.strokeStyle = s.rim.inner;
      ctx.stroke();
    }
    if (s.paper) {
      circle(c, radius);
      ctx.fillStyle = s.paper;
      ctx.fill();
    }

    if (n === 0) {
      circle(c, radius);
      ctx.fillStyle = cssVar('--line');
      ctx.fill();
      ctx.fillStyle = cssVar('--muted');
      ctx.font = `500 ${size * 0.032}px ${cssVar('--font-body')}`;
      ctx.textAlign = 'center';
      ctx.fillText('Add names to fill the wheel', c, c + size * 0.15);
      return;
    }

    const arc = (Math.PI * 2) / n;

    // Slices
    ctx.globalAlpha = s.sliceAlpha ?? 1;
    entries.forEach((_, i) => {
      const start = state.rotation + i * arc;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, radius, start, start + arc);
      ctx.closePath();
      ctx.fillStyle = sliceColor(s.colors, i, n);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (s.separators && n > 1) {
      ctx.lineWidth = size * s.separators.width;
      ctx.strokeStyle = s.separators.color;
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const a = state.rotation + i * arc;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + Math.cos(a) * radius, c + Math.sin(a) * radius);
        ctx.stroke();
      }
    }
    if (s.innerRing) {
      circle(c, radius * s.innerRing.at);
      ctx.lineWidth = size * s.innerRing.width;
      ctx.strokeStyle = s.innerRing.color;
      ctx.stroke();
    }
    if (s.gloss) {
      const g = ctx.createRadialGradient(c - radius * 0.32, c - radius * 0.5, 0, c - radius * 0.32, c - radius * 0.5, radius * 0.95);
      g.addColorStop(0, 'rgba(255,255,255,.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      circle(c, radius);
      ctx.fillStyle = g;
      ctx.fill();
    }
    if (s.discStroke) {
      circle(c, radius);
      ctx.lineWidth = size * s.discStroke.width;
      ctx.strokeStyle = s.discStroke.color;
      ctx.stroke();
    }

    // Labels. Sized in canvas pixels, but never under ~11px on screen
    // (small phones scale the canvas down a lot).
    const screenScale = size / (canvas.clientWidth || size);
    const arcLimit = (radius * arc) / 2.2;
    const base = Math.min(34, (radius * arc) / 2.6, 640 / n) * s.label.scale;
    const fontSize = Math.min(arcLimit * s.label.scale, Math.max(11 * screenScale * s.label.scale, base));
    const labelFont = (px) => `${s.label.weight} ${px}px "${s.label.family}", ${cssVar('--font-body')}`;
    // Long names shrink to fit their slice, down to about 8px on screen, before being cut short.
    const minFontSize = Math.min(fontSize, 8 * screenScale);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const maxWidth = radius * 0.66;
    entries.forEach((label, i) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(state.rotation + i * arc + arc / 2);
      ctx.fillStyle = s.labelColor || textColorFor(sliceColor(s.colors, i, n), s.darkText);
      ctx.font = labelFont(fontSize);
      const width = ctx.measureText(label).width;
      if (width > maxWidth) ctx.font = labelFont(Math.max(minFontSize, (fontSize * maxWidth) / width));
      let text = label;
      if (ctx.measureText(text).width > maxWidth) {
        while (ctx.measureText(text + '…').width > maxWidth && text.length > 1) text = text.slice(0, -1);
        text += '…';
      }
      ctx.fillText(text, radius - size * 0.035, 0);
      ctx.restore();
    });

    // Pegs on the rim at each slice boundary (skipped when they'd crowd together).
    if (s.pegs && n > 1 && n <= 80) {
      const ringR = radius + rimWidth / 2;
      const pegR = s.pegs.shape === 'dot'
        ? Math.min(rimWidth * 0.32, (outer * arc) / 5)
        : Math.min(rimWidth * 0.48, (outer * arc) / 3);
      const colors = s.pegs.colors.map(resolve);
      for (let i = 0; i < n; i++) {
        const a = state.rotation + i * arc;
        drawPeg(s.pegs.shape, c + Math.cos(a) * ringR, c + Math.sin(a) * ringR, pegR, a, colors[i % colors.length], s.pegs.center);
      }
    }
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

  // Kick the pointer up as a peg passes it.
  const pointerEl = $('pointer');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function flap() {
    if (reduceMotion.matches) return;
    pointerEl.animate(
      [{ transform: 'rotate(-22deg)' }, { transform: 'rotate(0deg)' }],
      { duration: 140, easing: 'ease-out' },
    );
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
      if (idx !== lastIndex) { tick(); flap(); lastIndex = idx; }
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

    // Never empty the wheel: the last name stays even in "leave" mode.
    const canRemove = entries.length > 1;
    state.pendingRemoval = state.winnerMode === 'leave' && canRemove;
    $('winner-name').textContent = winner;
    $('winner-note').hidden = !state.pendingRemoval;
    $('btn-keep').hidden = !state.pendingRemoval;
    $('btn-remove').hidden = state.winnerMode === 'leave' || !canRemove;
    $('btn-close').hidden = state.pendingRemoval;
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
      color: skin().colors[Math.floor(Math.random() * skin().colors.length)],
    }));
    const shape = skin().confetti;
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
        if (shape === 'hearts') {
          heartPath(cctx, p.w);
          cctx.fill();
        } else if (shape === 'petals') {
          cctx.beginPath();
          cctx.ellipse(0, 0, p.w * 0.6, p.h * 0.75, 0, 0, Math.PI * 2);
          cctx.fill();
        } else {
          cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
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
    $('results-empty').hidden = state.results.length > 0;
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

  function applySkin(id) {
    if (!SKINS[id]) return;
    state.skin = id;
    const s = skin();
    document.documentElement.dataset.skin = id;
    $('skin').value = id;
    $('hub').textContent = s.hub;
    const hint = document.querySelector('.hint-skin');
    hint.textContent = s.hint ?? '';
    hint.hidden = !s.hint;
    document.querySelector('.hint-mouse').hidden = !!s.hint;
    document.querySelector('.hint-touch').hidden = !!s.hint;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = cssVar('--bg'); });

    const fonts = $('skin-fonts');
    const href = `https://fonts.googleapis.com/css2?${s.fonts}&display=swap`;
    const redrawWhenReady = () => {
      document.fonts?.load(`${s.label.weight} 40px "${s.label.family}"`).then(draw, draw);
      document.fonts?.ready.then(fitTitle);
    };
    if (fonts.href !== href) {
      fonts.addEventListener('load', redrawWhenReady, { once: true });
      fonts.href = href;
    } else {
      redrawWhenReady();
    }
    draw();
    fitTitle();
    save();
  }

  function updateMuteIcon() {
    const btn = $('btn-mute');
    btn.setAttribute('aria-pressed', String(state.muted));
    btn.title = btn.ariaLabel = state.muted ? 'Unmute sound' : 'Mute sound';
  }

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

  // In "leave" mode the winner comes off however the dialog closes (button, Esc, Spin again),
  // unless "Keep on wheel" cancelled it.
  dialog.addEventListener('close', () => {
    if (state.pendingRemoval) removeWinner();
    state.pendingRemoval = false;
  });
  $('btn-close').addEventListener('click', () => dialog.close());
  $('btn-remove').addEventListener('click', () => { removeWinner(); dialog.close(); });
  $('btn-keep').addEventListener('click', () => { state.pendingRemoval = false; dialog.close(); });
  $('btn-again').addEventListener('click', () => {
    // The dialog's close event fires asynchronously, so remove now, before the next spin starts.
    if (state.pendingRemoval) removeWinner();
    state.pendingRemoval = false;
    dialog.close();
    spin();
  });
  $('winner-mode').addEventListener('change', (e) => { state.winnerMode = e.target.value; save(); });

  $('btn-mute').addEventListener('click', () => { state.muted = !state.muted; updateMuteIcon(); save(); });
  $('btn-fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });

  spinTimeEl.addEventListener('input', () => {
    $('spin-time-label').textContent = `${spinTimeEl.value} s`;
    save();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      $('panel-entries').hidden = tab.dataset.tab !== 'entries';
      $('panel-results').hidden = tab.dataset.tab !== 'results';
    });
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); spin(); }
  });

  $('btn-share').addEventListener('click', shareLink);

  Object.entries(SKINS).forEach(([id, s]) => $('skin').add(new Option(s.name, id)));
  $('skin').addEventListener('change', (e) => applySkin(e.target.value));

  if (!document.fullscreenEnabled) $('btn-fullscreen').hidden = true;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
  new ResizeObserver(() => { if (!state.spinning) draw(); }).observe(canvas);
  document.fonts?.ready.then(() => { draw(); fitTitle(); });
  new ResizeObserver(fitTitle).observe(document.querySelector('.topbar'));

  load();
  // A shared link's entries replace whatever this browser had saved.
  if (readUrlParams()) state.results = [];
  $('spin-time-label').textContent = `${spinTimeEl.value} s`;
  updateMuteIcon();
  $('winner-mode').value = state.winnerMode;
  renderResults();
  onEntriesChanged();
  applySkin(state.skin);
})();
