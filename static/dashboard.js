

// ── Config ────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:5000';

// ── Global state ──────────────────────────────────────────────────
let G         = {};
let VIEW      = { start: null, end: null };
let ZOOM      = { scale: 1, offset: 0 };
let ANOMALIES = [];   // fetched from /api/anomalies
let CMP_IDS   = [];   // lemon IDs selected for comparison chart

// ── Colors ────────────────────────────────────────────────────────
const C = {
  accent:  '#C8E028',
  accent2: '#F5C842',
  accent3: '#6DCFA0',
  muted2:  '#2E3D2E',
  gridC:   '#1A2318',
  text:    '#E8EDE8',
  muted:   '#6B7F6B',
};

// LOADING
function setLoading(pct, msg) {
  document.getElementById('loading-bar').style.width = pct + '%';
  document.getElementById('loading-status').textContent = msg;
}
function hideLoading() {
  const s = document.getElementById('loading-screen');
  s.classList.add('done');
  setTimeout(() => s.remove(), 500);
}

// FETCH
async function fetchAndRender() {
  setLoading(20, 'Connecting to server…');
  try {
    setLoading(40, 'Fetching measurements…');
    const res = await fetch(`${API_BASE}/api/data`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    setLoading(70, 'Processing data…');
    G = await res.json();
    ZOOM = { scale: 1, offset: 0 };
    // Fetch anomalies in parallel
    try {
      const ar = await fetch(`${API_BASE}/api/anomalies`);
      const ad = await ar.json();
      ANOMALIES = ad.anomalies || [];
    } catch(_) { ANOMALIES = []; }
    setLoading(90, 'Rendering…');
    initView();
    setLoading(100, 'Done');
    setTimeout(hideLoading, 300);
  } catch (err) {
    setLoading(100, 'Error');
    showError(err.message);
    hideLoading();
  }
}

function showError(msg) {
  const b = document.getElementById('error-banner');
  b.style.display = 'block';
  b.innerHTML = `⚠ Could not reach backend: <strong>${msg}</strong><br>
    <span style="opacity:0.7">Make sure <code>python server.py</code> is running at ${API_BASE}</span>`;
  document.getElementById('status-pill').classList.add('error');
  document.getElementById('status-text').textContent = 'Offline';
}

// VIEW / FILTER HELPERS
const allDates     = () => G.fleet_daily.map(d => d.date);
const firstDate    = () => allDates()[0];
const lastDate     = () => allDates().at(-1);
const filteredFleet = () => G.fleet_daily.filter(d => d.date >= VIEW.start && d.date <= VIEW.end);
const filteredLemon = lid => (G.lemon_daily[lid] || []).filter(p => p.date >= VIEW.start && p.date <= VIEW.end);

function arrMedian(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}

function filteredSummary() {
  const fleet = filteredFleet();
  if (!fleet.length) return null;
  const last = fleet.at(-1);
  const prev = fleet.length > 1 ? fleet.at(-2) : last;
  return {
    lemons_today:    last.count,
    lemons_delta:    last.count - prev.count,
    median_diameter: +last.median.toFixed(2),
    diameter_delta:  +(last.median - prev.median).toFixed(2),
    days_monitored:  fleet.length,
    date_range:      `${VIEW.start} → ${VIEW.end}`,
    avg_confidence:  G.summary.avg_confidence,
    measurements:    G.summary.measurements,
    latest_date:     last.date,
  };
}

// INIT — runs once after first fetch
function initView() {
  const m = G._meta;
  document.getElementById('data-source').textContent = m.source;
  document.getElementById('current-date').textContent =
    new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'long', year:'numeric' });
  if (m.source === 'mock') document.getElementById('mock-banner').style.display = 'block';

  VIEW.start = firstDate();
  VIEW.end   = lastDate();

  const sel = document.getElementById('lemon-select');
  sel.innerHTML = '';
  G.lemon_ids.forEach(lid => {
    const o = document.createElement('option');
    o.value = lid; o.textContent = `Lemon #${lid}`;
    sel.appendChild(o);
  });
  sel.onchange = () => drawChart2(+sel.value);

  // Init comparison multi-select
  buildComparisonSelect();

  buildTimeControls();
  redrawAll();
  // Register wheel/drag interactions ONCE after charts exist in the DOM
  initChartInteractions();
}

// REDRAW ALL
function redrawAll() {
  const fleet = filteredFleet();
  const lid   = +document.getElementById('lemon-select').value;
  const s     = filteredSummary();
  if (!s) return;

  setKpi('kpi-count', s.lemons_today, '',
    `${s.lemons_delta >= 0 ? '+' : ''}${s.lemons_delta} vs prev day`, s.lemons_delta < 0);
  setKpi('kpi-diam', s.median_diameter.toFixed(2), 'cm',
    `${s.diameter_delta >= 0 ? '+' : ''}${s.diameter_delta.toFixed(2)} cm vs prev day`, s.diameter_delta < 0);
  setKpi('kpi-days', s.days_monitored, '', s.date_range, false);
  setKpi('kpi-conf', (s.avg_confidence * 100).toFixed(1), '%',
    `${s.measurements.toLocaleString()} total measurements`, false);

  updateMinimapSelection();
  drawChart1(fleet);
  drawChart2(lid);
  drawChart3FromWindow();
  drawChart4(fleet);
  drawComparisonChart();
  drawAnomalyPanel();
}

function setKpi(id, val, unit, delta, isNeg) {
  const el = document.getElementById(id);
  if (el) el.childNodes[0].textContent = val;
  const d = document.getElementById(id + '-d');
  if (d) { d.textContent = delta; d.className = 'kpi-delta' + (isNeg ? ' neg' : ''); }
}

function drawChart3FromWindow() {
  const fleet = filteredFleet();
  if (!fleet.length) return;
  const latestDate = fleet.at(-1).date;
  const diams = [];
  Object.values(G.lemon_daily).forEach(rows =>
    rows.forEach(r => { if (r.date === latestDate) diams.push(r.median); }));
  if (diams.length) drawChart3(diams, latestDate);
}


// TIME CONTROLS
function buildTimeControls() {
  const container = document.getElementById('time-controls');
  if (!container) return;
  const dates = allDates();
  const first = dates[0], last = dates.at(-1);

  container.innerHTML = `
    <div class="tc-row">
      <div class="tc-group">
        <span class="tc-label">Quick range</span>
        <div class="tc-presets">
          <button class="preset-btn" data-days="7">7d</button>
          <button class="preset-btn" data-days="14">14d</button>
          <button class="preset-btn" data-days="30">30d</button>
          <button class="preset-btn active" data-days="all">All</button>
        </div>
      </div>
      <div class="tc-group">
        <span class="tc-label">From</span>
        <input type="date" id="date-from" value="${first}" min="${first}" max="${last}" class="date-input">
      </div>
      <div class="tc-group">
        <span class="tc-label">To</span>
        <input type="date" id="date-to" value="${last}" min="${first}" max="${last}" class="date-input">
      </div>
      <div class="tc-group tc-zoom">
        <span class="tc-label">Zoom</span>
        <button class="zoom-btn" id="zoom-out">−</button>
        <span class="zoom-level" id="zoom-level">1×</span>
        <button class="zoom-btn" id="zoom-in">+</button>
        <button class="zoom-btn zoom-reset-btn" id="zoom-reset">↺</button>
      </div>
      <div class="tc-group tc-pan">
        <span class="tc-label">Pan</span>
        <button class="zoom-btn" id="pan-left">◀</button>
        <button class="zoom-btn" id="pan-right">▶</button>
      </div>
      <div class="tc-range-badge" id="tc-range-text">${first} → ${last}</div>
    </div>
    <div class="minimap-wrap">
      <div class="minimap-label">Timeline overview — drag handles to adjust range</div>
      <div class="minimap-track" id="minimap-track">
        <canvas id="minimap-canvas" height="40"></canvas>
        <div class="minimap-selection" id="minimap-sel"></div>
        <div class="minimap-handle left"  id="mm-handle-l"></div>
        <div class="minimap-handle right" id="mm-handle-r"></div>
      </div>
    </div>`;

  drawMinimap();

  // Date pickers
  document.getElementById('date-from').addEventListener('change', e => {
    VIEW.start = e.target.value;
    if (VIEW.start > VIEW.end) VIEW.end = VIEW.start;
    document.getElementById('date-to').value = VIEW.end;
    clearActivePreset(); updateRangeLabel(); redrawAll();
  });
  document.getElementById('date-to').addEventListener('change', e => {
    VIEW.end = e.target.value;
    if (VIEW.end < VIEW.start) VIEW.start = VIEW.end;
    document.getElementById('date-from').value = VIEW.start;
    clearActivePreset(); updateRangeLabel(); redrawAll();
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const days = btn.dataset.days;
      if (days === 'all') {
        VIEW.start = first; VIEW.end = last;
      } else {
        const n = parseInt(days);
        VIEW.end   = last;
        VIEW.start = dates[Math.max(0, dates.length - n)];
      }
      document.getElementById('date-from').value = VIEW.start;
      document.getElementById('date-to').value   = VIEW.end;
      ZOOM = { scale: 1, offset: 0 };
      updateRangeLabel(); updateZoomLabel(); syncCursors(); redrawAll();
    });
  });

  // Zoom
  document.getElementById('zoom-in').addEventListener('click', () => {
    ZOOM.scale = Math.min(ZOOM.scale * 1.5, 20);
    clampZoom(); updateZoomLabel(); syncCursors(); redrawAll();
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    ZOOM.scale = Math.max(ZOOM.scale / 1.5, 1);
    clampZoom(); updateZoomLabel(); syncCursors(); redrawAll();
  });
  document.getElementById('zoom-reset').addEventListener('click', () => {
    ZOOM = { scale: 1, offset: 0 };
    updateZoomLabel(); syncCursors(); redrawAll();
  });

  // Pan
  document.getElementById('pan-left').addEventListener('click',  () => panBy(-0.12));
  document.getElementById('pan-right').addEventListener('click', () => panBy(+0.12));

  initMinimapDrag();
}

function clearActivePreset() { document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active')); }
function updateRangeLabel()  { const e = document.getElementById('tc-range-text'); if (e) e.textContent = `${VIEW.start} → ${VIEW.end}`; }
function updateZoomLabel()   { const e = document.getElementById('zoom-level');    if (e) e.textContent = ZOOM.scale <= 1 ? '1×' : `${ZOOM.scale.toFixed(1)}×`; }
function clampZoom()         { ZOOM.offset = Math.max(0, Math.min(1 - 1/ZOOM.scale, ZOOM.offset)); }
function panBy(d) { ZOOM.offset = Math.max(0, Math.min(1 - 1/ZOOM.scale, ZOOM.offset + d / ZOOM.scale)); scheduleRedraw(); }

// ── Minimap ────────────────────────────────────────────────────────
function drawMinimap() {
  const canvas = document.getElementById('minimap-canvas');
  const track  = document.getElementById('minimap-track');
  if (!canvas || !track) return;
  const W = track.getBoundingClientRect().width || 800;
  canvas.width = W;
  const fleet  = G.fleet_daily;
  const maxC   = Math.max(...fleet.map(d => d.count));
  const h = 40, bw = W / fleet.length;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, h);
  fleet.forEach((d, i) => {
    const barH  = ((d.count / maxC) * (h - 8)) + 4;
    const inView = d.date >= VIEW.start && d.date <= VIEW.end;
    ctx.fillStyle = inView ? 'rgba(200,224,40,0.55)' : 'rgba(200,224,40,0.1)';
    ctx.fillRect(i * bw, h - barH, Math.max(1, bw - 0.5), barH);
  });
  updateMinimapSelection();
}

function updateMinimapSelection() {
  const sel   = document.getElementById('minimap-sel');
  const track = document.getElementById('minimap-track');
  const hl    = document.getElementById('mm-handle-l');
  const hr    = document.getElementById('mm-handle-r');
  if (!sel || !track) return;
  const dates = allDates();
  const W     = track.getBoundingClientRect().width || 800;
  const total = dates.length;
  const iS    = Math.max(0, dates.indexOf(VIEW.start));
  const iE    = Math.max(0, dates.indexOf(VIEW.end));
  const xL    = (iS / total) * W;
  const xR    = ((iE + 1) / total) * W;
  sel.style.left  = xL + 'px';
  sel.style.width = Math.max(2, xR - xL) + 'px';
  if (hl) hl.style.left = (xL - 5) + 'px';
  if (hr) hr.style.left = (xR - 5) + 'px';

  // Redraw canvas bars with updated colors
  const canvas = document.getElementById('minimap-canvas');
  if (!canvas) return;
  const fleet = G.fleet_daily;
  const maxC  = Math.max(...fleet.map(d => d.count));
  const h = 40, bw = W / fleet.length;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, h);
  fleet.forEach((d, i) => {
    const barH  = ((d.count / maxC) * (h - 8)) + 4;
    const inView = d.date >= VIEW.start && d.date <= VIEW.end;
    ctx.fillStyle = inView ? 'rgba(200,224,40,0.55)' : 'rgba(200,224,40,0.1)';
    ctx.fillRect(i * bw, h - barH, Math.max(1, bw - 0.5), barH);
  });
}

function initMinimapDrag() {
  const track = document.getElementById('minimap-track');
  const hl    = document.getElementById('mm-handle-l');
  const hr    = document.getElementById('mm-handle-r');
  if (!track) return;
  const dates = allDates();

  function dateAtX(clientX) {
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(0.9999, (clientX - rect.left) / rect.width));
    return dates[Math.min(dates.length - 1, Math.floor(frac * dates.length))];
  }

  function makeHandleDrag(isLeft) {
    return e => {
      e.preventDefault();
      const onMove = ev => {
        const d = dateAtX(ev.clientX);
        if (isLeft) {
          VIEW.start = d <= VIEW.end ? d : VIEW.end;
          document.getElementById('date-from').value = VIEW.start;
        } else {
          VIEW.end = d >= VIEW.start ? d : VIEW.start;
          document.getElementById('date-to').value = VIEW.end;
        }
        clearActivePreset(); updateRangeLabel(); redrawAll();
      };
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
  }

  if (hl) hl.addEventListener('mousedown', makeHandleDrag(true));
  if (hr) hr.addEventListener('mousedown', makeHandleDrag(false));

  // Also allow dragging the selection body to pan
  const sel = document.getElementById('minimap-sel');
  if (sel) {
    sel.addEventListener('mousedown', e => {
      e.preventDefault();
      const startX   = e.clientX;
      const startS   = VIEW.start;
      const startE   = VIEW.end;
      const iS0      = dates.indexOf(startS);
      const iE0      = dates.indexOf(startE);
      const spanDays = iE0 - iS0;
      const onMove   = ev => {
        const rect  = track.getBoundingClientRect();
        const delta = Math.round(((ev.clientX - startX) / rect.width) * dates.length);
        let newS = Math.max(0, iS0 + delta);
        let newE = newS + spanDays;
        if (newE >= dates.length) { newE = dates.length - 1; newS = newE - spanDays; }
        VIEW.start = dates[Math.max(0, newS)];
        VIEW.end   = dates[Math.min(dates.length - 1, newE)];
        document.getElementById('date-from').value = VIEW.start;
        document.getElementById('date-to').value   = VIEW.end;
        clearActivePreset(); updateRangeLabel(); redrawAll();
      };
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }
}


// ZOOM / PAN SCALE
function zoomedXScale(n, w) {
  const visF  = 1 / ZOOM.scale;
  const sIdx  = ZOOM.offset * (n - 1);
  const eIdx  = sIdx + visF * (n - 1);
  return i => eIdx === sIdx ? 0 : ((i - sIdx) / (eIdx - sIdx)) * w;
}

function visibleRange(n) {
  const visF = 1 / ZOOM.scale;
  return {
    startIdx: Math.max(0, Math.floor(ZOOM.offset * (n - 1))),
    endIdx:   Math.min(n - 1, Math.ceil((ZOOM.offset + visF) * (n - 1))),
  };
}

// ══════════════════════════════════════════════════════════════════
// SVG UTILITIES
// ══════════════════════════════════════════════════════════════════
const tt = document.getElementById('tooltip');
function showTip(e, html) { tt.innerHTML = html; tt.style.opacity = '1'; moveTip(e); }
function moveTip(e) {
  let x = e.clientX + 14, y = e.clientY - 40;
  if (x + 210 > window.innerWidth) x = e.clientX - 224;
  if (y < 10) y = e.clientY + 14;
  tt.style.left = x + 'px'; tt.style.top = y + 'px';
}
function hideTip() { tt.style.opacity = '0'; }

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}
function linScale(d0, d1, r0, r1) {
  if (d1 === d0) return () => (r0 + r1) / 2;
  return v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
}
function dims(svgElem, M) {
  const W = svgElem.parentElement.getBoundingClientRect().width || 500;
  const H = +svgElem.getAttribute('height') || 240;
  return { W, H, w: W - M.l - M.r, h: H - M.t - M.b };
}
function clearSvg(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function drawGridLines(g, yS, yTicks, w) {
  yTicks.forEach(v => g.appendChild(svgEl('line', {
    x1:0, y1:yS(v), x2:w, y2:yS(v), stroke:C.gridC, 'stroke-width':'1', 'stroke-dasharray':'3,4'
  })));
}
function labelY(g, yS, yTicks) {
  yTicks.forEach(v => {
    const t = svgEl('text', { x:-8, y:yS(v)+3, 'text-anchor':'end',
      fill:C.muted, 'font-family':'DM Mono, monospace', 'font-size':'8' });
    t.textContent = v; g.appendChild(t);
  });
}
function makeGrad(defs, id, col, op0=0.2, op1=0.01) {
  const g = svgEl('linearGradient', { id, x1:'0%', y1:'0%', x2:'0%', y2:'100%' });
  g.appendChild(svgEl('stop', { offset:'0%',   'stop-color':col, 'stop-opacity':op0 }));
  g.appendChild(svgEl('stop', { offset:'100%', 'stop-color':col, 'stop-opacity':op1 }));
  defs.appendChild(g);
}
function addClip(defs, id, w, h) {
  const c = svgEl('clipPath', { id });
  c.appendChild(svgEl('rect', { x:0, y:-10, width:w, height:h+20 }));
  defs.appendChild(c);
}
function lp(pts) { return pts.map((p,i) => `${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '); }
function fp(pts, h) { return !pts.length ? '' : lp(pts) + ` L${pts.at(-1)[0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`; }

// ── Interaction registry ───────────────────────────────────────────
// Wheel and pan listeners are attached ONCE per SVG element (keyed by id)
// and never re-added on redraws. This prevents the listener-pile-up glitch.
const _interactionInited = new Set();

// Shared drag state — one active drag at a time across all charts
const _drag = { active: false, svId: null, startX: 0, startOffset: 0 };
let   _rafPending = false;

// Called once globally after DOM is ready
function initChartInteractions() {
  const chartIds = ['chart1', 'chart2', 'chart4', 'chart5']; // chart3 histogram + chart5 comparison use same zoom

  chartIds.forEach(id => {
    const sv = document.getElementById(id);
    if (!sv || _interactionInited.has(id)) return;
    _interactionInited.add(id);

    // ── Wheel zoom ─────────────────────────────────────────────────
    sv.addEventListener('wheel', e => {
      e.preventDefault();
      const rect   = sv.getBoundingClientRect();
      const frac   = (e.clientX - rect.left) / rect.width;
      const factor = e.deltaY < 0 ? 1.3 : 0.77;
      const newS   = Math.max(1, Math.min(20, ZOOM.scale * factor));
      if (newS === ZOOM.scale) return;
      ZOOM.offset = frac - (frac - ZOOM.offset) * (ZOOM.scale / newS);
      ZOOM.scale  = newS;
      clampZoom();
      updateZoomLabel();
      scheduleRedraw();
    }, { passive: false });

    // ── Pan drag — mousedown on SVG ─────────────────────────────────
    sv.addEventListener('mousedown', e => {
      if (ZOOM.scale <= 1) return;
      _drag.active      = true;
      _drag.svId        = id;
      _drag.startX      = e.clientX;
      _drag.startOffset = ZOOM.offset;
      sv.style.cursor   = 'grabbing';
      e.preventDefault();
    });
  });

  // ── Global mousemove — one handler, never duplicated ─────────────
  window.addEventListener('mousemove', e => {
    if (!_drag.active) return;
    const sv   = document.getElementById(_drag.svId);
    if (!sv) return;
    const rect  = sv.getBoundingClientRect();
    const delta = (_drag.startX - e.clientX) / rect.width / ZOOM.scale;
    ZOOM.offset = Math.max(0, Math.min(1 - 1 / ZOOM.scale, _drag.startOffset + delta));
    scheduleRedraw();
  });

  // ── Global mouseup ────────────────────────────────────────────────
  window.addEventListener('mouseup', () => {
    if (!_drag.active) return;
    const sv = document.getElementById(_drag.svId);
    if (sv) sv.style.cursor = ZOOM.scale > 1 ? 'grab' : 'default';
    _drag.active = false;
    _drag.svId   = null;
  });
}

// Throttle redraws to one per animation frame — prevents mid-drag jank
function scheduleRedraw() {
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(() => {
    _rafPending = false;
    redrawAll();
  });
}

// Update cursor style whenever zoom changes
function syncCursors() {
  ['chart1','chart2','chart4'].forEach(id => {
    const sv = document.getElementById(id);
    if (sv && !_drag.active) sv.style.cursor = ZOOM.scale > 1 ? 'grab' : 'default';
  });
}

// These are now no-ops — interactions are registered once by initChartInteractions()
function addWheelZoom(sv) {}
function addPanDrag(sv)   {
  // Just keep cursor in sync with current zoom level
  if (sv) sv.style.cursor = ZOOM.scale > 1 ? 'grab' : 'default';
}

function zoomBar(sv, W, H) {
  if (ZOOM.scale <= 1) return;
  const frac = 1 / ZOOM.scale;
  sv.appendChild(svgEl('rect', { x:0, y:H-3, width:W, height:3, fill:'rgba(46,61,46,0.7)', rx:1 }));
  sv.appendChild(svgEl('rect', {
    x: ZOOM.offset * W, y: H-3,
    width: Math.max(4, frac * W), height:3,
    fill: C.accent, rx:1, opacity:'0.75'
  }));
}

// CHART 1 — Fleet Median Diameter
function drawChart1(fleet) {
  const sv = document.getElementById('chart1');
  clearSvg(sv);
  if (!fleet.length) return;
  const M = { l:44, r:20, t:10, b:36 };
  const { W, H, w, h } = dims(sv, M);
  sv.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const n    = fleet.length;
  const xIdx = zoomedXScale(n, w);
  const { startIdx, endIdx } = visibleRange(n);
  const vis  = fleet.slice(startIdx, endIdx + 1);

  const allV = vis.flatMap(d => [d.median, d.q25, d.q75]);
  if (!allV.length) return;
  const yMin = Math.floor(Math.min(...allV) * 5) / 5 - 0.2;
  const yMax = Math.ceil( Math.max(...allV) * 5) / 5 + 0.2;
  const yS   = linScale(yMin, yMax, h, 0);
  const yTicks = [];
  for (let v = Math.ceil(yMin*2)/2; v <= yMax; v += 0.5) yTicks.push(+v.toFixed(1));

  const g    = svgEl('g', { transform:`translate(${M.l},${M.t})` });
  const defs = svgEl('defs');
  makeGrad(defs, 'gA1', C.accent, 0.18, 0.01);
  makeGrad(defs, 'gI1', C.text,   0.05, 0.00);
  addClip(defs, 'cl1', w, h);
  g.appendChild(defs);

  drawGridLines(g, yS, yTicks, w);
  labelY(g, yS, yTicks);

  const cg = svgEl('g', { 'clip-path':'url(#cl1)' });
  const iqrPts = fleet.map((d,i)=>[xIdx(i),yS(d.q75)])
    .concat([...fleet].reverse().map((d,i)=>[xIdx(fleet.length-1-i),yS(d.q25)]));
  cg.appendChild(svgEl('path', { d:lp(iqrPts)+' Z', fill:'url(#gI1)', stroke:'none' }));
  const mPts = fleet.map((d,i)=>[xIdx(i),yS(d.median)]);
  cg.appendChild(svgEl('path', { d:fp(mPts,h),  fill:'url(#gA1)', stroke:'none' }));
  cg.appendChild(svgEl('path', { d:lp(mPts), fill:'none',
    stroke:C.accent, 'stroke-width':'2', 'stroke-linecap':'round', 'stroke-linejoin':'round' }));
  g.appendChild(cg);

  // x-axis
  g.appendChild(svgEl('line', { x1:0,y1:h,x2:w,y2:h, stroke:C.muted2,'stroke-width':'1' }));
  const every = Math.max(1, Math.floor(vis.length/7));
  vis.forEach((d, vi) => {
    if (vi % every !== 0) return;
    const x = xIdx(startIdx + vi);
    if (x < 0 || x > w) return;
    g.appendChild(svgEl('line', { x1:x,y1:h,x2:x,y2:h+5, stroke:C.muted2,'stroke-width':'1' }));
    const lbl = svgEl('text', { x,y:h+17,'text-anchor':'middle',
      fill:C.muted,'font-family':'DM Mono, monospace','font-size':'8' });
    lbl.textContent = new Date(d.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    g.appendChild(lbl);
  });

  // Hover zones
  const segW = w / Math.max(1, vis.length);
  vis.forEach((d, vi) => {
    const cx = xIdx(startIdx + vi);
    const r  = svgEl('rect', { x:cx-segW/2,y:0,width:segW,height:h,fill:'transparent' });
    r.addEventListener('mousemove', e => {
      showTip(e, `<div class="tt-label">${d.date}</div>
        <div class="tt-val" style="color:${C.accent}">${d.median.toFixed(2)} cm</div>
        <div style="color:${C.muted};font-size:0.6rem;margin-top:2px">IQR ${d.q25.toFixed(2)}–${d.q75.toFixed(2)}</div>`);
      let dot = g.querySelector('.hvd');
      if (!dot) { dot = svgEl('circle',{r:4,class:'hvd','pointer-events':'none'}); g.appendChild(dot); }
      dot.setAttribute('cx',cx); dot.setAttribute('cy',yS(d.median));
      dot.setAttribute('fill',C.accent); dot.setAttribute('stroke','#0D110E'); dot.setAttribute('stroke-width','2');
    });
    r.addEventListener('mouseleave', ()=>{ hideTip(); const d=g.querySelector('.hvd'); if(d)d.remove(); });
    g.appendChild(r);
  });

  sv.appendChild(g);
  zoomBar(sv, W, H);
  addWheelZoom(sv);
  addPanDrag(sv);

  document.getElementById('legend1').innerHTML = `
    <div class="legend-item"><div class="legend-line" style="background:${C.accent}"></div>Median diameter</div>
    <div class="legend-item"><div class="legend-line" style="background:rgba(232,237,232,0.15);height:8px;border-radius:2px;width:16px"></div>IQR 25–75%</div>
    ${ZOOM.scale>1?`<div class="legend-item zoom-hint">Scroll to zoom · Drag to pan</div>`:''}`;
}

// CHART 2 — Individual Lemon
function drawChart2(lid) {
  const sv = document.getElementById('chart2');
  clearSvg(sv);
  const M = { l:44, r:20, t:10, b:36 };
  const { W, H, w, h } = dims(sv, M);
  sv.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const pts = filteredLemon(lid);
  const g   = svgEl('g', { transform:`translate(${M.l},${M.t})` });

  if (!pts.length) {
    const t = svgEl('text',{x:w/2,y:h/2,'text-anchor':'middle',
      fill:C.muted,'font-family':'DM Mono, monospace','font-size':'10'});
    t.textContent = 'No data in selected range';
    g.appendChild(t); sv.appendChild(g); return;
  }

  const n    = pts.length;
  const xIdx = zoomedXScale(n, w);
  const { startIdx, endIdx } = visibleRange(n);
  const vis  = pts.slice(startIdx, endIdx + 1);

  const vals = vis.map(p => p.median);
  const yMin = Math.floor(Math.min(...vals)*5)/5 - 0.3;
  const yMax = Math.ceil( Math.max(...vals)*5)/5 + 0.3;
  const yS   = linScale(yMin, yMax, h, 0);
  const yTicks = [];
  for (let v=Math.ceil(yMin*2)/2; v<=yMax; v+=0.5) yTicks.push(+v.toFixed(1));

  const defs = svgEl('defs');
  makeGrad(defs,'gG2',C.accent2,0.2,0.01);
  addClip(defs,'cl2',w,h);
  g.appendChild(defs);

  drawGridLines(g,yS,yTicks,w);
  labelY(g,yS,yTicks);

  const cg   = svgEl('g',{'clip-path':'url(#cl2)'});
  const mPts = pts.map((p,i)=>[xIdx(i),yS(p.median)]);
  cg.appendChild(svgEl('path',{d:fp(mPts,h),fill:'url(#gG2)',stroke:'none'}));
  cg.appendChild(svgEl('path',{d:lp(mPts),fill:'none',
    stroke:C.accent2,'stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round'}));

  vis.forEach((p,vi)=>{
    const i=startIdx+vi, cx=xIdx(i), cy=yS(p.median);
    if(cx<-6||cx>w+6) return;
    const dot=svgEl('circle',{cx,cy,r:'3.5',fill:C.accent2,stroke:'#0D110E','stroke-width':'1.5',cursor:'pointer'});
    dot.addEventListener('mousemove',e=>showTip(e,`<div class="tt-label">${p.date}</div><div class="tt-val" style="color:${C.accent2}">${p.median.toFixed(2)} cm</div>`));
    dot.addEventListener('mouseleave',hideTip);
    cg.appendChild(dot);
  });
  g.appendChild(cg);

  g.appendChild(svgEl('line',{x1:0,y1:h,x2:w,y2:h,stroke:C.muted2,'stroke-width':'1'}));
  const every=Math.max(1,Math.floor(vis.length/7));
  vis.forEach((p,vi)=>{
    if(vi%every!==0) return;
    const x=xIdx(startIdx+vi);
    if(x<0||x>w) return;
    g.appendChild(svgEl('line',{x1:x,y1:h,x2:x,y2:h+5,stroke:C.muted2,'stroke-width':'1'}));
    const lbl=svgEl('text',{x,y:h+17,'text-anchor':'middle',fill:C.muted,'font-family':'DM Mono, monospace','font-size':'8'});
    lbl.textContent=new Date(p.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    g.appendChild(lbl);
  });

  sv.appendChild(g);
  zoomBar(sv,W,H);
  addWheelZoom(sv);
  addPanDrag(sv);
  document.getElementById('ind-sub').textContent =
    `Lemon #${lid} · ${pts.length} days in range${ZOOM.scale>1?' · scroll/drag to explore':''}`;
}

// CHART 3 — Distribution
function drawChart3(diams, latestDate) {
  const sv = document.getElementById('chart3');
  clearSvg(sv);
  const M = { l:44, r:16, t:10, b:36 };
  const { W, H, w, h } = dims(sv, M);
  sv.setAttribute('viewBox', `0 0 ${W} ${H}`);

  document.getElementById('dist-label').textContent =
    `${new Date(latestDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})} · ${diams.length} lemons`;

  if (!diams.length) return;
  const nBins = Math.min(18, Math.max(4, diams.length));
  const dMin  = Math.min(...diams), dMax = Math.max(...diams);
  const bww   = dMax===dMin ? 1 : (dMax-dMin)/nBins;
  const bins  = Array.from({length:nBins},(_,i)=>({x0:dMin+i*bww,x1:dMin+(i+1)*bww,count:0}));
  diams.forEach(d=>{ const i=Math.min(nBins-1,Math.floor((d-dMin)/bww)); bins[i].count++; });

  const xS   = linScale(dMin-0.1, dMax+0.1, 0, w);
  const yMax = Math.max(...bins.map(b=>b.count));
  const yS   = linScale(0, yMax*1.15, h, 0);
  const yTicks = [0, Math.round(yMax*0.5), yMax];

  const g    = svgEl('g',{transform:`translate(${M.l},${M.t})`});
  const defs = svgEl('defs');
  makeGrad(defs,'gM3',C.accent3,0.9,0.3);
  g.appendChild(defs);

  drawGridLines(g,yS,yTicks,w);
  labelY(g,yS,yTicks);
  g.appendChild(svgEl('line',{x1:0,y1:h,x2:w,y2:h,stroke:C.muted2,'stroke-width':'1'}));

  [dMin,(dMin+dMax)/2,dMax].forEach(v=>{
    const x=xS(v);
    g.appendChild(svgEl('line',{x1:x,y1:h,x2:x,y2:h+4,stroke:C.muted2,'stroke-width':'1'}));
    const lbl=svgEl('text',{x,y:h+16,'text-anchor':'middle',fill:C.muted,'font-family':'DM Mono, monospace','font-size':'8'});
    lbl.textContent=v.toFixed(1); g.appendChild(lbl);
  });

  bins.forEach(b=>{
    if(!b.count) return;
    const x=xS(b.x0)+0.5, bW=Math.max(1,xS(b.x1)-xS(b.x0)-1);
    const y=yS(b.count),bH=h-y;
    const r=svgEl('rect',{x,y,width:bW,height:bH,fill:'url(#gM3)',rx:'2'});
    r.addEventListener('mousemove',e=>showTip(e,`
      <div class="tt-label">${b.x0.toFixed(1)}–${b.x1.toFixed(1)} cm</div>
      <div class="tt-val" style="color:${C.accent3}">${b.count} lemons</div>`));
    r.addEventListener('mouseleave',hideTip);
    g.appendChild(r);
  });

  const med=diams.reduce((s,v)=>s+v,0)/diams.length;
  const mx=xS(med);
  g.appendChild(svgEl('line',{x1:mx,y1:0,x2:mx,y2:h,stroke:C.accent,'stroke-width':'1.5','stroke-dasharray':'4,3'}));
  const ml=svgEl('text',{x:mx+5,y:14,'text-anchor':'start',fill:C.accent,'font-family':'DM Mono, monospace','font-size':'8'});
  ml.textContent=`med ${med.toFixed(2)}`; g.appendChild(ml);

  sv.appendChild(g);
}

// CHART 4 — Detections per day
function drawChart4(fleet) {
  const sv = document.getElementById('chart4');
  clearSvg(sv);
  if (!fleet.length) return;
  const M = { l:44, r:16, t:10, b:36 };
  const { W, H, w, h } = dims(sv, M);
  sv.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const n    = fleet.length;
  const xIdx = zoomedXScale(n, w);
  const { startIdx, endIdx } = visibleRange(n);
  const vis  = fleet.slice(startIdx, endIdx+1);

  const yMax = Math.max(...vis.map(d=>d.count));
  const yS   = linScale(0, yMax*1.12, h, 0);
  const yTicks = [0, Math.round(yMax/2), yMax];

  const g    = svgEl('g',{transform:`translate(${M.l},${M.t})`});
  const defs = svgEl('defs');
  makeGrad(defs,'gB4',C.accent2,0.85,0.2);
  addClip(defs,'cl4',w,h);
  g.appendChild(defs);

  drawGridLines(g,yS,yTicks,w);
  labelY(g,yS,yTicks);
  g.appendChild(svgEl('line',{x1:0,y1:h,x2:w,y2:h,stroke:C.muted2,'stroke-width':'1'}));

  const barW  = (w/Math.max(1,vis.length))*0.72;
  const every = Math.max(1,Math.floor(vis.length/7));
  const cg    = svgEl('g',{'clip-path':'url(#cl4)'});

  vis.forEach((d,vi)=>{
    const i=startIdx+vi, cx=xIdx(i);
    if(cx<-barW||cx>w+barW) return;
    const y=yS(d.count),bH=h-y;
    const r=svgEl('rect',{x:cx-barW/2,y,width:barW,height:bH,fill:'url(#gB4)',rx:'2'});
    r.addEventListener('mousemove',e=>showTip(e,`<div class="tt-label">${d.date}</div><div class="tt-val" style="color:${C.accent2}">${d.count} lemons</div>`));
    r.addEventListener('mouseleave',hideTip);
    cg.appendChild(r);

    if(vi%every===0&&cx>=0&&cx<=w){
      const lbl=svgEl('text',{x:cx,y:h+17,'text-anchor':'middle',fill:C.muted,'font-family':'DM Mono, monospace','font-size':'8'});
      lbl.textContent=new Date(d.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
      g.appendChild(lbl);
    }
  });
  g.appendChild(cg);
  sv.appendChild(g);
  zoomBar(sv,W,H);
  addWheelZoom(sv);
  addPanDrag(sv);
}

// INIT
window.addEventListener('load', fetchAndRender);
window.addEventListener('resize', () => {
  if (!G.fleet_daily) return;
  drawMinimap();
  redrawAll();
});


// CSV DOWNLOAD — built client-side from G data (no CORS issues)

function downloadCSV() {
  const btn = document.getElementById('download-btn');
  if (btn) { btn.textContent = '⏳ Preparing…'; btn.disabled = true; }

  try {
    // Gather every lemon's daily medians within the current VIEW window
    const rows = [];

    Object.entries(G.lemon_daily).forEach(([lid, pts]) => {
      pts.forEach(p => {
        if (p.date >= VIEW.start && p.date <= VIEW.end) {
          rows.push({ lemon_id: lid, date: p.date, diameter_cm: p.median });
        }
      });
    });

    // Sort by date then lemon_id
    rows.sort((a, b) => a.date.localeCompare(b.date) || +a.lemon_id - +b.lemon_id);

    // Build CSV string
    const header = 'date,lemon_id,diameter_cm';
    const lines  = rows.map(r => `${r.date},${r.lemon_id},${r.diameter_cm}`);
    const csv    = [header, ...lines].join('\n');

    // Trigger browser download via Blob
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `lemon_export_${VIEW.start}_to_${VIEW.end}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (btn) { btn.textContent = '✓ Downloaded'; }
  } catch (err) {
    if (btn) { btn.textContent = '✗ Failed'; }
    console.error('CSV download error:', err);
  }

  setTimeout(() => {
    if (btn) { btn.textContent = '⬇ Export CSV'; btn.disabled = false; }
  }, 2000);
}


// COMPARISON CHART — multi-lemon overlay

// Palette for up to 6 comparison lines
const CMP_COLORS = ['#C8E028','#6DCFA0','#F5C842','#7EC8E3','#FF8C69','#C084FC'];

function buildComparisonSelect() {
  const wrap = document.getElementById('cmp-select-wrap');
  if (!wrap || !G.lemon_ids) return;
  wrap.innerHTML = '';

  G.lemon_ids.forEach((lid, idx) => {
    const label = document.createElement('label');
    label.className = 'cmp-check-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = lid;
    cb.className = 'cmp-checkbox';
    // Pre-select first 3
    if (idx < 3) { cb.checked = true; }
    cb.addEventListener('change', () => {
      CMP_IDS = Array.from(document.querySelectorAll('.cmp-checkbox:checked')).map(c => +c.value);
      drawComparisonChart();
    });
    const dot = document.createElement('span');
    dot.className = 'cmp-dot';
    dot.style.background = CMP_COLORS[idx % CMP_COLORS.length];
    const txt = document.createElement('span');
    txt.textContent = `#${lid}`;
    label.appendChild(cb);
    label.appendChild(dot);
    label.appendChild(txt);
    wrap.appendChild(label);
  });

  // Set initial CMP_IDS
  CMP_IDS = G.lemon_ids.slice(0, 3);
}

function drawComparisonChart() {
  const sv = document.getElementById('chart5');
  if (!sv) return;
  clearSvg(sv);

  const ids = CMP_IDS.length ? CMP_IDS : G.lemon_ids.slice(0, 3);
  const M   = { l:44, r:20, t:10, b:36 };
  const { W, H, w, h } = dims(sv, M);
  sv.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // Collect all series within VIEW
  const series = ids.map((lid, si) => ({
    lid,
    color: CMP_COLORS[G.lemon_ids.indexOf(lid) % CMP_COLORS.length],
    pts:   filteredLemon(lid),
  })).filter(s => s.pts.length > 0);

  if (!series.length) {
    const g = svgEl('g', { transform:`translate(${M.l},${M.t})` });
    const t = svgEl('text', { x:w/2,y:h/2,'text-anchor':'middle',
      fill:C.muted,'font-family':'DM Mono, monospace','font-size':'10' });
    t.textContent = 'Select lemons above to compare';
    g.appendChild(t); sv.appendChild(g); return;
  }

  // Unified date axis across all selected lemons
  const allDatesSet = new Set();
  series.forEach(s => s.pts.forEach(p => allDatesSet.add(p.date)));
  const dateAxis = [...allDatesSet].sort();
  const n = dateAxis.length;

  const xIdx = zoomedXScale(n, w);
  const { startIdx, endIdx } = visibleRange(n);
  const visibleDates = dateAxis.slice(startIdx, endIdx + 1);

  // y domain from all visible data
  const allVals = series.flatMap(s =>
    s.pts.filter(p => visibleDates.includes(p.date)).map(p => p.median)
  );
  if (!allVals.length) return;

  const yMin = Math.floor(Math.min(...allVals) * 5) / 5 - 0.3;
  const yMax = Math.ceil( Math.max(...allVals) * 5) / 5 + 0.3;
  const yS   = linScale(yMin, yMax, h, 0);
  const yTicks = [];
  for (let v = Math.ceil(yMin*2)/2; v <= yMax; v += 0.5) yTicks.push(+v.toFixed(1));

  const g    = svgEl('g', { transform:`translate(${M.l},${M.t})` });
  const defs = svgEl('defs');
  addClip(defs, 'cl5', w, h);
  g.appendChild(defs);

  drawGridLines(g, yS, yTicks, w);
  labelY(g, yS, yTicks);

  const cg = svgEl('g', { 'clip-path':'url(#cl5)' });

  series.forEach(s => {
    // Map pts to unified date axis positions
    const dateMap = {};
    s.pts.forEach(p => { dateMap[p.date] = p.median; });

    const linePts = dateAxis
      .map((d, i) => dateMap[d] !== undefined ? [xIdx(i), yS(dateMap[d])] : null)
      .filter(Boolean);

    if (linePts.length < 2) return;

    // Draw line
    cg.appendChild(svgEl('path', { d:lp(linePts), fill:'none',
      stroke:s.color, 'stroke-width':'1.8',
      'stroke-linecap':'round', 'stroke-linejoin':'round', opacity:'0.9' }));

    // Draw dots on visible points
    s.pts.forEach(p => {
      const di = dateAxis.indexOf(p.date);
      if (di < startIdx || di > endIdx) return;
      const cx = xIdx(di), cy = yS(p.median);
      if (cx < -6 || cx > w + 6) return;
      const dot = svgEl('circle', { cx, cy, r:'3', fill:s.color,
        stroke:'#0D110E', 'stroke-width':'1.5', cursor:'pointer' });
      dot.addEventListener('mousemove', e => showTip(e,
        `<div class="tt-label">Lemon #${s.lid} · ${p.date}</div>
         <div class="tt-val" style="color:${s.color}">${p.median.toFixed(2)} cm</div>`));
      dot.addEventListener('mouseleave', hideTip);
      cg.appendChild(dot);
    });
  });

  g.appendChild(cg);

  // x-axis
  g.appendChild(svgEl('line',{x1:0,y1:h,x2:w,y2:h,stroke:C.muted2,'stroke-width':'1'}));
  const every = Math.max(1, Math.floor(visibleDates.length / 7));
  visibleDates.forEach((d, vi) => {
    if (vi % every !== 0) return;
    const x = xIdx(startIdx + vi);
    if (x < 0 || x > w) return;
    g.appendChild(svgEl('line',{x1:x,y1:h,x2:x,y2:h+5,stroke:C.muted2,'stroke-width':'1'}));
    const lbl = svgEl('text',{x,y:h+17,'text-anchor':'middle',
      fill:C.muted,'font-family':'DM Mono, monospace','font-size':'8'});
    lbl.textContent = new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    g.appendChild(lbl);
  });

  sv.appendChild(g);
  zoomBar(sv, W, H);
  addPanDrag(sv);

  // Update legend
  const leg = document.getElementById('legend5');
  if (leg) {
    leg.innerHTML = series.map(s =>
      `<div class="legend-item">
        <div class="legend-line" style="background:${s.color}"></div>
        Lemon #${s.lid}
       </div>`
    ).join('');
  }
}


// ANOMALY DETECTION PANEL

function drawAnomalyPanel() {
  const panel = document.getElementById('anomaly-list');
  if (!panel) return;

  // Filter anomalies to current VIEW window
  const visible = ANOMALIES.filter(a => a.date >= VIEW.start && a.date <= VIEW.end);

  // Update badge count
  const badge = document.getElementById('anomaly-count');
  if (badge) {
    badge.textContent = visible.length;
    badge.className   = 'anomaly-badge' + (visible.length > 0 ? ' has-anomalies' : '');
  }

  if (!visible.length) {
    panel.innerHTML = `<div class="anomaly-empty">No anomalies detected in this date range</div>`;
    return;
  }

  // Sort by |delta| descending, show top 20
  const top = [...visible].sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);

  panel.innerHTML = top.map(a => {
    const isSpike = a.type === 'spike';
    const arrow   = isSpike ? '↑' : '↓';
    const cls     = isSpike ? 'anomaly-spike' : 'anomaly-drop';
    const col     = isSpike ? C.accent : '#E05252';
    return `
      <div class="anomaly-row ${cls}">
        <div class="anomaly-id">Lemon #${a.lemon_id}</div>
        <div class="anomaly-date">${a.date}</div>
        <div class="anomaly-vals">
          ${a.prev_diameter.toFixed(2)} → <strong style="color:${col}">${a.diameter.toFixed(2)} cm</strong>
        </div>
        <div class="anomaly-delta" style="color:${col}">
          ${arrow} ${Math.abs(a.delta).toFixed(2)} cm
        </div>
        <div class="anomaly-type-badge ${cls}">${isSpike ? 'Spike' : 'Drop'}</div>
      </div>`;
  }).join('');
}