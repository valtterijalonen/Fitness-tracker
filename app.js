'use strict';

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const shiftDate = (ds, n) => { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const niceDate = ds => new Date(ds + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const round = (v, dp = 0) => { const m = 10 ** dp; return Math.round((+v || 0) * m) / m; };
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };

// ---------- nutrients ----------
// k, label, unit, Open Food Facts field (per 100 g, in grams), factor to our unit, daily reference
const NUTR = [
  ['kcal', 'Calories', 'kcal', 'energy-kcal_100g', 1],
  ['protein', 'Protein', 'g', 'proteins_100g', 1],
  ['carbs', 'Carbs', 'g', 'carbohydrates_100g', 1],
  ['fat', 'Fat', 'g', 'fat_100g', 1],
  ['fiber', 'Fiber', 'g', 'fiber_100g', 1, 30],
  ['sugar', 'Sugar', 'g', 'sugars_100g', 1, 50],
  ['satfat', 'Saturated fat', 'g', 'saturated-fat_100g', 1, 20],
  ['sodium', 'Sodium', 'mg', 'sodium_100g', 1000, 2300],
  ['potassium', 'Potassium', 'mg', 'potassium_100g', 1000, 3500],
  ['calcium', 'Calcium', 'mg', 'calcium_100g', 1000, 1000],
  ['iron', 'Iron', 'mg', 'iron_100g', 1000, 14],
  ['magnesium', 'Magnesium', 'mg', 'magnesium_100g', 1000, 400],
  ['zinc', 'Zinc', 'mg', 'zinc_100g', 1000, 10],
  ['vitA', 'Vitamin A', 'µg', 'vitamin-a_100g', 1e6, 900],
  ['vitC', 'Vitamin C', 'mg', 'vitamin-c_100g', 1000, 90],
  ['vitD', 'Vitamin D', 'µg', 'vitamin-d_100g', 1e6, 15],
  ['vitB12', 'Vitamin B12', 'µg', 'vitamin-b12_100g', 1e6, 2.4],
].map(([k, label, unit, off, f, rda]) => ({ k, label, unit, off, f, rda }));
const MICROS = NUTR.slice(4);
const scaleN = (n, factor) => Object.fromEntries(Object.entries(n || {}).map(([k, v]) => [k, (+v || 0) * factor]));

// ---------- storage ----------
const KEY = 'tracker-v1';
const defaults = () => ({
  exercises: [], workouts: {}, templates: [], foods: {},
  goals: { kcal: 2500, protein: 150, carbs: 280, fat: 80 },
  settings: { apiKey: '', model: 'claude-sonnet-5-5', rest: 90 },
});
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d) { const base = defaults(); return { ...base, ...d, goals: { ...base.goals, ...d.goals }, settings: { ...base.settings, ...d.settings } }; }
  } catch {}
  return defaults();
}
let db = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
navigator.storage?.persist?.();

const ui = { tab: localStorage.getItem('tracker-tab') || 'workout', wDate: today(), fDate: today(), chartEx: null, pending: null };
const exName = id => db.exercises.find(e => e.id === id)?.name || '(deleted)';

// ---------- render ----------
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#view').innerHTML = { workout: renderWorkout, food: renderFood, progress: renderProgress, settings: renderSettings }[ui.tab]();
  if (ui.tab === 'progress') drawCharts();
}

function dateBar(prefix, date) {
  return `<div class="datebar">
    <button data-act="${prefix}Shift" data-n="-1">‹</button>
    <input type="date" data-field="${prefix}Date" value="${date}">
    <button data-act="${prefix}Shift" data-n="1">›</button>
    ${date !== today() ? `<button data-act="${prefix}Today">Today</button>` : ''}
  </div>`;
}

// ---------- workout ----------
function lastSession(exId, before) {
  const dates = Object.keys(db.workouts).filter(d => d < before).sort().reverse();
  for (const d of dates) {
    const e = db.workouts[d].find(x => x.exId === exId && x.sets.some(s => s.r));
    if (e) return { date: d, sets: e.sets.filter(s => s.r) };
  }
  return null;
}
const fmtSet = s => `${s.w ?? 0}×${s.r}`;

function renderWorkout() {
  const entries = db.workouts[ui.wDate] || [];
  let h = `<h2>Workout</h2>${dateBar('w', ui.wDate)}`;
  if (db.templates.length) {
    h += `<div class="chips">${db.templates.map(t => `<button class="chip" data-act="useTpl" data-id="${t.id}">▶ ${esc(t.name)}</button>`).join('')}</div>`;
  }
  entries.forEach((e, i) => {
    const last = lastSession(e.exId, ui.wDate);
    h += `<div class="card">
      <div class="row"><b class="grow">${esc(exName(e.exId))}</b><button class="ghost" data-act="rmEntry" data-i="${i}">✕</button></div>
      <div class="last">${last ? `Last (${niceDate(last.date)}): ${last.sets.map(fmtSet).join(' · ')}` : 'First time — no previous sets'}</div>
      <div class="sets"><span class="hdr">#</span><span class="hdr">kg</span><span class="hdr">reps</span><span></span>
      ${e.sets.map((s, j) => {
        const p = last?.sets[j] || last?.sets[last.sets.length - 1];
        return `<span class="n">${j + 1}</span>
        <input type="number" inputmode="decimal" step="any" data-field="setW" data-i="${i}" data-j="${j}" value="${s.w ?? ''}" placeholder="${p?.w ?? ''}">
        <input type="number" inputmode="numeric" data-field="setR" data-i="${i}" data-j="${j}" value="${s.r ?? ''}" placeholder="${p?.r ?? ''}">
        <button class="ghost" data-act="rmSet" data-i="${i}" data-j="${j}">✕</button>`;
      }).join('')}</div>
      <button class="block" data-act="addSet" data-i="${i}">+ Set</button>
    </div>`;
  });
  h += `<button class="primary block" data-act="addEx">+ Add exercise</button>
    <div class="row" style="margin-top:8px">
      <button class="grow" data-act="startTimer">⏱ Rest timer</button>
      ${entries.length ? `<button class="grow" data-act="saveTpl">💾 Save as template</button>` : ''}
    </div>`;
  if (db.templates.length) {
    h += `<h3>Templates</h3><div class="card list">${db.templates.map(t => `<div class="item">
      <div class="grow"><b>${esc(t.name)}</b><div class="muted small">${t.exIds.map(id => esc(exName(id))).join(', ')}</div></div>
      <button class="ghost" data-act="rmTpl" data-id="${t.id}">🗑</button></div>`).join('')}</div>`;
  }
  return h;
}

function ensureWorkout() { return (db.workouts[ui.wDate] ||= []); }
function addEntry(exId) {
  const w = ensureWorkout();
  if (!w.some(e => e.exId === exId)) w.push({ exId, sets: [{ w: null, r: null }] });
}

function exPickerHtml(q = '') {
  const ql = q.trim().toLowerCase();
  const list = db.exercises.filter(e => e.name.toLowerCase().includes(ql)).sort((a, b) => a.name.localeCompare(b.name));
  return `${list.map(e => `<div class="item" data-act="pickEx" data-id="${e.id}"><span class="grow">${esc(e.name)}</span>›</div>`).join('')}
    ${ql && !db.exercises.some(e => e.name.toLowerCase() === ql) ? `<button class="primary block" data-act="newEx">+ Create "${esc(q.trim())}"</button>` : ''}
    ${!db.exercises.length && !ql ? '<p class="muted">Type a name to create your first exercise (e.g. Bench Press).</p>' : ''}`;
}

// ---------- rest timer ----------
let timerEnd = 0, timerInt = null;
function startTimer(sec = db.settings.rest) {
  timerEnd = Date.now() + sec * 1000;
  $('#timer').classList.remove('hidden', 'done');
  clearInterval(timerInt);
  timerInt = setInterval(tick, 250);
  tick();
}
function tick() {
  const left = Math.round((timerEnd - Date.now()) / 1000);
  if (left <= 0) {
    $('#timerText').textContent = 'Go! 💪';
    $('#timer').classList.add('done');
    clearInterval(timerInt);
    navigator.vibrate?.([300, 100, 300]);
    beep();
    setTimeout(() => { if (Date.now() >= timerEnd) $('#timer').classList.add('hidden'); }, 5000);
    return;
  }
  $('#timerText').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); o.frequency.value = 880; o.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.4);
  } catch {}
}

// ---------- food ----------
function dayTotals(date) {
  const t = {};
  (db.foods[date] || []).forEach(f => NUTR.forEach(({ k }) => { t[k] = (t[k] || 0) + (+f.n?.[k] || 0); }));
  return t;
}
function macroBar(label, val, goal, color) {
  const pct = goal ? Math.min(100, val / goal * 100) : 0;
  return `<div><div class="small">${label}</div><b>${round(val)}</b><span class="muted small"> / ${goal}g</span>
    <div class="bar"><i style="width:${pct}%;background:${color}"></i></div></div>`;
}

function renderFood() {
  const items = db.foods[ui.fDate] || [];
  const t = dayTotals(ui.fDate), g = db.goals;
  const left = g.kcal - (t.kcal || 0);
  let h = `<h2>Food</h2>${dateBar('f', ui.fDate)}
  <div class="card">
    <div class="row"><div class="grow"><span class="big">${round(t.kcal)}</span> <span class="muted">/ ${g.kcal} kcal</span></div>
    <div class="muted">${left >= 0 ? `${round(left)} left` : `${round(-left)} over`}</div></div>
    <div class="bar"><i style="width:${Math.min(100, (t.kcal || 0) / g.kcal * 100)}%;background:${left < 0 ? 'var(--danger)' : 'var(--accent)'}"></i></div>
    <div class="macros">${macroBar('Protein', t.protein || 0, g.protein, 'var(--p)')}${macroBar('Carbs', t.carbs || 0, g.carbs, 'var(--c)')}${macroBar('Fat', t.fat || 0, g.fat, 'var(--f)')}</div>
    <details><summary>Micronutrients</summary><table>${MICROS.map(m => `<tr><td>${m.label}</td><td>${round(t[m.k], m.unit === 'µg' ? 1 : 0)} ${m.unit}${m.rda ? ` · ${round((t[m.k] || 0) / m.rda * 100)}%` : ''}</td></tr>`).join('')}</table>
    <p class="muted small">Micros depend on data availability; database items often lack them. % of a typical adult daily reference.</p></details>
  </div>
  <div class="grid4">
    <button data-act="foodPhoto"><b>📷</b>Photo AI</button>
    <button data-act="foodSearch"><b>🔍</b>Search</button>
    <button data-act="foodBarcode"><b>▦</b>Barcode</button>
    <button data-act="foodManual"><b>✏️</b>Manual</button>
  </div>`;
  const recent = recentFoods();
  if (recent.length) h += `<h3>Quick add (recent)</h3><div class="chips">${recent.map((f, i) => `<button class="chip" data-act="recent" data-i="${i}">${esc(f.name)}</button>`).join('')}</div>`;
  h += `<h3>Eaten</h3><div class="card list">${items.length ? items.map((f, i) => `<div class="item">
      <div class="grow" data-act="editFood" data-i="${i}"><b>${esc(f.name)}</b>
      <div class="muted small">${f.grams ? `${round(f.grams)} g · ` : ''}${round(f.n.kcal)} kcal · P ${round(f.n.protein)} · C ${round(f.n.carbs)} · F ${round(f.n.fat)}</div></div>
      <button class="ghost" data-act="rmFood" data-i="${i}">✕</button></div>`).join('') : '<p class="muted">Nothing logged yet.</p>'}</div>`;
  return h;
}

function recentFoods() {
  const seen = new Set(), out = [];
  Object.keys(db.foods).sort().reverse().forEach(d => [...db.foods[d]].reverse().forEach(f => {
    if (!seen.has(f.name) && out.length < 10) { seen.add(f.name); out.push(f); }
  }));
  return out;
}

function addFood(entry) {
  (db.foods[ui.fDate] ||= []).push({ id: uid(), ...entry });
  save(); closeModal(); render();
}

// Amount sheet for a food with known per-100 g values
function amountSheet(food, editIndex = null) {
  ui.pending = { food, editIndex };
  const serv = food.serving;
  const startG = food.grams || serv || 100;
  openModal(`<h2>${esc(food.name)}</h2>
    <p class="muted small">Per 100 g: ${round(food.per100.kcal)} kcal · P ${round(food.per100.protein, 1)} · C ${round(food.per100.carbs, 1)} · F ${round(food.per100.fat, 1)}</p>
    <label>Amount (grams)</label>
    <input type="number" inputmode="decimal" id="amtG" value="${round(startG, 1)}" data-field="amt">
    <div class="chips" style="margin-top:8px">${[serv, 50, 100, 150, 200, 300].filter(Boolean).map(g => `<button class="chip" data-act="setAmt" data-g="${g}">${g === serv ? `1 serving (${g} g)` : `${g} g`}</button>`).join('')}</div>
    <div id="amtPreview" class="muted"></div>
    <button class="primary block" data-act="confirmAmt">${editIndex === null ? 'Add' : 'Save'}</button>`);
  updateAmtPreview();
}
function updateAmtPreview() {
  const g = num($('#amtG')?.value) || 0, p = ui.pending.food.per100;
  $('#amtPreview').textContent = `${round(p.kcal * g / 100)} kcal · P ${round(p.protein * g / 100)} g · C ${round(p.carbs * g / 100)} g · F ${round(p.fat * g / 100)} g`;
}

function offToFood(p) {
  const n = p.nutriments || {};
  const per100 = {};
  NUTR.forEach(({ k, off, f }) => { if (n[off] != null) per100[k] = +n[off] * f; });
  if (per100.kcal == null && n.energy_100g != null) per100.kcal = n.energy_100g / 4.184;
  NUTR.slice(0, 4).forEach(({ k }) => { per100[k] ||= 0; });
  return { name: [p.product_name, p.brands?.split(',')[0]].filter(Boolean).join(' – ') || 'Unknown product', per100, serving: num(p.serving_quantity) || null };
}
const OFF_FIELDS = 'product_name,brands,nutriments,serving_quantity,code';
async function offSearch(q) {
  const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}`);
  if (!r.ok) throw new Error(`Search failed (${r.status})`);
  return ((await r.json()).products || []).filter(p => p.product_name && p.nutriments);
}
async function offBarcode(code) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  const j = await r.json();
  if (j.status !== 1) throw new Error('Product not found in Open Food Facts');
  return j.product;
}

// ---------- AI photo ----------
const AI_PROMPT = `You are a nutrition estimator. Identify every distinct food/drink in the meal (from the photo and/or the description) and estimate the portion eaten in grams.
Reply with ONLY a JSON array, no prose. Each element:
{"name": string, "grams": number, ${NUTR.map(n => `"${n.k}": number`).join(', ')}}
Values are totals for the estimated portion. Units: kcal; protein/carbs/fat/fiber/sugar/satfat in g; ${MICROS.filter(m => m.unit !== 'g').map(m => `${m.k} in ${m.unit === 'µg' ? 'micrograms' : 'mg'}`).join(', ')}.
Use typical food-composition values. If there is no food, return [].`;

function resizeImage(file, max = 1280) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

async function aiAnalyze(dataUrl, note) {
  const content = [];
  if (dataUrl) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] } });
  content.push({ type: 'text', text: AI_PROMPT + (note ? `\n\nUser's description: ${note}` : '') });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': db.settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: db.settings.model, max_tokens: 3000, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `API error ${r.status}`);
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Could not read the AI response');
  return JSON.parse(m[0]);
}

function aiReviewSheet(items) {
  ui.pending = { ai: items.map(it => ({ ...it, origGrams: +it.grams || 100, on: true })) };
  if (!items.length) return openModal(`<h2>No food found</h2><p class="muted">Try another photo or add a description.</p><button class="block" data-act="close">Close</button>`);
  openModal(`<h2>Check & adjust</h2><p class="muted small">AI estimates — adjust grams if needed. Nutrients scale automatically.</p>
    <div class="list">${ui.pending.ai.map((it, i) => `<div class="item">
      <input type="checkbox" style="width:auto" checked data-field="aiOn" data-i="${i}">
      <div class="grow"><input data-field="aiName" data-i="${i}" value="${esc(it.name)}">
      <div class="muted small" id="aiInfo${i}">${aiInfo(it)}</div></div>
      <input type="number" inputmode="decimal" style="width:80px" data-field="aiG" data-i="${i}" value="${round(it.grams)}"><span class="muted">g</span>
    </div>`).join('')}</div>
    <button class="primary block" data-act="aiAdd">Add selected</button>`);
}
function aiInfo(it) {
  const f = (+it.grams || 0) / it.origGrams;
  return `${round(it.kcal * f)} kcal · P ${round(it.protein * f)} · C ${round(it.carbs * f)} · F ${round(it.fat * f)}`;
}

// ---------- barcode camera ----------
let scanStream = null;
async function startScan() {
  if (!('BarcodeDetector' in window)) return;
  try {
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('#scanVideo');
    v.srcObject = scanStream; await v.play();
    const loop = async () => {
      if (!scanStream) return;
      try {
        const codes = await det.detect(v);
        if (codes.length) { const c = codes[0].rawValue; stopScan(); return lookupBarcode(c); }
      } catch {}
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) { $('#scanMsg').textContent = 'Camera unavailable: ' + e.message; }
}
function stopScan() { scanStream?.getTracks().forEach(t => t.stop()); scanStream = null; }
async function lookupBarcode(code) {
  openModal(`<div class="spinner">Looking up ${esc(code)}…</div>`);
  try { amountSheet(offToFood(await offBarcode(code))); }
  catch (e) { openModal(`<h2>Not found</h2><p class="muted">${esc(e.message)}</p><button class="block" data-act="foodSearch">Search by name</button><button class="block" data-act="foodManual">Enter manually</button>`); }
}

// ---------- progress ----------
const e1rm = s => (+s.w || 0) * (1 + (+s.r || 0) / 30);
function exHistory(exId) {
  return Object.keys(db.workouts).sort().map(d => {
    const e = db.workouts[d].find(x => x.exId === exId);
    const sets = e?.sets.filter(s => s.r) || [];
    if (!sets.length) return null;
    return { date: d, sets, best: Math.max(...sets.map(e1rm)), top: Math.max(...sets.map(s => +s.w || 0)), vol: sets.reduce((a, s) => a + (+s.w || 0) * (+s.r || 0), 0) };
  }).filter(Boolean);
}

function renderProgress() {
  if (!db.exercises.length) return `<h2>Progress</h2><p class="muted">Log some workouts first.</p>`;
  if (!ui.chartEx || !db.exercises.some(e => e.id === ui.chartEx)) ui.chartEx = db.exercises[0].id;
  const hist = exHistory(ui.chartEx);
  return `<h2>Progress</h2>
  <select data-field="chartEx">${[...db.exercises].sort((a, b) => a.name.localeCompare(b.name)).map(e => `<option value="${e.id}" ${e.id === ui.chartEx ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
  <div class="card" style="margin-top:10px"><div class="muted small">Estimated 1RM (kg) <span style="color:var(--accent)">●</span> · Top set weight <span style="color:var(--accent2)">●</span></div><canvas id="chartEx"></canvas></div>
  <div class="card list">${hist.length ? [...hist].reverse().slice(0, 30).map(h => `<div class="item"><div class="grow"><b>${niceDate(h.date)}</b>
    <div class="muted small">${h.sets.map(fmtSet).join(' · ')}</div></div><div class="muted small">e1RM ${round(h.best, 1)}<br>vol ${round(h.vol)}</div></div>`).join('') : '<p class="muted">No sets logged for this exercise yet.</p>'}</div>
  <div class="row"><button class="grow" data-act="renameEx">✏️ Rename</button><button class="grow" data-act="deleteEx">🗑 Delete exercise</button></div>
  <h3>Calories – last 30 days</h3>
  <div class="card"><canvas id="chartKcal"></canvas></div>`;
}

function drawCharts() {
  const hist = exHistory(ui.chartEx);
  drawLine($('#chartEx'), [hist.map(h => h.best), hist.map(h => h.top)], hist.map(h => niceDate(h.date)), ['#22c55e', '#3b82f6']);
  const days = [...Array(30)].map((_, i) => shiftDate(today(), i - 29));
  drawLine($('#chartKcal'), [days.map(d => db.foods[d]?.length ? dayTotals(d).kcal : null)], days.map(niceDate), ['#f59e0b'], db.goals.kcal);
}

function drawLine(cv, series, labels, colors, goal) {
  if (!cv) return;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const vals = series.flat().filter(v => v != null).concat(goal ? [goal] : []);
  g.fillStyle = '#8a91a0'; g.font = '11px system-ui';
  if (!vals.length) { g.fillText('No data yet', W / 2 - 30, H / 2); return; }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const L = 36, R = 8, T = 8, B = 20, n = labels.length;
  const x = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  g.strokeStyle = '#2a2f3a'; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const v = lo + (hi - lo) * k / 3;
    g.beginPath(); g.moveTo(L, y(v)); g.lineTo(W - R, y(v)); g.stroke();
    g.fillText(round(v), 2, y(v) + 4);
  }
  [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).forEach(i => g.fillText(labels[i], Math.min(x(i) - 14, W - 40), H - 4));
  if (goal) { g.setLineDash([4, 4]); g.strokeStyle = '#8a91a0'; g.beginPath(); g.moveTo(L, y(goal)); g.lineTo(W - R, y(goal)); g.stroke(); g.setLineDash([]); }
  series.forEach((s, si) => {
    g.strokeStyle = g.fillStyle = colors[si]; g.lineWidth = 2; g.beginPath();
    let started = false;
    s.forEach((v, i) => { if (v == null) return; started ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)); started = true; });
    g.stroke();
    s.forEach((v, i) => { if (v != null) { g.beginPath(); g.arc(x(i), y(v), 3, 0, 7); g.fill(); } });
  });
}

// ---------- settings ----------
function renderSettings() {
  const g = db.goals, s = db.settings;
  return `<h2>Settings</h2>
  <div class="card"><h3 style="margin-top:0">Daily goals</h3>
    <div class="macros" style="grid-template-columns:1fr 1fr">
      ${[['kcal', 'Calories'], ['protein', 'Protein g'], ['carbs', 'Carbs g'], ['fat', 'Fat g']].map(([k, l]) => `<div><label>${l}</label><input type="number" inputmode="numeric" data-field="goal" data-k="${k}" value="${g[k]}"></div>`).join('')}
    </div>
    <label>Default rest timer (seconds)</label><input type="number" inputmode="numeric" data-field="rest" value="${s.rest}">
  </div>
  <div class="card"><h3 style="margin-top:0">Photo AI</h3>
    <p class="muted small">Food photo recognition uses the Anthropic API with your own key (get one at console.anthropic.com). The key is stored only on this device; each photo costs roughly a cent.</p>
    <label>API key</label><input type="password" autocomplete="off" data-field="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-...">
    <label>Model</label><input data-field="model" value="${esc(s.model)}">
  </div>
  <div class="card"><h3 style="margin-top:0">Backup</h3>
    <p class="muted small">Data is saved on this phone automatically. Export a backup regularly, or to move to a new phone.</p>
    <div class="row"><button class="grow" data-act="export">⬇️ Export</button><button class="grow" data-act="import">⬆️ Import</button></div>
    <input type="file" id="importFile" accept="application/json,.json" class="hidden">
  </div>
  <div class="card"><h3 style="margin-top:0">Add to home screen</h3>
    <p class="muted small"><b>iPhone (Safari):</b> Share button → "Add to Home Screen".<br><b>Android (Chrome):</b> ⋮ menu → "Add to Home screen" / "Install app".</p>
  </div>`;
}

// ---------- modal ----------
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { stopScan(); $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

// ---------- actions ----------
const ACT = {
  tab: d => { ui.tab = d.tab; localStorage.setItem('tracker-tab', d.tab); render(); scrollTo(0, 0); },
  close: closeModal,
  wShift: d => { ui.wDate = shiftDate(ui.wDate, +d.n); render(); },
  wToday: () => { ui.wDate = today(); render(); },
  fShift: d => { ui.fDate = shiftDate(ui.fDate, +d.n); render(); },
  fToday: () => { ui.fDate = today(); render(); },

  addEx: () => {
    openModal(`<h2>Add exercise</h2><input id="exQ" data-field="exSearch" placeholder="Search or type a new name" autocomplete="off"><div class="list" id="exList">${exPickerHtml()}</div>`);
    setTimeout(() => $('#exQ')?.focus(), 50);
  },
  pickEx: d => { addEntry(d.id); save(); closeModal(); render(); },
  newEx: () => {
    const name = $('#exQ').value.trim();
    if (!name) return;
    const ex = { id: uid(), name };
    db.exercises.push(ex); addEntry(ex.id); save(); closeModal(); render();
  },
  rmEntry: d => {
    if (!confirm('Remove this exercise from the workout?')) return;
    db.workouts[ui.wDate].splice(+d.i, 1);
    if (!db.workouts[ui.wDate].length) delete db.workouts[ui.wDate];
    save(); render();
  },
  addSet: d => {
    const sets = db.workouts[ui.wDate][+d.i].sets;
    const prev = sets[sets.length - 1];
    sets.push({ w: prev?.w ?? null, r: null });
    save(); render();
    const inputs = document.querySelectorAll(`[data-field=setR][data-i="${d.i}"]`);
    inputs[inputs.length - 1]?.focus();
  },
  rmSet: d => { db.workouts[ui.wDate][+d.i].sets.splice(+d.j, 1); save(); render(); },
  startTimer: () => startTimer(),
  timerAdd: () => { timerEnd = Math.max(timerEnd, Date.now()) + 15000; $('#timer').classList.remove('done'); clearInterval(timerInt); timerInt = setInterval(tick, 250); tick(); },
  timerStop: () => { clearInterval(timerInt); $('#timer').classList.add('hidden'); },

  saveTpl: () => {
    const name = prompt('Template name (e.g. Push day)');
    if (!name) return;
    db.templates.push({ id: uid(), name: name.trim(), exIds: db.workouts[ui.wDate].map(e => e.exId) });
    save(); render();
  },
  useTpl: d => { db.templates.find(t => t.id === d.id).exIds.filter(id => db.exercises.some(e => e.id === id)).forEach(addEntry); save(); render(); },
  rmTpl: d => { if (confirm('Delete template?')) { db.templates = db.templates.filter(t => t.id !== d.id); save(); render(); } },

  renameEx: () => {
    const ex = db.exercises.find(e => e.id === ui.chartEx);
    const name = prompt('New name', ex.name);
    if (name?.trim()) { ex.name = name.trim(); save(); render(); }
  },
  deleteEx: () => {
    const ex = db.exercises.find(e => e.id === ui.chartEx);
    if (!confirm(`Delete "${ex.name}" and all its logged sets?`)) return;
    db.exercises = db.exercises.filter(e => e.id !== ex.id);
    for (const d of Object.keys(db.workouts)) {
      db.workouts[d] = db.workouts[d].filter(e => e.exId !== ex.id);
      if (!db.workouts[d].length) delete db.workouts[d];
    }
    db.templates.forEach(t => { t.exIds = t.exIds.filter(id => id !== ex.id); });
    ui.chartEx = null; save(); render();
  },

  // food
  foodPhoto: () => {
    if (!db.settings.apiKey) {
      return openModal(`<h2>Photo AI needs an API key</h2><p class="muted">Add your Anthropic API key in Settings to estimate meals from photos.</p>
        <button class="primary block" data-act="goSettings">Open Settings</button><button class="block" data-act="foodSearch">Search database instead</button>`);
    }
    ui.pending = { img: null };
    openModal(`<h2>Meal photo</h2>
      <input type="file" accept="image/*" capture="environment" id="photoIn" class="hidden">
      <button class="block" data-act="pickPhoto">📷 Take / choose photo</button>
      <img id="photoPrev" class="preview hidden">
      <label>Description (optional – helps accuracy, works without a photo too)</label>
      <textarea id="photoNote" rows="2" placeholder="e.g. 200 g chicken breast, rice, olive oil"></textarea>
      <button class="primary block" data-act="analyze">Analyze</button>`);
    $('#photoIn').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      ui.pending.img = await resizeImage(f);
      const p = $('#photoPrev'); p.src = ui.pending.img; p.classList.remove('hidden');
    });
    $('#photoIn').click();
  },
  pickPhoto: () => $('#photoIn').click(),
  goSettings: () => { closeModal(); ACT.tab({ tab: 'settings' }); },
  analyze: async () => {
    const img = ui.pending.img, note = $('#photoNote').value.trim();
    if (!img && !note) return alert('Add a photo or a description first.');
    openModal(`<div class="spinner">${img ? `<img class="preview" src="${img}">` : ''}Analyzing your meal…</div>`);
    try { aiReviewSheet(await aiAnalyze(img, note)); }
    catch (e) { openModal(`<h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p><button class="block" data-act="close">Close</button>`); }
  },
  aiAdd: () => {
    const list = (db.foods[ui.fDate] ||= []);
    ui.pending.ai.filter(it => it.on && +it.grams > 0).forEach(it => {
      const n = {}; NUTR.forEach(({ k }) => { n[k] = +it[k] || 0; });
      const per100 = scaleN(n, 100 / it.origGrams);
      list.push({ id: uid(), name: it.name, grams: +it.grams, per100, n: scaleN(per100, it.grams / 100) });
    });
    save(); closeModal(); render();
  },

  foodSearch: () => {
    openModal(`<h2>Search food</h2><div class="row"><input class="grow" id="searchQ" placeholder="e.g. oats, banana, skyr" enterkeyhint="search"><button class="primary" data-act="doSearch">Go</button></div>
      <div id="searchRes" class="list"><p class="muted small">Data from Open Food Facts.</p></div>`);
    $('#searchQ').addEventListener('keydown', e => { if (e.key === 'Enter') ACT.doSearch(); });
    setTimeout(() => $('#searchQ')?.focus(), 50);
  },
  doSearch: async () => {
    const q = $('#searchQ').value.trim();
    if (!q) return;
    $('#searchRes').innerHTML = '<div class="spinner">Searching…</div>';
    try {
      const res = (await offSearch(q)).map(offToFood);
      ui.pending = { results: res };
      $('#searchRes').innerHTML = res.length ? res.map((f, i) => `<div class="item" data-act="pickResult" data-i="${i}"><div class="grow"><b>${esc(f.name)}</b>
        <div class="muted small">per 100 g: ${round(f.per100.kcal)} kcal · P ${round(f.per100.protein, 1)} · C ${round(f.per100.carbs, 1)} · F ${round(f.per100.fat, 1)}</div></div>›</div>`).join('')
        : '<p class="muted">No results. Try another word or add manually.</p>';
    } catch (e) { $('#searchRes').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  },
  pickResult: d => amountSheet(ui.pending.results[+d.i]),

  foodBarcode: () => {
    const cam = 'BarcodeDetector' in window;
    openModal(`<h2>Barcode</h2>${cam ? '<video id="scanVideo" playsinline muted></video><p id="scanMsg" class="muted small">Point the camera at the barcode.</p>' : '<p class="muted small">Live scanning isn’t supported in this browser — type the number under the barcode.</p>'}
      <div class="row"><input class="grow" id="codeIn" inputmode="numeric" placeholder="Barcode number"><button class="primary" data-act="codeGo">Look up</button></div>`);
    startScan();
  },
  codeGo: () => { const c = $('#codeIn').value.trim(); if (c) { stopScan(); lookupBarcode(c); } },

  foodManual: () => {
    openModal(`<h2>Add manually</h2>
      <label>Name</label><input id="mName" placeholder="e.g. Protein shake">
      <label>Amount (g, optional)</label><input id="mGrams" type="number" inputmode="decimal">
      <div class="macros" style="grid-template-columns:1fr 1fr">${NUTR.slice(0, 4).map(n => `<div><label>${n.label} (${n.unit})</label><input id="m_${n.k}" type="number" inputmode="decimal"></div>`).join('')}</div>
      <details><summary>More nutrients (optional)</summary><div class="macros" style="grid-template-columns:1fr 1fr">${MICROS.map(n => `<div><label>${n.label} (${n.unit})</label><input id="m_${n.k}" type="number" inputmode="decimal"></div>`).join('')}</div></details>
      <p class="muted small">Enter totals for what you ate.</p>
      <button class="primary block" data-act="manualAdd">Add</button>`);
  },
  manualAdd: () => {
    const name = $('#mName').value.trim() || 'Food';
    const n = {}; NUTR.forEach(({ k }) => { n[k] = num($('#m_' + k).value) || 0; });
    const grams = num($('#mGrams').value);
    addFood(grams ? { name, grams, per100: scaleN(n, 100 / grams), n } : { name, n });
  },

  recent: d => {
    const f = recentFoods()[+d.i];
    if (f.per100 && f.grams) amountSheet({ name: f.name, per100: f.per100, grams: f.grams });
    else addFood({ name: f.name, n: { ...f.n } });
  },
  setAmt: d => { $('#amtG').value = d.g; updateAmtPreview(); },
  confirmAmt: () => {
    const g = num($('#amtG').value);
    if (!g) return;
    const { food, editIndex } = ui.pending;
    const entry = { name: food.name, grams: g, per100: food.per100, n: scaleN(food.per100, g / 100) };
    if (editIndex === null) return addFood(entry);
    Object.assign(db.foods[ui.fDate][editIndex], entry);
    save(); closeModal(); render();
  },
  editFood: d => {
    const f = db.foods[ui.fDate][+d.i];
    if (f.per100 && f.grams) return amountSheet({ name: f.name, per100: f.per100, grams: f.grams }, +d.i);
    const name = prompt('Rename', f.name);
    if (name?.trim()) { f.name = name.trim(); save(); render(); }
  },
  rmFood: d => {
    db.foods[ui.fDate].splice(+d.i, 1);
    if (!db.foods[ui.fDate].length) delete db.foods[ui.fDate];
    save(); render();
  },

  // backup
  export: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...db, settings: { ...db.settings, apiKey: '' } }, null, 1)], { type: 'application/json' }));
    a.download = `tracker-backup-${today()}.json`;
    a.click();
  },
  import: () => {
    const inp = $('#importFile');
    inp.onchange = async () => {
      try {
        const d = JSON.parse(await inp.files[0].text());
        if (!d.exercises || !d.workouts) throw new Error('Not a tracker backup');
        if (!confirm('Replace all current data with this backup?')) return;
        const key = db.settings.apiKey;
        localStorage.setItem(KEY, JSON.stringify(d));
        db = load(); db.settings.apiKey ||= key; save(); render();
        alert('Backup restored.');
      } catch (e) { alert('Import failed: ' + e.message); }
    };
    inp.click();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el) ACT[el.dataset.act]?.(el.dataset, el);
});

// Field edits: update data without a full re-render so the keyboard stays open
document.addEventListener('input', e => {
  const el = e.target, d = el.dataset;
  switch (d.field) {
    case 'exSearch': $('#exList').innerHTML = exPickerHtml(el.value); break;
    case 'amt': updateAmtPreview(); break;
    case 'aiG': ui.pending.ai[+d.i].grams = num(el.value) || 0; $('#aiInfo' + d.i).textContent = aiInfo(ui.pending.ai[+d.i]); break;
    case 'aiName': ui.pending.ai[+d.i].name = el.value; break;
    case 'setW': db.workouts[ui.wDate][+d.i].sets[+d.j].w = num(el.value); save(); break;
    case 'setR': db.workouts[ui.wDate][+d.i].sets[+d.j].r = num(el.value); save(); break;
    case 'goal': db.goals[d.k] = num(el.value) || 0; save(); break;
    case 'rest': db.settings.rest = num(el.value) || 90; save(); break;
    case 'apiKey': db.settings.apiKey = el.value.trim(); save(); break;
    case 'model': db.settings.model = el.value.trim(); save(); break;
  }
});
document.addEventListener('change', e => {
  const el = e.target, d = el.dataset;
  switch (d.field) {
    case 'wDate': if (el.value) { ui.wDate = el.value; render(); } break;
    case 'fDate': if (el.value) { ui.fDate = el.value; render(); } break;
    case 'chartEx': ui.chartEx = el.value; render(); break;
    case 'aiOn': ui.pending.ai[+d.i].on = el.checked; break;
    case 'setR': if (el.value) startTimer(); break; // finishing a set starts the rest timer
  }
});
addEventListener('resize', () => { if (ui.tab === 'progress') drawCharts(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
render();
