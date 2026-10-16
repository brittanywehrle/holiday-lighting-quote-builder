/* Wehrle Quote Builder: see CLAUDE.md for how this app is put together. */
'use strict';
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const num = (v, d = 0) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
const money = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: (Math.round(n * 100) % 100) ? 2 : 0, maximumFractionDigits: 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const polyLen = pts => { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; };
const centroid = pts => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const TAGLINE = 'Firefighter Owned & Operated';
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }
function dataURLtoBlob(u) { const [h, b] = u.split(','); const mime = (h.match(/:(.*?);/) || [])[1] || 'application/octet-stream'; const bin = atob(b); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: mime }); }
function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); }); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = src; }); }

/* ---------- storage adapter (swap for a cloud database later) ---------- */
const Store = (() => {
  const mem = { jobs: new Map(), photos: new Map(), kv: new Map() };
  let ok = !!window.indexedDB, dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('wehrle-quotes', 1);
        r.onupgradeneeded = () => { const d = r.result; ['jobs', 'photos', 'kv'].forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  async function idb(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  async function go(store, mode, fn, fallback) {
    if (ok) { try { return await idb(store, mode, fn); } catch (e) { ok = false; console.warn('Device storage unavailable; keeping data for this session only.', e); } }
    return fallback(mem[store]);
  }
  return {
    get onDevice() { return ok; },
    listJobs: () => go('jobs', 'readonly', s => s.getAll(), m => [...m.values()]).then(r => r || []),
    saveJob: j => go('jobs', 'readwrite', s => s.put(JSON.parse(JSON.stringify(j)), j.id), m => { m.set(j.id, j); }),
    deleteJob: id => go('jobs', 'readwrite', s => s.delete(id), m => { m.delete(id); }),
    putPhoto: (id, b) => go('photos', 'readwrite', s => s.put(b, id), m => { m.set(id, b); }),
    getPhoto: id => go('photos', 'readonly', s => s.get(id), m => m.get(id)),
    deletePhoto: id => go('photos', 'readwrite', s => s.delete(id), m => { m.delete(id); }),
    getKV: k => go('kv', 'readonly', s => s.get(k), m => m.get(k)),
    setKV: (k, v) => go('kv', 'readwrite', s => s.put(JSON.parse(JSON.stringify(v)), k), m => { m.set(k, v); }),
  };
})();

/* ---------- settings ---------- */
const DEFAULT_TERMS = [
  'Estimate: footage is measured from a photo and confirmed at an on-site walkthrough. If the confirmed footage differs, the price adjusts at the same per-foot rate before install.',
  'Deposit: new customers pay the {startup} startup fee at signing to reserve an install date. Returning customers pay no deposit. The balance is due when install is complete.',
  'Startup fee: the {startup} new customer fee covers admin and materials cut to fit your home. It is non-refundable once materials are cut.',
  'Takedown: takedown starts after January 1 and is completed by January 20.',
  'Lease: all installed materials remain the property of Wehrle Holiday Lighting. We store them between seasons and reinstall them for returning customers.',
  'Service: if lights stop working during the season, we repair them at no charge within 72 hours of being notified.',
  'Install method: we attach lights with clips. We do not drive nails or staples into your roof, gutters, or trim.',
  'Weather: rain, wind, or ice can shift scheduled dates. We will reschedule as soon as it is safe.',
  'Quote validity: this quote is good for 30 days from the date issued.'
];
const DEFAULT_CUSTOMER_NOTE = 'To ensure a safe and timely installation, we ask that the homeowner provide access to a working exterior outlet and to all areas being decorated, keep pets secured on installation and takedown days, and obtain any required HOA approval before the install date.';
function defaultSettings() {
  return {
    company: { name: 'Wehrle Holiday Lighting', phone: '', email: '', website: '', area: '' },
    paymentLink: '', rateC9: 7, startup: 349, bufferPct: 10, wreathMarkup: 2, garlandMarkup: 2, defaultSpacing: 15,
    garlandCost: 24, garlandLen: 9, wreathCost: 30, fees: [], terms: DEFAULT_TERMS.slice(), termsVersion: 2, customerNote: DEFAULT_CUSTOMER_NOTE, nextProposalNo: 31
  };
}
function mergeSettings(s) {
  const d = defaultSettings(); s = s || {};
  if (!s.termsVersion) { if (!Array.isArray(s.terms) || s.terms.some(t => /^Install window:|^Your part:/.test(t))) s.terms = d.terms; s.termsVersion = 2; if (s.customerNote == null) s.customerNote = d.customerNote; }
  return { ...d, ...s, company: { ...d.company, ...(s.company || {}) }, fees: Array.isArray(s.fees) ? s.fees : [], terms: Array.isArray(s.terms) && s.terms.length ? s.terms : d.terms }; }

/* ---------- app state ---------- */
const S = {
  settings: defaultSettings(), jobs: [], job: null, img: null, imgURL: null, view: 'jobs',
  tool: 'select', night: false, draft: null, scaleDraft: [], selected: null, history: [],
  v: { s: 1, ox: 0, oy: 0 }, needFit: true, thumbs: new Map(), newOpen: false, confirmDel: null
};
let saveJobT, saveSetT;
function touchJob() { if (!S.job) return; S.job.updatedAt = Date.now(); clearTimeout(saveJobT); const j = S.job; saveJobT = setTimeout(() => Store.saveJob(j), 300); }
function touchSettings() { clearTimeout(saveSetT); saveSetT = setTimeout(() => Store.setKV('settings', S.settings), 300); }

function newJob(customer) {
  return normalizeJob({
    id: uid(), createdAt: Date.now(), updatedAt: Date.now(), status: 'draft', customer,
    photoId: null, photoW: 0, photoH: 0, scale: null, spacing: S.settings.defaultSpacing, color: 'warm', windows: [], options: [blankOption()],
    quote: { newCustomer: true, rate: null, fees: {}, wreathMarkup: null, garlandMarkup: null, garlandCost: S.settings.garlandCost, garlandLen: S.settings.garlandLen, mockups: 'both', snapshot: null }
  });
}

/* ---------- options: each job has 1+ options; lit windows are shared by all of them ---------- */
function blankOption() { return { id: uid(), name: '', shapes: [], siteC9: null, siteGarland: null, custom: [] }; }
function normalizeJob(job) {
  if (!job) return job;
  const q = job.quote || (job.quote = {});
  if (!Array.isArray(job.options) || !job.options.length) {
    const old = Array.isArray(job.shapes) ? job.shapes : [], o = blankOption();
    o.shapes = old.filter(s => s.type !== 'window'); o.siteC9 = q.siteC9 ?? null; o.siteGarland = q.siteGarland ?? null; o.custom = Array.isArray(q.custom) ? q.custom : [];
    job.windows = old.filter(s => s.type === 'window'); job.options = [o];
    if (job.renderings) { const r = {}; for (const [k, v] of Object.entries(job.renderings)) r[k.includes(':') ? k : o.id + ':' + k] = v; job.renderings = r; }
  }
  delete job.shapes; delete q.siteC9; delete q.siteGarland; delete q.custom;
  if (!Array.isArray(job.windows)) job.windows = [];
  job.options.forEach(o => { if (!Array.isArray(o.shapes)) o.shapes = []; if (!Array.isArray(o.custom)) o.custom = []; if (o.name == null) o.name = ''; });
  if (!job.options.some(o => o.id === job.activeOpt)) job.activeOpt = job.options[0].id;
  return job;
}
const cur = (job = S.job) => job.options.find(o => o.id === job.activeOpt) || job.options[0];
const allShapes = (job, opt) => [...job.windows, ...(opt || cur(job)).shapes];
function viewOf(job, opt) { opt = opt || cur(job); return { ...job, shapes: allShapes(job, opt), quote: { ...job.quote, siteC9: opt.siteC9, siteGarland: opt.siteGarland, custom: opt.custom } }; }
const optTitle = (job, o) => `Option ${job.options.indexOf(o) + 1}${o.name ? ' · ' + o.name : ''}`;
function addShape(s) { (s.type === 'window' ? S.job.windows : cur().shapes).push(s); }
function optTabsHTML(job) {
  return `<div class="opts" role="tablist" aria-label="Options">${job.options.map((o, i) => {
    const on = o.id === job.activeOpt, t = computeQuote(viewOf(job, o), S.settings).total;
    return `<button class="opt ${on ? 'on' : ''}" data-opt="${o.id}" role="tab" aria-selected="${on}">Option ${i + 1}<small>${money(t)}</small></button>`;
  }).join('')}</div>`;
}
function switchOpt(id) {
  if (S.view === 'trace') finishDraft();
  S.draft = null; S.job.activeOpt = id; S.selected = null; S.history = []; S.confirmOptDel = null; touchJob();
  if (S.view === 'trace') refreshTrace(); else if (S.view === 'quote') renderQuote();
}

/* ---------- measurement & pricing ---------- */
function ppf(job) { return job.scale && job.scale.feet > 0 ? dist(job.scale.a, job.scale.b) / job.scale.feet : null; }
function measure(job) {
  const P = ppf(job); const m = { scaled: !!P, c9: 0, garland: 0, wreaths: [], windows: 0 };
  for (const s of job.shapes) {
    if (s.type === 'c9') m.c9 += polyLen(s.points);
    else if (s.type === 'garland') m.garland += polyLen(s.points);
    else if (s.type === 'wreath') m.wreaths.push(s);
    else if (s.type === 'window') m.windows++;
  }
  m.c9 = P ? m.c9 / P : 0; m.garland = P ? m.garland / P : 0;
  return m;
}
function currentRates(st) { return { rateC9: st.rateC9, startup: st.startup, bufferPct: st.bufferPct, wreathMarkup: st.wreathMarkup, garlandMarkup: st.garlandMarkup, fees: JSON.parse(JSON.stringify(st.fees)) }; }
function computeQuote(job, st) {
  const q = job.quote, m = measure(job);
  const rates = q.snapshot ? q.snapshot.rates : currentRates(st);
  const rate = q.rate != null && q.rate !== '' ? num(q.rate) : rates.rateC9;
  const wMk = q.wreathMarkup != null && q.wreathMarkup !== '' ? num(q.wreathMarkup) : rates.wreathMarkup;
  const gMk = q.garlandMarkup != null && q.garlandMarkup !== '' ? num(q.garlandMarkup) : rates.garlandMarkup;
  const bufBase = rates.bufferPct != null ? rates.bufferPct : (st.bufferPct != null ? st.bufferPct : 10);
  const buf = q.buffer != null && q.buffer !== '' ? num(q.buffer) : bufBase;
  const c9Raw = Math.ceil(m.c9 - 1e-9), gRaw = Math.ceil(m.garland - 1e-9);
  const siteC9 = q.siteC9 != null && q.siteC9 !== '' && num(q.siteC9) > 0 ? num(q.siteC9) : null;
  const siteG = q.siteGarland != null && q.siteGarland !== '' && num(q.siteGarland) > 0 ? num(q.siteGarland) : null;
  const c9Ft = siteC9 != null ? Math.ceil(siteC9 - 1e-9) : Math.ceil(m.c9 * (1 + buf / 100) - 1e-9);
  const gFt = siteG != null ? Math.ceil(siteG - 1e-9) : Math.ceil(m.garland * (1 + buf / 100) - 1e-9);
  const gLen = Math.max(1, num(q.garlandLen, 9)), gCost = num(q.garlandCost, 0);
  const strands = gFt ? Math.ceil(gFt / gLen) : 0;
  const rows = [];
  if (c9Ft) rows.push({ label: 'C9 roofline lighting', detail: `${c9Ft} ft × ${money(rate)}/ft · install, takedown & storage`, amount: c9Ft * rate });
  if (strands) rows.push({ label: 'Garland', detail: `${gFt} ft · ${strands} strand${strands > 1 ? 's' : ''}, installed`, amount: strands * gCost * gMk, internal: { cost: strands * gCost } });
  const wreaths = m.wreaths.map((w, i) => ({ id: w.id, n: i + 1, size: w.size, cost: num(w.cost), price: num(w.cost) * wMk }));
  if (wreaths.length) rows.push({ label: wreaths.length > 1 ? `Wreaths (${wreaths.length})` : 'Wreath', detail: wreaths.map(w => `${w.size}″`).join(', ') + ', installed', amount: wreaths.reduce((s, w) => s + w.price, 0) });
  for (const f of rates.fees) {
    const on = q.fees[f.id] !== undefined ? q.fees[f.id] : !!f.defaultOn;
    if (!on) continue;
    if (f.kind === 'perFt') { if (c9Ft) rows.push({ label: f.name || 'Fee', detail: `${c9Ft} ft × ${money(num(f.amount))}/ft`, amount: c9Ft * num(f.amount) }); }
    else rows.push({ label: f.name || 'Fee', detail: '', amount: num(f.amount) });
  }
  for (const c of q.custom) if (c.desc || num(c.amount)) rows.push({ label: c.desc || 'Custom item', detail: '', amount: num(c.amount) });
  if (q.newCustomer) rows.push({ label: 'New customer startup', detail: 'Admin and materials cut to fit your home', amount: rates.startup });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { m, rows, total, deposit: q.newCustomer ? rates.startup : 0, buf, bufBase, c9Raw, gRaw, siteC9, siteG, rate, wMk, gMk, c9Ft, gFt, strands, gLen, gCost, wreaths, rates,
    bulbs: c9Ft ? Math.ceil((siteC9 != null ? siteC9 : m.c9) * 12 / job.spacing) : 0 };
}

/* ---------- rendering the scene ---------- */
const WARM = { core: '#FFF1CF', glow: '#FFC25E' };
const MULTI = [{ core: '#FF7A6E', glow: '#FF2A1A' }, { core: '#86F0A2', glow: '#16C24A' }, { core: '#9DBDFF', glow: '#2E66FF' }, { core: '#FFE98A', glow: '#FFC400' }, { core: '#FFB97A', glow: '#FF7A00' }];
const spriteCache = {};
function glowSprite(color) {
  if (spriteCache[color]) return spriteCache[color];
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, hexA(color, 1)); gr.addColorStop(0.22, hexA(color, 0.55)); gr.addColorStop(0.55, hexA(color, 0.14)); gr.addColorStop(1, hexA(color, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return (spriteCache[color] = c);
}
function tracePath(ctx, pts, close) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); if (close) ctx.closePath(); }
function walk(pts, step, cb) {
  if (pts.length < 2 || !(step > 0)) return;
  let carry = 0, idx = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = dist(a, b); if (!L) continue;
    let t = carry;
    while (t <= L + 1e-6) { cb({ x: a.x + (b.x - a.x) * t / L, y: a.y + (b.y - a.y) * t / L }, idx++); t += step; }
    carry = t - L;
  }
}
function orderQuad(pts) { const c = centroid(pts); return pts.slice().sort((p, q) => Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(q.y - c.y, q.x - c.x)); }

function drawWindow(ctx, pts, P) {
  if (pts.length < 4) return;
  const q = orderQuad(pts), c = centroid(q);
  const xs = q.map(p => p.x), ys = q.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys), R = Math.max(w, h) / 2;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45;
  const sp = glowSprite('#FFB25A'); ctx.drawImage(sp, c.x - w * 1.1, c.y - h * 1.1, w * 2.2, h * 2.2); ctx.restore();
  ctx.save(); tracePath(ctx, q, true);
  const g = ctx.createRadialGradient(c.x, c.y - h * 0.15, R * 0.05, c.x, c.y, R * 1.15);
  g.addColorStop(0, '#FFE9B8'); g.addColorStop(0.5, '#F6BC6A'); g.addColorStop(1, '#B46A2A');
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = Math.max(1.5, P * 0.12); ctx.strokeStyle = 'rgba(20,13,6,0.92)'; ctx.stroke(); ctx.restore();
}
function drawGarland(ctx, s, P, night, lights) {
  const w = Math.max(4, P * 0.62), pts = s.points; if (pts.length < 2) return;
  const rnd = rng(hashStr(s.id));
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  tracePath(ctx, pts, false); ctx.strokeStyle = night ? '#0A2014' : '#1D4B30'; ctx.lineWidth = w; ctx.stroke();
  const cols = night ? ['#163823', '#0D2618', '#1F452D', '#285233'] : ['#2F6B45', '#1A4430', '#3C7D52', '#4C8F5F'];
  ctx.lineWidth = Math.max(1, w * 0.09);
  walk(pts, w * 0.16, p => {
    for (let k = 0; k < 3; k++) {
      const a = rnd() * Math.PI * 2, r = rnd() * w * 0.42, L = w * (0.22 + rnd() * 0.25), b = a + (rnd() - 0.5) * 1.2;
      const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      ctx.strokeStyle = cols[(rnd() * cols.length) | 0]; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(b) * L, y + Math.sin(b) * L); ctx.stroke();
    }
  });
  ctx.restore();
  if (night && s.lit !== false) walk(pts, w * 0.75, p => { const a = rnd() * Math.PI * 2, r = rnd() * w * 0.3; lights.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, r: Math.max(0.8, w * 0.07), pal: WARM }); });
}
function drawWreath(ctx, s, P, night, lights) {
  const c = s.points[0], R = (s.size / 12) * P / 2, t = R * 0.42, rnd = rng(hashStr(s.id));
  ctx.save(); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(c.x, c.y, R * 0.78, 0, Math.PI * 2); ctx.lineWidth = t; ctx.strokeStyle = night ? '#0A2014' : '#1D4B30'; ctx.stroke();
  const cols = night ? ['#163823', '#0D2618', '#1F452D', '#285233'] : ['#2F6B45', '#1A4430', '#3C7D52', '#4C8F5F'];
  const N = Math.min(420, Math.max(70, Math.round(R * 4)));
  ctx.lineWidth = Math.max(0.8, t * 0.09);
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2, rr = R * 0.78 + (rnd() - 0.5) * t * 1.05, L = t * (0.22 + rnd() * 0.3), b = a + Math.PI / 2 + (rnd() - 0.5) * 1.6;
    const x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr;
    ctx.strokeStyle = cols[(rnd() * cols.length) | 0]; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(b) * L, y + Math.sin(b) * L); ctx.stroke();
  }
  const by = c.y + R * 0.78; ctx.fillStyle = night ? '#8E1C14' : '#C1121F';
  ctx.beginPath(); ctx.moveTo(c.x, by); ctx.lineTo(c.x - R * 0.22, by + R * 0.5); ctx.lineTo(c.x - R * 0.08, by + R * 0.45); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(c.x, by); ctx.lineTo(c.x + R * 0.22, by + R * 0.5); ctx.lineTo(c.x + R * 0.08, by + R * 0.45); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(c.x - R * 0.2, by - R * 0.02, R * 0.22, R * 0.12, -0.35, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(c.x + R * 0.2, by - R * 0.02, R * 0.22, R * 0.12, 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = night ? '#6E140E' : '#9A0E18'; ctx.beginPath(); ctx.arc(c.x, by, R * 0.075, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (night) for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2 + rnd() * 0.2, rr = R * 0.78 + (rnd() - 0.5) * t * 0.6; lights.push({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr, r: Math.max(0.9, R * 0.045), pal: WARM }); }
}
/* Dusk grade: blue sky becomes a sunset gradient, the house turns warm and a little darker,
   and traced windows glow from inside while their frames and blinds stay visible. */
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SKY = [[0, [44, 58, 118]], [0.42, [118, 96, 158]], [0.72, [226, 124, 120]], [1, [250, 156, 84]]];
function skyAt(t) { for (let i = 1; i < SKY.length; i++) if (t <= SKY[i][0]) { const [t0, a] = SKY[i - 1], [t1, b] = SKY[i], k = (t - t0) / (t1 - t0); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; } return SKY[SKY.length - 1][1]; }
const LUT = [0.8, 0.68, 0.57].map(f => { const a = new Float32Array(256); for (let v = 0; v < 256; v++) a[v] = 255 * Math.pow(v / 255, 1.18) * f; return a; });
const duskCache = new Map();
function valueNoise(seed) {
  const N = 256, r = rng(seed), g = new Float32Array(N * N); for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const at = (a, b) => g[((b & 255) * N) + (a & 255)];
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), dd = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + dd) * u * v;
  };
}
function duskBase(job, img) {
  const key = job.photoId + ':' + job.photoW;
  if (duskCache.has(key)) return duskCache.get(key);
  const W = job.photoW, H = job.photoH, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, W, H);
  const o = document.createElement('canvas'); o.width = W; o.height = H; o.getContext('2d').drawImage(img, 0, 0, W, H);
  let id; try { id = g.getImageData(0, 0, W, H); } catch (e) { return null; }
  const d = id.data, nz = valueNoise(hashStr(job.photoId || 'x')), sx = 1600 / W;
  for (let y = 0; y < H; y++) {
    const vw = 1 - smooth(0.5, 0.75, y / H), ty = Math.min(1, (y / H) / 0.62), sc = skyAt(ty);
    const cc = [sc[0] * 0.55 + 255 * 0.45, sc[1] * 0.55 + 196 * 0.45, sc[2] * 0.55 + 184 * 0.45];
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const k = vw ? vw * smooth(22, 70, b - r) * smooth(105, 150, b) : 0;
      // dusk tone with softened contrast so hard daytime shadows read gentler
      let R = LUT[0][r], G = LUT[1][gg], B = LUT[2][b];
      R = 104 + (R - 104) * 0.8; G = 92 + (G - 92) * 0.8; B = 84 + (B - 84) * 0.8;
      if (k > 0) {
        const n = 0.62 * nz(x * sx / 210, y * sx / 46) + 0.38 * nz(x * sx / 70 + 40, y * sx / 18 + 40);
        const cl = smooth(0.48, 0.82, n) * (0.35 + 0.65 * ty) * 0.6;
        const SR = sc[0] + (cc[0] - sc[0]) * cl, SG = sc[1] + (cc[1] - sc[1]) * cl, SB = sc[2] + (cc[2] - sc[2]) * cl;
        R += (SR - R) * k; G += (SG - G) * k; B += (SB - B) * k;
      }
      d[i] = R; d[i + 1] = G; d[i + 2] = B;
    }
  }
  g.putImageData(id, 0, 0);
  // gentle vignette and darker foreground keep the eye on the house
  const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(12,10,26,0)'); vg.addColorStop(1, 'rgba(12,10,26,0.5)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  const fg = g.createLinearGradient(0, H * 0.7, 0, H); fg.addColorStop(0, 'rgba(8,8,18,0)'); fg.addColorStop(1, 'rgba(8,8,18,0.35)'); g.fillStyle = fg; g.fillRect(0, H * 0.7, W, H * 0.3);
  const out = { base: c, orig: o, winKey: null, win: null };
  duskCache.set(key, out); return out;
}
function duskWithWindows(job, img) {
  const dk = duskBase(job, img); if (!dk) return null;
  const wins = job.shapes.filter(s => s.type === 'window' && s.points.length === 4);
  const key = JSON.stringify(wins.map(w => w.points));
  if (dk.winKey === key) return dk.win;
  const W = job.photoW, H = job.photoH, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(dk.base, 0, 0);
  const og = dk.orig.getContext('2d', { willReadFrequently: true });
  for (const w of wins) {
    const q = orderQuad(w.points), xs = q.map(p => p.x), ys = q.map(p => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(W, Math.ceil(Math.max(...xs))), y1 = Math.min(H, Math.ceil(Math.max(...ys)));
    const bw = x1 - x0, bh = y1 - y0; if (bw < 2 || bh < 2) continue;
    const m = document.createElement('canvas'); m.width = bw; m.height = bh; const mg = m.getContext('2d');
    mg.translate(-x0, -y0); tracePath(mg, q, true); mg.fillStyle = '#000'; mg.fill();
    const md = mg.getImageData(0, 0, bw, bh).data, od = og.getImageData(x0, y0, bw, bh).data, bd = g.getImageData(x0, y0, bw, bh);
    const dd = bd.data, cxw = bw / 2, cyw = bh * 0.42;
    for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
      const i = (yy * bw + xx) * 4, a = md[i + 3] / 255; if (!a) continue;
      const L = (0.3 * od[i] + 0.59 * od[i + 1] + 0.11 * od[i + 2]) / 255;
      const f = smooth(0.035, 0.15, L), rr = 1 - 0.3 * Math.min(1, Math.hypot((xx - cxw) / cxw, (yy - cyw) / (bh * 0.6)));
      const lift = 0.85 + 0.15 * L, tr = 52 + (255 * rr * lift - 52) * f, tg = 30 + (222 * rr * lift - 30) * f, tb = 14 + (158 * rr * lift - 14) * f;
      dd[i] = dd[i] + (tr - dd[i]) * a; dd[i + 1] = dd[i + 1] + (tg - dd[i + 1]) * a; dd[i + 2] = dd[i + 2] + (tb - dd[i + 2]) * a;
    }
    g.putImageData(bd, x0, y0);
  }
  dk.winKey = key; dk.win = c; return c;
}
function windowSpill(ctx, pts) {
  const q = orderQuad(pts), c = centroid(q), xs = q.map(p => p.x), ys = q.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4;
  ctx.drawImage(glowSprite('#FFB25A'), c.x - w * 1.15, c.y - h * 1.15, w * 2.3, h * 2.3); ctx.restore();
}
function renderScene(ctx, job, img, night, color) {
  const W = job.photoW, H = job.photoH, P = ppf(job) || W / 60;
  const lights = [];
  if (night) {
    const dusk = duskWithWindows(job, img);
    if (dusk) { ctx.drawImage(dusk, 0, 0, W, H); for (const s of job.shapes) if (s.type === 'window' && s.points.length === 4) windowSpill(ctx, s.points); }
    else { ctx.drawImage(img, 0, 0, W, H); ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(205,170,140)'; ctx.fillRect(0, 0, W, H); ctx.restore(); for (const s of job.shapes) if (s.type === 'window') drawWindow(ctx, s.points, P); }
  } else ctx.drawImage(img, 0, 0, W, H);
  for (const s of job.shapes) if (s.type === 'garland') drawGarland(ctx, s, P, night, lights);
  for (const s of job.shapes) if (s.type === 'wreath') drawWreath(ctx, s, P, night, lights);
  if (!night) return;
  const step = (job.spacing / 12) * P;
  for (const s of job.shapes) if (s.type === 'c9') walk(s.points, step, (p, i) => lights.push({ x: p.x, y: p.y, r: Math.max(1.2, P * 0.16), pal: color === 'multi' ? MULTI[i % MULTI.length] : WARM, wash: true }));
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) if (l.wash) { const R = step * 3; ctx.globalAlpha = 0.13; ctx.drawImage(glowSprite(l.pal.glow), l.x - R, l.y - R, 2 * R, 2 * R); }
  for (const l of lights) { const R = l.r * 5.5; ctx.globalAlpha = 0.75; ctx.drawImage(glowSprite(l.pal.glow), l.x - R, l.y - R, 2 * R, 2 * R); }
  ctx.restore();
  ctx.save(); for (const l of lights) { ctx.fillStyle = l.pal.core; ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
}
function renderMockup(job, img, color, maxW) {
  const k = Math.min(1, (maxW || job.photoW) / job.photoW);
  const c = document.createElement('canvas'); c.width = Math.round(job.photoW * k); c.height = Math.round(job.photoH * k);
  const g = c.getContext('2d'); g.scale(k, k); renderScene(g, job, img, true, color); return c;
}

/* ---------- trace editor ---------- */
const cv = $('#cv'), cx = cv.getContext('2d');
let cssW = 0, cssH = 0, dpr = 1;
function resizeCanvas() {
  const r = $('#stage').getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cssW = r.width; cssH = r.height; cv.width = Math.max(1, Math.round(cssW * dpr)); cv.height = Math.max(1, Math.round(cssH * dpr));
  if (S.needFit) fitView(); draw();
}
new ResizeObserver(() => { if (S.view === 'trace') resizeCanvas(); }).observe($('#stage'));
function fitView() {
  if (!S.job || !S.job.photoW || !cssW) return;
  const s = Math.min(cssW / S.job.photoW, cssH / S.job.photoH) * 0.97;
  S.v = { s, ox: (cssW - S.job.photoW * s) / 2, oy: (cssH - S.job.photoH * s) / 2 }; S.fitS = s; S.needFit = false;
}
const toImg = p => ({ x: (p.x - S.v.ox) / S.v.s, y: (p.y - S.v.oy) / S.v.s });
const toScr = p => ({ x: p.x * S.v.s + S.v.ox, y: p.y * S.v.s + S.v.oy });
let rafPending = false;
function draw() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; drawNow(); }); }
function drawNow() {
  cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.fillStyle = '#070D0B'; cx.fillRect(0, 0, cssW, cssH);
  const job = S.job; if (!job || !S.img) { cx.fillStyle = '#A2B2AA'; cx.font = '600 15px "Noto Sans", sans-serif'; cx.textAlign = 'center'; cx.fillText('Add a photo to this job to start tracing.', cssW / 2, cssH / 2); return; }
  cx.save(); cx.translate(S.v.ox, S.v.oy); cx.scale(S.v.s, S.v.s); renderScene(cx, viewOf(job), S.img, S.night, job.color); cx.restore();
  drawOverlay();
}
function drawOverlay() {
  const job = S.job, c = cx;
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  for (const s of allShapes(job)) {
    const sel = s.id === S.selected;
    if (S.night && !sel) continue;
    const pts = s.points.map(toScr);
    if (s.type === 'c9') { c.setLineDash([]); c.lineWidth = 3; c.strokeStyle = sel ? '#FFFFFF' : '#FFD58A'; tracePath(c, pts, false); c.stroke(); c.fillStyle = '#FFD58A'; pts.forEach(p => { c.beginPath(); c.arc(p.x, p.y, 3, 0, 7); c.fill(); }); }
    else if (s.type === 'window') { c.setLineDash([6, 5]); c.lineWidth = 2; c.strokeStyle = sel ? '#FFFFFF' : '#9CC8FF'; tracePath(c, orderQuad(pts), true); c.stroke(); c.setLineDash([]); if (!S.night) { c.fillStyle = 'rgba(156,200,255,0.12)'; c.fill(); } }
    else if (s.type === 'garland' && sel) { c.setLineDash([6, 5]); c.lineWidth = 2; c.strokeStyle = '#FFFFFF'; tracePath(c, pts, false); c.stroke(); c.setLineDash([]); }
    else if (s.type === 'wreath' && sel) { const R = (s.size / 12) * (ppf(job) || job.photoW / 60) / 2 * S.v.s; c.setLineDash([6, 5]); c.lineWidth = 2; c.strokeStyle = '#FFFFFF'; c.beginPath(); c.arc(pts[0].x, pts[0].y, R + 6, 0, 7); c.stroke(); c.setLineDash([]); }
    if (sel) pts.forEach(p => { c.beginPath(); c.arc(p.x, p.y, 9, 0, 7); c.fillStyle = '#FFFFFF'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#1B1305'; c.stroke(); });
  }
  if (job.scale && (!S.night || S.tool === 'scale') && !S.scaleDraft.length) {
    const a = toScr(job.scale.a), b = toScr(job.scale.b);
    c.setLineDash([8, 6]); c.lineWidth = 2.5; c.strokeStyle = '#FF6B5E'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
    [a, b].forEach(p => { c.beginPath(); c.arc(p.x, p.y, 5, 0, 7); c.fillStyle = '#FF6B5E'; c.fill(); });
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, label = `${job.scale.feet} ft`;
    c.font = '700 13px "Noto Sans", sans-serif'; const w = c.measureText(label).width + 16;
    c.fillStyle = '#FF6B5E'; c.beginPath(); c.roundRect ? c.roundRect(m.x - w / 2, m.y - 26, w, 22, 11) : c.rect(m.x - w / 2, m.y - 26, w, 22); c.fill();
    c.fillStyle = '#1A0503'; c.textAlign = 'center'; c.fillText(label, m.x, m.y - 10);
  }
  if (S.scaleDraft.length) { const pts = S.scaleDraft.map(toScr); c.lineWidth = 2.5; c.strokeStyle = '#FF6B5E'; tracePath(c, pts, false); c.stroke(); pts.forEach(p => { c.beginPath(); c.arc(p.x, p.y, 7, 0, 7); c.fillStyle = '#FF6B5E'; c.fill(); }); }
  if (S.draft && S.draft.points.length) {
    const pts = S.draft.points.map(toScr), col = S.draft.type === 'garland' ? '#8FE0B0' : S.draft.type === 'window' ? '#9CC8FF' : '#FFD58A';
    c.setLineDash([7, 6]); c.lineWidth = 3; c.strokeStyle = col; tracePath(c, pts, S.draft.type === 'window' && pts.length === 4); c.stroke(); c.setLineDash([]);
    pts.forEach((p, i) => { c.beginPath(); c.arc(p.x, p.y, i === pts.length - 1 ? 9 : 5, 0, 7); c.fillStyle = col; c.fill(); });
    if (S.draft.type !== 'window' && pts.length >= 2) { const p = pts[pts.length - 1]; c.beginPath(); c.arc(p.x, p.y, 16, 0, 7); c.lineWidth = 2; c.strokeStyle = col; c.stroke(); }
  }
  c.restore();
}

/* hit testing */
function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy; let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); }
function inPoly(p, pts) { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside; } return inside; }
function hitShape(ip) {
  const tol = 16 / S.v.s, P = ppf(S.job) || S.job.photoW / 60;
  const list = allShapes(S.job);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (s.type === 'wreath') { if (dist(ip, s.points[0]) <= (s.size / 12) * P / 2 + tol) return s; }
    else if (s.type === 'window') { const q = orderQuad(s.points); if (inPoly(ip, q)) return s; }
    else { const extra = s.type === 'garland' ? P * 0.31 : 0; for (let k = 1; k < s.points.length; k++) if (segDist(ip, s.points[k - 1], s.points[k]) <= tol + extra) return s; }
  }
  return null;
}
function handleHit(pos) {
  const s = S.job && allShapes(S.job).find(x => x.id === S.selected); if (!s) return null;
  for (let i = 0; i < s.points.length; i++) if (dist(toScr(s.points[i]), pos) <= 22) return { s, i };
  if (s.type === 'wreath' && hitShape(toImg(pos)) === s) return { s, i: 0 };
  return null;
}

/* history */
function snapshot() { const o = cur(); return JSON.stringify({ windows: S.job.windows, shapes: o.shapes, opt: o.id, scale: S.job.scale }); }
function pushHistory() { S.history.push(snapshot()); if (S.history.length > 80) S.history.shift(); }
function undo() {
  if (S.draft && S.draft.points.length) { S.draft.points.pop(); if (!S.draft.points.length) S.draft = null; return refreshTrace(); }
  if (S.scaleDraft.length) { S.scaleDraft.pop(); return refreshTrace(); }
  const h = S.history.pop(); if (!h) return toast('Nothing to undo.');
  const o = JSON.parse(h); S.job.windows = o.windows || []; const op = S.job.options.find(x => x.id === o.opt); if (op) op.shapes = o.shapes; S.job.scale = o.scale; S.selected = null; touchJob(); refreshTrace();
}

/* tools */
const HINTS = {
  select: 'Tap a line, window or wreath to select it. Drag its white handles to adjust. Drag empty space to move around; pinch to zoom.',
  scale: 'Tap both ends of something with a known size, like the garage door. Then enter its real length.',
  c9: 'Tap along the roofline to place points. Tap the last point again, or press Finish line, to end it.',
  garland: 'Tap along where the garland goes. Tap the last point again, or press Finish line, to end it.',
  window: 'Tap the four corners of a window. It lights up in the night view.',
  wreath: 'Tap where the wreath goes. Set its size and cost in the panel below.'
};
function setTool(t) { finishDraft(); S.scaleDraft = []; S.tool = t; if (t !== 'select') S.selected = null; refreshTrace(); }
function finishDraft() {
  const d = S.draft; S.draft = null; if (!d) return;
  const need = d.type === 'window' ? 4 : 2;
  if (d.points.length >= need) { pushHistory(); const s = { id: uid(), type: d.type, points: d.points }; if (d.type === 'garland') s.lit = true; addShape(s); touchJob(); }
}
function tap(pos) {
  const job = S.job; if (!job || !S.img) return;
  const ip = toImg(pos);
  if (ip.x < -50 || ip.y < -50 || ip.x > job.photoW + 50 || ip.y > job.photoH + 50) return;
  switch (S.tool) {
    case 'select': { const h = hitShape(ip); S.selected = h ? h.id : null; break; }
    case 'scale': { if (S.scaleDraft.length >= 2) S.scaleDraft = []; S.scaleDraft.push(ip); if (S.scaleDraft.length === 2) setTimeout(() => { const i = $('#scale-ft'); i.focus(); i.select(); }, 30); break; }
    case 'c9': case 'garland': {
      if (S.draft && S.draft.type !== S.tool) finishDraft();
      if (!S.draft) S.draft = { type: S.tool, points: [] };
      const pts = S.draft.points;
      if (pts.length >= 2 && dist(toScr(pts[pts.length - 1]), pos) <= 18) { finishDraft(); break; }
      pts.push(ip); break;
    }
    case 'window': {
      if (!S.draft || S.draft.type !== 'window') S.draft = { type: 'window', points: [] };
      S.draft.points.push(ip); if (S.draft.points.length === 4) finishDraft(); break;
    }
    case 'wreath': {
      pushHistory(); const s = { id: uid(), type: 'wreath', points: [ip], size: 36, cost: S.settings.wreathCost };
      addShape(s); S.selected = s.id; S.tool = 'select'; touchJob();
      if (!job.scale) toast('Set the scale so the wreath size is accurate.');
      break;
    }
  }
  refreshTrace();
}

/* pointer gestures: tap = place, drag = pan or move a handle, pinch = zoom */
const ptrs = new Map(); let gest = null;
const posOf = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
cv.addEventListener('pointerdown', e => {
  if (!S.job) return; try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  const p = posOf(e); ptrs.set(e.pointerId, p);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; gest = { type: 'pinch', d0: dist(a, b), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { ...S.v } }; }
  else if (ptrs.size === 1) gest = { type: 'pending', start: p, v0: { ...S.v }, hit: S.tool === 'select' ? handleHit(p) : null };
});
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId) || !gest) return;
  const p = posOf(e); ptrs.set(e.pointerId, p);
  if (gest.type === 'pinch' && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const s = Math.max(S.fitS * 0.5, Math.min(S.fitS * 10, gest.v0.s * dist(a, b) / gest.d0));
    const ip = { x: (gest.m0.x - gest.v0.ox) / gest.v0.s, y: (gest.m0.y - gest.v0.oy) / gest.v0.s };
    S.v = { s, ox: m.x - ip.x * s, oy: m.y - ip.y * s }; draw(); return;
  }
  if (gest.type === 'pending' && dist(p, gest.start) > 8) { if (gest.hit) { pushHistory(); gest.type = 'drag'; } else gest.type = 'pan'; }
  if (gest.type === 'pan') { S.v = { ...S.v, ox: gest.v0.ox + p.x - gest.start.x, oy: gest.v0.oy + p.y - gest.start.y }; draw(); }
  else if (gest.type === 'drag') { gest.hit.s.points[gest.hit.i] = toImg(p); draw(); }
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  const p = posOf(e); ptrs.delete(e.pointerId);
  if (gest && gest.type === 'pending' && ptrs.size === 0 && e.type === 'pointerup') tap(p);
  if (gest && gest.type === 'drag') { touchJob(); refreshTrace(); }
  if (ptrs.size === 0) gest = null; else if (gest && gest.type === 'pinch') gest = { type: 'idle' };
}
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => {
  if (!S.job) return; e.preventDefault(); const p = posOf(e), ip = toImg(p);
  const s = Math.max(S.fitS * 0.5, Math.min(S.fitS * 10, S.v.s * Math.exp(-e.deltaY * 0.0015)));
  S.v = { s, ox: p.x - ip.x * s, oy: p.y - ip.y * s }; draw();
}, { passive: false });
window.addEventListener('keydown', e => {
  if (S.view !== 'trace' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === 'Enter') { finishDraft(); refreshTrace(); }
  if (e.key === 'Escape') { S.draft = null; S.scaleDraft = []; S.selected = null; refreshTrace(); }
});

function renderOptPanel() {
  const job = S.job, o = cur(job), n = job.options.length, idx = job.options.indexOf(o) + 1, box = $('#opt-panel');
  const del = S.confirmOptDel === o.id, keepName = document.activeElement && document.activeElement.id === 'opt-name';
  if (keepName) { $('#optchip').textContent = optTitle(job, o); return; }
  box.innerHTML = `<h2>Options</h2>${optTabsHTML(job)}
    <label class="f" for="opt-name" style="margin-top:10px">Name for Option ${idx} (optional)<input type="text" id="opt-name" value="${esc(o.name)}" placeholder="e.g. Roofline only" autocomplete="off"></label>
    <div class="row" style="margin-top:8px">
      <button class="btn small" id="opt-copy">Copy into new option</button>
      <button class="btn small" id="opt-blank">New blank option</button>
      ${n > 1 ? (del ? `<button class="btn small danger" id="opt-del-yes">Delete Option ${idx} for good</button><button class="btn small" id="opt-del-no">Keep</button>` : `<button class="btn small danger" id="opt-del">Delete option</button>`) : ''}
    </div>
    ${n > 1 ? '<p class="muted" style="font-size:13px;margin:8px 0 0">Each option has its own lights, garland and wreaths. Lit windows and the scale are shared.</p>' : ''}`;
  $('#optchip').hidden = n < 2; $('#optchip').textContent = optTitle(job, o);
}
$('#opt-panel').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || !S.job) return;
  const job = S.job;
  if (document.activeElement && document.activeElement.id === 'opt-name') document.activeElement.blur();
  if (t.dataset.opt) return switchOpt(t.dataset.opt);
  if (t.id === 'opt-copy' || t.id === 'opt-blank') {
    finishDraft();
    const src = cur(job), o = blankOption();
    if (t.id === 'opt-copy') { const c = JSON.parse(JSON.stringify(src)); o.shapes = c.shapes.map(s => ({ ...s, id: uid() })); o.custom = c.custom; }
    job.options.push(o); switchOpt(o.id);
    toast(t.id === 'opt-copy' ? `Option ${job.options.length} started as a copy. Add or remove lights to make it different.` : `Option ${job.options.length} added. Trace its lights.`);
    if (t.id === 'opt-blank') setTool('c9');
  }
  if (t.id === 'opt-del') { S.confirmOptDel = cur(job).id; renderOptPanel(); }
  if (t.id === 'opt-del-no') { S.confirmOptDel = null; renderOptPanel(); }
  if (t.id === 'opt-del-yes') {
    const o = cur(job);
    for (const col of ['warm', 'multi']) { const k = o.id + ':' + col; if (job.renderings && job.renderings[k]) { Store.deletePhoto(job.renderings[k]); delete job.renderings[k]; } }
    job.options = job.options.filter(x => x !== o); switchOpt(job.options[0].id); toast('Option deleted.');
  }
});
$('#opt-panel').addEventListener('input', e => { if (e.target.id !== 'opt-name') return; cur().name = e.target.value; $('#optchip').textContent = optTitle(S.job, cur()); touchJob(); });
function refreshTrace() { renderSide(); draw(); }
function renderSide() {
  const job = S.job; if (!job) return;
  renderOptPanel();
  $$('#seg-mode button').forEach(b => b.classList.toggle('on', (b.dataset.mode === 'night') === S.night));
  $$('#seg-color button').forEach(b => b.classList.toggle('on', b.dataset.color === job.color));
  $$('#seg-spacing button').forEach(b => b.classList.toggle('on', +b.dataset.spacing === job.spacing));
  $$('#tools .tool').forEach(b => { const on = b.dataset.tool === S.tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $('#hint').textContent = HINTS[S.tool];
  $('#draft-actions').hidden = !(S.draft && S.draft.type !== 'window' && S.draft.points.length);
  $('#scale-form').hidden = S.scaleDraft.length !== 2;
  // selection panel
  const sel = allShapes(job).find(s => s.id === S.selected), box = $('#sel-props');
  if (!sel) { box.hidden = true; box.innerHTML = ''; }
  else {
    box.hidden = false; const P = ppf(job);
    let h = `<h2>Selected ${sel.type === 'c9' ? 'C9 line' : sel.type}</h2>`;
    if (sel.type === 'window' && job.options.length > 1) h += `<p class="muted" style="font-size:13px;margin:0 0 8px">Lit windows show on every option.</p>`;
    if (sel.type === 'c9' || sel.type === 'garland') h += `<p class="num" style="margin:0 0 10px">${P ? (polyLen(sel.points) / P).toFixed(1) + ' ft' : 'Set the scale to measure'}</p>`;
    if (sel.type === 'garland') h += `<label class="check"><input type="checkbox" id="sel-lit" ${sel.lit !== false ? 'checked' : ''}> Lit garland</label>`;
    if (sel.type === 'wreath') h += `<label class="f" for="sel-size">Size: <span id="sel-size-v">${sel.size}″</span></label><input type="range" id="sel-size" min="12" max="72" step="2" value="${sel.size}">
      <label class="f" for="sel-cost" style="margin-top:8px">What this wreath cost you</label><div class="money"><span>$</span><input type="number" inputmode="decimal" step="0.01" id="sel-cost" value="${sel.cost ?? ''}"></div>`;
    h += `<div class="row" style="margin-top:12px"><button class="btn small danger" id="btn-del">Delete</button></div>`;
    box.innerHTML = h;
  }
  // totals
  const q = computeQuote(viewOf(job), S.settings), m = q.m;
  let t = '';
  if (!m.scaled) t += `<div class="warnbox">Set the scale first so lengths turn into feet. Use the Scale tool on the garage door.</div>`;
  t += `<div class="tot"><span>C9 measured</span><span>${m.scaled ? q.c9Raw + ' ft · ' + q.bulbs + ' bulbs' : '—'}</span></div>`;
  t += `<div class="tot"><span>C9 bid ${q.siteC9 != null ? '(site measured)' : '(+' + q.buf + '%)'}</span><span>${m.scaled || q.siteC9 != null ? q.c9Ft + ' ft' : '—'}</span></div>`;
  t += `<div class="tot"><span>Garland bid ${q.siteG != null ? '(site measured)' : '(+' + q.buf + '%)'}</span><span>${m.scaled || q.siteG != null ? q.gFt + ' ft · ' + q.strands + ' strands' : '—'}</span></div>`;
  t += `<div class="tot"><span>Wreaths</span><span>${m.wreaths.length}</span></div>`;
  t += `<div class="tot"><span>Lit windows</span><span>${m.windows}</span></div>`;
  t += `<div class="tot big"><span>${job.options.length > 1 ? 'Option ' + (job.options.indexOf(cur(job)) + 1) + ' total' : 'Quote total'}</span><span>${money(q.total)}</span></div>`;
  $('#totals').innerHTML = t;
  $('#btn-undo').disabled = !(S.history.length || S.draft || S.scaleDraft.length);
}
$('#tools').addEventListener('click', e => { const b = e.target.closest('.tool'); if (b) setTool(b.dataset.tool); });
$('#seg-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.night = b.dataset.mode === 'night'; refreshTrace(); });
$('#seg-color').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.job.color = b.dataset.color; if (!S.night) S.night = true; touchJob(); refreshTrace(); });
$('#seg-spacing').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.job.spacing = +b.dataset.spacing; touchJob(); refreshTrace(); });
$('#btn-finish').addEventListener('click', () => { finishDraft(); refreshTrace(); });
$('#btn-cancel').addEventListener('click', () => { S.draft = null; refreshTrace(); });
$('#btn-undo').addEventListener('click', undo);
$('#btn-fit').addEventListener('click', () => { S.needFit = true; fitView(); draw(); });
$('#btn-cancel-scale').addEventListener('click', () => { S.scaleDraft = []; refreshTrace(); });
$('#btn-set-scale').addEventListener('click', () => {
  const ft = num($('#scale-ft').value); if (!(ft > 0)) return toast('Enter the real length in feet, like 16.');
  if (dist(S.scaleDraft[0], S.scaleDraft[1]) < 5) return toast('Those two points are too close together. Tap both ends again.');
  pushHistory(); S.job.scale = { a: S.scaleDraft[0], b: S.scaleDraft[1], feet: ft }; S.scaleDraft = []; touchJob();
  toast(`Scale set: ${ft} ft reference.`); setTool('c9');
});
$('#sel-props').addEventListener('input', e => {
  const sel = allShapes(S.job).find(s => s.id === S.selected); if (!sel) return;
  if (e.target.id === 'sel-size') { sel.size = +e.target.value; $('#sel-size-v').textContent = sel.size + '″'; touchJob(); draw(); }
  if (e.target.id === 'sel-cost') { sel.cost = num(e.target.value); S.settings.wreathCost = sel.cost; touchSettings(); touchJob(); }
  if (e.target.id === 'sel-lit') { sel.lit = e.target.checked; touchJob(); draw(); }
});
$('#sel-props').addEventListener('change', () => renderSide());
$('#sel-props').addEventListener('click', e => {
  if (e.target.id !== 'btn-del') return;
  pushHistory(); S.job.windows = S.job.windows.filter(s => s.id !== S.selected); const co = cur(); co.shapes = co.shapes.filter(s => s.id !== S.selected); S.selected = null; touchJob(); refreshTrace();
});
$('#photo-replace').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !S.job) return;
  await attachPhoto(S.job, f, true);
});

/* ---------- photos ---------- */
/* Photos are stored as data URLs (text). iPad Safari and some in-app browsers can fail to display
   image Blobs read back from device storage, so we never store or display Blobs. */
async function processPhoto(file) {
  const img = await loadImg(await blobToDataURL(file));
  const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
  return { data: c.toDataURL('image/jpeg', 0.86), w, h };
}
const isSample = job => job.sample || /^Sample ·/.test(job.customer.name);
async function photoData(job) {
  if (!job.photoId) return null;
  let v = null;
  try { v = await Store.getPhoto(job.photoId); } catch (e) { v = null; }
  if (v && typeof v !== 'string') { try { v = await blobToDataURL(v); await Store.putPhoto(job.photoId, v); } catch (e) { v = null; } }
  if (!v && isSample(job)) { v = await loadSamplePhoto(); if (v) { try { await Store.putPhoto(job.photoId, v); } catch (e) {} } }
  return v;
}
async function attachPhoto(job, file, replacing) {
  let p;
  try { p = await processPhoto(file); }
  catch (e) { toast("This photo couldn't be opened here. On iPad, pick it from Photos and it converts automatically. On a computer, save it as a JPG first."); return false; }
  const every = [...job.windows, ...job.options.flatMap(o => o.shapes)];
  if (replacing && every.length) {
    const kx = p.w / job.photoW, ky = p.h / job.photoH;
    if (Math.abs(kx - ky) > 0.02) { job.windows = []; job.options.forEach(o => { o.shapes = []; }); job.scale = null; toast('New photo has a different shape, so the tracing was cleared.'); }
    else { every.forEach(s => s.points.forEach(pt => { pt.x *= kx; pt.y *= ky; })); if (job.scale) { ['a', 'b'].forEach(k => { job.scale[k].x *= kx; job.scale[k].y *= ky; }); } }
  }
  if (job.photoId) await Store.deletePhoto(job.photoId);
  job.photoId = uid(); job.photoW = p.w; job.photoH = p.h;
  await Store.putPhoto(job.photoId, p.data); S.thumbs.delete(job.id);
  await Store.saveJob(job);
  if (S.job === job) { await loadJobImage(job); S.needFit = true; resizeCanvas(); refreshTrace(); }
  return true;
}
async function loadJobImage(job) {
  S.img = null;
  const d = await photoData(job); if (!d) { if (job.photoId) toast("This job's photo couldn't be loaded. Use Replace photo to add it again."); return; }
  try { S.img = await loadImg(d); } catch (e) { S.img = null; toast("This job's photo couldn't be loaded. Use Replace photo to add it again."); }
}
async function thumbURL(job) {
  if (S.thumbs.has(job.id)) return S.thumbs.get(job.id);
  const d = await photoData(job); if (!d) return '';
  S.thumbs.set(job.id, d); return d;
}

/* ---------- navigation ---------- */
function show(v) {
  if (['trace', 'quote', 'proposal'].includes(v) && !S.job) v = 'jobs';
  if (S.view === 'trace' && v !== 'trace') finishDraft();
  S.view = v;
  ['jobs', 'trace', 'quote', 'proposal', 'settings'].forEach(n => { $('#v-' + n).hidden = n !== v; });
  $$('.tab').forEach(t => { t.disabled = ['trace', 'quote', 'proposal'].includes(t.dataset.view) && !S.job; if (t.dataset.view === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  $('#jobname').textContent = S.job ? S.job.customer.name : '';
  $('main').scrollTop = 0;
  if (v === 'jobs') renderJobs();
  if (v === 'trace') { resizeCanvas(); refreshTrace(); }
  if (v === 'quote') renderQuote();
  if (v === 'proposal') renderProposal();
  if (v === 'settings') renderSettings();
}
$('.tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b && !b.disabled) show(b.dataset.view); });
async function openJob(id) {
  const job = S.jobs.find(j => j.id === id); if (!job) return;
  normalizeJob(job); S.job = job; S.history = []; S.draft = null; S.confirmOptDel = null; S.scaleDraft = []; S.selected = null; S.needFit = true;
  S.tool = job.scale ? 'select' : 'scale'; S.night = false;
  await loadJobImage(job); show('trace');
}

/* ---------- jobs view ---------- */
const STATUSES = ['draft', 'sent', 'accepted', 'installed', 'removed'];
async function renderJobs() {
  const el = $('#v-jobs'); const jobs = S.jobs.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  let h = `<div class="row" style="justify-content:space-between"><h1>Jobs</h1><div class="row">
    <button class="btn" id="btn-export">Back up all jobs</button>
    <label class="btn" for="import-file">Restore backup</label><input type="file" id="import-file" accept=".json,application/json" hidden>
    <button class="btn primary" id="btn-new">New job</button></div></div>`;
  if (!Store.onDevice) h += `<div class="warnbox" style="margin-top:12px">This browser isn't letting the app save to the device, so jobs only last until you close it. Open it from the Home Screen icon, or back up before closing.</div>`;
  h += `<form class="card newjob" id="newjob" ${S.newOpen ? '' : 'hidden'}>
    <h2>New job</h2>
    <div class="grid">
      <label class="f" for="nj-name">Customer name<input type="text" id="nj-name" required autocomplete="off"></label>
      <label class="f" for="nj-address">Address<input type="text" id="nj-address" autocomplete="off"></label>
      <label class="f" for="nj-phone">Phone<input type="tel" id="nj-phone" autocomplete="off"></label>
      <label class="f" for="nj-email">Email<input type="email" id="nj-email" autocomplete="off"></label>
      <label class="f" for="nj-photo">House photo<input type="file" id="nj-photo" accept="image/*"></label>
      <label class="check" for="nj-returning"><input type="checkbox" id="nj-returning"> Returning customer (no startup fee)</label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Create job and start tracing</button><button class="btn" type="button" id="btn-new-cancel">Cancel</button></div>
  </form>`;
  if (!jobs.length) h += `<div class="empty" style="margin-top:16px">No jobs yet. Tap <b>New job</b>, add the customer and a straight-on photo of the house.</div>`;
  else h += `<div class="jobs">` + jobs.map(j => {
    const all = j.options.map(o => computeQuote(viewOf(j, o), S.settings)), q = all[0], del = S.confirmDel === j.id;
    const ts = all.map(x => x.total), priceTxt = all.length > 1 ? `${all.length} options · ${money(Math.min(...ts))}–${money(Math.max(...ts))}` : money(q.total);
    return `<article class="job" data-id="${j.id}">
      <div class="thumb" data-thumb="${j.id}"></div>
      <div class="body">
        <div class="row" style="justify-content:space-between"><div class="name">${esc(j.customer.name)}</div><span class="chip ${j.status}">${j.status}</span></div>
        <div class="meta">${esc(j.customer.address || 'No address')}</div>
        <div class="row" style="justify-content:space-between"><span class="total">${priceTxt}</span><span class="muted num" style="font-size:13px">${all.length > 1 ? '' : q.c9Ft ? q.c9Ft + ' ft C9' : 'Not measured'}</span></div>
        <label class="f" for="st-${j.id}">Status<select id="st-${j.id}" data-status="${j.id}">${STATUSES.map(s => `<option value="${s}" ${s === j.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
        <div class="row" style="margin-top:auto">
          <button class="btn primary small" data-open="${j.id}">Open</button>
          ${del ? `<button class="btn danger small" data-del-yes="${j.id}">Delete for good</button><button class="btn small" data-del-no="1">Keep</button>` : `<button class="btn small" data-del="${j.id}">Delete</button>`}
        </div>
      </div></article>`;
  }).join('') + `</div>`;
  el.innerHTML = h;
  for (const j of jobs) { const u = await thumbURL(j); const t = el.querySelector(`[data-thumb="${j.id}"]`); if (t && u) t.style.backgroundImage = `url("${u}")`; }
}
$('#v-jobs').addEventListener('click', async e => {
  const t = e.target;
  if (t.id === 'btn-new') { S.newOpen = true; renderJobs().then(() => $('#nj-name').focus()); }
  else if (t.id === 'btn-new-cancel') { S.newOpen = false; renderJobs(); }
  else if (t.id === 'btn-export') exportBackup();
  else if (t.dataset.open) openJob(t.dataset.open);
  else if (t.dataset.del) { S.confirmDel = t.dataset.del; renderJobs(); }
  else if (t.dataset.delNo) { S.confirmDel = null; renderJobs(); }
  else if (t.dataset.delYes) {
    const j = S.jobs.find(x => x.id === t.dataset.delYes);
    if (j) { await Store.deleteJob(j.id); if (j.photoId) await Store.deletePhoto(j.photoId); for (const id of Object.values(j.renderings || {})) await Store.deletePhoto(id); S.jobs = S.jobs.filter(x => x !== j); if (S.job === j) S.job = null; }
    S.confirmDel = null; toast('Job deleted.'); show('jobs');
  }
});
$('#v-jobs').addEventListener('change', async e => {
  if (e.target.dataset.status) { const j = S.jobs.find(x => x.id === e.target.dataset.status); j.status = e.target.value; j.updatedAt = Date.now(); await Store.saveJob(j); renderJobs(); }
  if (e.target.id === 'import-file') { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); }
});
$('#v-jobs').addEventListener('submit', async e => {
  e.preventDefault(); if (e.target.id !== 'newjob') return;
  const name = $('#nj-name').value.trim(); if (!name) return toast('Add the customer name first.');
  const job = newJob({ name, address: $('#nj-address').value.trim(), phone: $('#nj-phone').value.trim(), email: $('#nj-email').value.trim() });
  job.quote.newCustomer = !$('#nj-returning').checked;
  const f = $('#nj-photo').files[0];
  S.jobs.push(job); await Store.saveJob(job);
  if (f) await attachPhoto(job, f, false);
  S.newOpen = false; await openJob(job.id);
  if (!f) toast('Add a photo with Replace photo to start tracing.');
});

/* ---------- backup ---------- */
async function exportBackup() {
  const photos = {};
  for (const j of S.jobs) {
    if (j.photoId) { const d = await photoData(j); if (d) photos[j.photoId] = d; }
    for (const id of Object.values(j.renderings || {})) { const v = await Store.getPhoto(id); if (typeof v === 'string') photos[id] = v; }
  }
  const data = JSON.stringify({ app: 'wehrle-quote-builder', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, jobs: S.jobs, photos });
  await offerFile(`wehrle-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([data], { type: 'application/json' }), 'Backup saved.');
}
async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'wehrle-quote-builder' || !Array.isArray(d.jobs)) throw new Error('not ours');
    for (const [id, u] of Object.entries(d.photos || {})) if (typeof u === 'string' && u.startsWith('data:image/')) await Store.putPhoto(id, u);
    let added = 0;
    for (const j of d.jobs) { normalizeJob(j); const i = S.jobs.findIndex(x => x.id === j.id); if (i >= 0) S.jobs[i] = j; else { S.jobs.push(j); added++; } await Store.saveJob(j); }
    if (d.settings) { S.settings = mergeSettings(d.settings); await Store.setKV('settings', S.settings); }
    S.thumbs.clear(); toast(`Restored ${d.jobs.length} job${d.jobs.length === 1 ? '' : 's'} (${added} new).`); renderJobs();
  } catch (e) { toast("That file isn't a Wehrle backup. Pick the .json file the Back up button saved."); }
}

/* ---------- saving & sharing files ----------
   iPad/iPhone: opens the share sheet (Messages, Mail, Save to Files, AirDrop).
   Computers: a normal download. iOS only opens the share sheet right after a tap, so if
   preparing a file took too long, a "ready" bar appears and the next tap shares it. */
const IS_TOUCH = (navigator.maxTouchPoints || 0) > 1 || /iPad|iPhone|iPod|Android/.test(navigator.userAgent);
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', json: 'application/json' };
function asFile(filename, data) { const ext = filename.split('.').pop().toLowerCase(); return new File([data], filename, { type: MIME[ext] || 'application/octet-stream' }); }
function canShareFile(file) { try { return IS_TOUCH && !!navigator.share && !!navigator.canShare && navigator.canShare({ files: [file] }); } catch (e) { return false; } }
function downloadFile(file) {
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
let pendingShare = null;
function hideShareBar() { $('#sharebar').hidden = true; if (pendingShare) { pendingShare.resolve(false); pendingShare = null; } }
async function offerFile(filename, data, okMsg) {
  const file = asFile(filename, data);
  if (!canShareFile(file)) { downloadFile(file); toast(okMsg || 'Saved to your Downloads.'); return true; }
  try { await navigator.share({ files: [file], title: filename }); toast(okMsg || 'Shared.'); return true; }
  catch (e) {
    if (e && e.name === 'AbortError') return false;
    if (e && e.name === 'NotAllowedError') return new Promise(resolve => { hideShareBar(); pendingShare = { file, resolve, okMsg }; $('#sharebar-name').textContent = file.name; $('#sharebar').hidden = false; });
    toast("Couldn't open the share menu" + (e && e.message ? ': ' + e.message : '.')); return false;
  }
}
$('#sharebar-go').addEventListener('click', async () => {
  const p = pendingShare; if (!p) return; pendingShare = null; $('#sharebar').hidden = true;
  try { await navigator.share({ files: [p.file], title: p.file.name }); toast(p.okMsg || 'Shared.'); p.resolve(true); }
  catch (e) { p.resolve(false); if (!e || e.name !== 'AbortError') toast("Couldn't open the share menu."); }
});
$('#sharebar-x').addEventListener('click', hideShareBar);

/* ---------- quote view ---------- */
function renderQuote() {
  const job = S.job, q = job.quote, o = cur(job), multi = job.options.length > 1, r = computeQuote(viewOf(job, o), S.settings);
  const fees = r.rates.fees, scope = multi ? ` · Option ${job.options.indexOf(o) + 1}` : '';
  let h = `<div class="row" style="justify-content:space-between"><h1>Quote · ${esc(job.customer.name)}</h1>
    ${q.snapshot ? `<span class="row"><span class="pill">Rates locked ${new Date(q.snapshot.at).toLocaleDateString()}</span><button class="btn small" id="btn-unlock">Use current rates</button></span>` : ''}</div>`;
  h += multi ? `<div id="q-opts" style="margin-top:14px"></div>` : `<p class="muted" style="font-size:13px;margin:10px 0 0">Giving this customer choices? Add options on the Trace tab, then price each one here.</p>`;
  if (!r.m.scaled) h += `<div class="warnbox" style="margin-top:12px">No scale set yet, so C9 and garland footage count as 0. Go to Trace and use the Scale tool.</div>`;
  h += `<div class="qgrid">
  ${multi ? `<div class="card" id="q-compare" style="grid-column:1/-1"></div>` : ''}
  <div class="card"><h2>Pricing${multi ? ' · all options' : ''}</h2>
    <label class="check" for="q-new"><input type="checkbox" id="q-new" data-q="newCustomer" ${q.newCustomer ? 'checked' : ''}> New customer · ${money(r.rates.startup)} startup fee</label>
    <label class="f" for="q-rate" style="margin-top:8px">C9 rate for this job (default ${money(r.rates.rateC9)}/ft)</label>
    <div class="money"><span>$</span><input type="number" inputmode="decimal" step="0.25" id="q-rate" data-q="rate" value="${q.rate ?? ''}" placeholder="${r.rates.rateC9}"><span class="muted">/ft</span></div>
    <label class="f" for="q-buf" style="margin-top:8px">Measurement buffer for this job (default ${r.bufBase}%)</label>
    <div class="money"><input type="number" inputmode="decimal" step="1" min="0" id="q-buf" data-q="buffer" value="${q.buffer ?? ''}" placeholder="${r.bufBase}"><span class="muted">% added to C9 and garland feet</span></div>
    ${fees.length ? `<h2 style="margin-top:16px">Extra fees</h2>` + fees.map(f => { const on = q.fees[f.id] !== undefined ? q.fees[f.id] : !!f.defaultOn; return `<label class="check" for="fee-${f.id}"><input type="checkbox" id="fee-${f.id}" data-fee="${f.id}" ${on ? 'checked' : ''}> ${esc(f.name || 'Fee')} · ${money(num(f.amount))}${f.kind === 'perFt' ? '/ft' : ''}</label>`; }).join('') : `<p class="muted" style="font-size:13px;margin:14px 0 0">Add optional fees, like a steep-roof charge, in Settings. They show up here as switches.</p>`}
  </div>
  <div class="card"><h2>Measured on site${scope}</h2>
    <p class="muted" style="font-size:13px;margin:0 0 8px">Leave blank to use the photo estimate. A number here is used as-is, with no buffer.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
      <label class="f" for="q-site-c9">C9 lights (ft)<input type="number" inputmode="decimal" step="1" min="0" id="q-site-c9" data-o="siteC9" value="${o.siteC9 ?? ''}" placeholder="Photo: ${r.m.scaled ? Math.ceil(r.m.c9 * (1 + r.buf / 100)) : 0}"></label>
      <label class="f" for="q-site-g">Garland (ft)<input type="number" inputmode="decimal" step="1" min="0" id="q-site-g" data-o="siteGarland" value="${o.siteGarland ?? ''}" placeholder="Photo: ${r.m.scaled ? Math.ceil(r.m.garland * (1 + r.buf / 100)) : 0}"></label>
    </div>
  </div>
  <div class="card"><h2>Wreaths${scope}</h2>
    ${r.wreaths.length ? r.wreaths.map(w => `<div class="wline"><span>Wreath ${w.n} · ${w.size}″</span><span class="money"><span>$</span><input type="number" inputmode="decimal" step="0.01" aria-label="Wreath ${w.n} cost" data-wreath="${w.id}" value="${w.cost || ''}"></span><span class="num" data-wprice="${w.id}">${money(w.price)}</span></div>`).join('') : `<p class="muted" style="margin:0">No wreaths placed. Add them with the Wreath tool on Trace.</p>`}
    <label class="f" for="q-wmk" style="margin-top:12px">Wreath markup for this job (default ${r.rates.wreathMarkup}×)</label>
    <div class="money"><input type="number" inputmode="decimal" step="0.05" id="q-wmk" data-q="wreathMarkup" value="${q.wreathMarkup ?? ''}" placeholder="${r.rates.wreathMarkup}"><span>×</span></div>
  </div>
  <div class="card"><h2>Garland${scope}</h2>
    <p class="num" style="margin:0 0 10px" id="q-gline"></p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
      <label class="f" for="q-gcost">Cost per strand<span class="money"><span>$</span><input type="number" inputmode="decimal" step="0.01" id="q-gcost" data-q="garlandCost" value="${q.garlandCost ?? ''}"></span></label>
      <label class="f" for="q-glen">Strand length (ft)<input type="number" inputmode="decimal" step="0.5" id="q-glen" data-q="garlandLen" value="${q.garlandLen ?? ''}"></label>
      <label class="f" for="q-gmk">Markup (default ${r.rates.garlandMarkup}×)<input type="number" inputmode="decimal" step="0.05" id="q-gmk" data-q="garlandMarkup" value="${q.garlandMarkup ?? ''}" placeholder="${r.rates.garlandMarkup}"></label>
    </div>
  </div>
  <div class="card"><h2>Custom items${scope}</h2>
    ${o.custom.map((c, i) => `<div class="custom"><input type="text" aria-label="Item description" data-custom="${i}" data-field="desc" value="${esc(c.desc)}" placeholder="Description"><input type="number" inputmode="decimal" step="0.01" aria-label="Item price" data-custom="${i}" data-field="amount" value="${c.amount ?? ''}" placeholder="Price"><button class="btn small" data-rmcustom="${i}" aria-label="Remove item">Remove</button></div>`).join('')}
    <button class="btn small" id="btn-addcustom">Add custom item</button>
  </div>
  <div class="card" id="q-summary"></div>
  <div class="card" id="q-pull"></div>
  </div>
  <div class="row" style="margin-top:16px"><button class="btn primary" data-go="proposal">Build proposal</button><button class="btn" data-go="trace">Back to tracing</button></div>`;
  $('#v-quote').innerHTML = h; updateQuoteTotals();
}
function updateQuoteTotals() {
  const job = S.job, o = cur(job), multi = job.options.length > 1, r = computeQuote(viewOf(job, o), S.settings);
  const scope = multi ? ` · Option ${job.options.indexOf(o) + 1}` : '';
  if ($('#q-opts')) $('#q-opts').innerHTML = optTabsHTML(job);
  if ($('#q-compare')) $('#q-compare').innerHTML = `<h2>All options</h2><table class="lines"><tbody>${job.options.map((x, i) => {
    const rr = computeQuote(viewOf(job, x), S.settings), bits = [rr.c9Ft + ' ft C9'];
    if (rr.gFt) bits.push(rr.gFt + ' ft garland'); if (rr.wreaths.length) bits.push(rr.wreaths.length + (rr.wreaths.length > 1 ? ' wreaths' : ' wreath'));
    return `<tr><td>${x.id === job.activeOpt ? '<b>' : ''}Option ${i + 1}${x.name ? ' · ' + esc(x.name) : ''}${x.id === job.activeOpt ? '</b>' : ''}<span class="d">${bits.join(' · ')}</span></td><td>${money(rr.total)}</td></tr>`;
  }).join('')}</tbody></table>`;
  $('#q-gline').textContent = `${r.siteG != null ? r.gFt + ' ft measured on site' : r.gRaw + ' ft from photo · ' + r.gFt + ' ft bid'} · ${r.strands} strand${r.strands === 1 ? '' : 's'}`;
  $('#q-summary').innerHTML = `<h2>Customer sees${scope}</h2><table class="lines"><tbody>${r.rows.map(x => `<tr><td>${esc(x.label)}${x.detail ? `<span class="d">${esc(x.detail)}</span>` : ''}</td><td>${money(x.amount)}</td></tr>`).join('') || '<tr><td class="muted">Nothing priced yet</td><td></td></tr>'}
    <tr class="total"><td>Total</td><td>${money(r.total)}</td></tr></tbody></table>
    <p style="margin:6px 0 0" class="muted">${r.deposit ? `Due at signing: <b style="color:var(--fg)">${money(r.deposit)}</b> startup fee` : 'No deposit due (returning customer)'}</p>`;
  const wCost = r.wreaths.reduce((s, w) => s + w.cost, 0), wPrice = r.wreaths.reduce((s, w) => s + w.price, 0);
  const gCost = r.strands * r.gCost, gPrice = gCost * r.gMk;
  $('#q-pull').innerHTML = `<h2>Pull sheet${scope} · internal only</h2><table class="lines pull"><tbody>
    <tr><td>C9 footage</td><td class="num">${r.siteC9 != null ? `${r.c9Raw} ft photo estimate · ${r.c9Ft} ft measured on site` : `${r.c9Raw} ft from photo · ${r.c9Ft} ft bid (+${r.buf}%)`}</td></tr>
    <tr><td>C9 bulbs at ${job.spacing}″</td><td class="num">${r.bulbs}</td></tr>
    <tr><td>Garland</td><td class="num">${r.siteG != null ? `${r.gRaw} ft photo estimate · ${r.gFt} ft measured on site` : `${r.gRaw} ft from photo · ${r.gFt} ft bid`} · ${r.strands} × ${r.gLen} ft strands</td></tr>
    <tr><td>Wreaths</td><td class="num">${r.wreaths.length ? r.wreaths.map(w => w.size + '″').join(', ') : 'None'}</td></tr>
    <tr><td>Wreath cost → price</td><td class="num">${money(wCost)} → ${money(wPrice)} · margin ${money(wPrice - wCost)}</td></tr>
    <tr><td>Garland cost → price</td><td class="num">${money(gCost)} → ${money(gPrice)} · margin ${money(gPrice - gCost)}</td></tr>
  </tbody></table>`;
  r.wreaths.forEach(w => { const el = document.querySelector(`[data-wprice="${w.id}"]`); if (el) el.textContent = money(w.price); });
}
$('#v-quote').addEventListener('input', e => {
  const t = e.target, q = S.job.quote, o = cur();
  if (t.dataset.q) {
    const k = t.dataset.q;
    if (k === 'newCustomer') q.newCustomer = t.checked;
    else q[k] = t.value === '' ? (['rate', 'wreathMarkup', 'garlandMarkup', 'buffer'].includes(k) ? null : '') : num(t.value);
    if (k === 'garlandCost' && t.value !== '') { S.settings.garlandCost = num(t.value); touchSettings(); }
    if (k === 'garlandLen' && t.value !== '') { S.settings.garlandLen = num(t.value); touchSettings(); }
  } else if (t.dataset.o) o[t.dataset.o] = t.value === '' ? null : num(t.value);
  else if (t.dataset.fee) q.fees[t.dataset.fee] = t.checked;
  else if (t.dataset.wreath) { const w = o.shapes.find(s => s.id === t.dataset.wreath); if (w) { w.cost = num(t.value); S.settings.wreathCost = w.cost; touchSettings(); } }
  else if (t.dataset.custom !== undefined) { const c = o.custom[+t.dataset.custom]; c[t.dataset.field] = t.dataset.field === 'amount' ? (t.value === '' ? '' : num(t.value)) : t.value; }
  else return;
  touchJob(); updateQuoteTotals();
});
$('#v-quote').addEventListener('click', e => {
  const t = e.target, q = S.job.quote, o = cur(), ob = t.closest('[data-opt]');
  if (ob) return switchOpt(ob.dataset.opt);
  if (t.id === 'btn-addcustom') { o.custom.push({ desc: '', amount: '' }); touchJob(); renderQuote(); }
  else if (t.dataset.rmcustom !== undefined) { o.custom.splice(+t.dataset.rmcustom, 1); touchJob(); renderQuote(); }
  else if (t.id === 'btn-unlock') { q.snapshot = null; touchJob(); renderQuote(); toast('Using current rates from Settings.'); }
  else if (t.dataset.go) show(t.dataset.go);
});

/* ---------- proposal ---------- */
const PW = 1700, PH = 2200, M = 110;
async function fontsReady() { try { await Promise.all(['800 60px "Noto Serif"', '700 30px "Noto Sans"', '600 30px "Noto Sans"', '400 30px "Noto Sans"', 'italic 400 28px "Noto Sans"'].map(f => document.fonts.load(f))); } catch (e) {} }
function spaced(ctx, str, x, y, spacing, align) {
  const chars = [...str], ws = chars.map(ch => ctx.measureText(ch).width), total = ws.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx0 = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.save(); ctx.textAlign = 'left'; chars.forEach((ch, i) => { ctx.fillText(ch, cx0, y); cx0 += ws[i] + spacing; }); ctx.restore(); return total;
}
function txt(ctx, s, x, y, font, color, align) { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(s, x, y); }
function wrapRich(ctx, segs, x, y, maxW, lh, color) {
  const words = []; segs.forEach(sg => sg.text.split(/(\s+)/).forEach(w => { if (w) words.push({ w, font: sg.font }); }));
  let line = [], lw = 0;
  const flush = () => { let xx = x; line.forEach(o => { ctx.font = o.font; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(o.w, xx, y); xx += o.width; }); line = []; lw = 0; y += lh; };
  for (const o of words) { ctx.font = o.font; o.width = ctx.measureText(o.w).width; if (/^\s+$/.test(o.w) && !line.length) continue; if (lw + o.width > maxW && line.length && !/^\s+$/.test(o.w)) flush(); if (/^\s+$/.test(o.w) && !line.length) continue; line.push(o); lw += o.width; }
  if (line.length) flush(); return y;
}
function drawLogo(ctx, x, y, w) {
  const k = w / 600, u = 1.8 * k, ox = x + (w - 160 * u) / 2, oy = y, cxm = x + w / 2;
  const pts = [[20, 70], [32, 60], [44, 50], [56, 40], [68, 30], [80, 20], [92, 30], [104, 40], [116, 50], [128, 60], [140, 70]];
  const P = p => [ox + p[0] * u, oy + p[1] * u];
  ctx.save(); ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(...P([20, 70])); ctx.lineTo(...P([80, 20])); ctx.lineTo(...P([140, 70])); ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 1.5 * u; ctx.stroke();
  ctx.globalAlpha = 0.28; ctx.fillStyle = '#E9B949'; pts.forEach(p => { ctx.beginPath(); ctx.arc(...P(p), 8 * u, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1;
  pts.forEach((p, i) => { ctx.beginPath(); ctx.arc(...P(p), 4.5 * u, 0, 7); ctx.fillStyle = i % 2 ? '#1B5E3B' : '#C1121F'; ctx.fill(); ctx.lineWidth = 1.3 * u; ctx.strokeStyle = '#D4A537'; ctx.stroke(); });
  let by = y + 142 * k + 76 * k * 0.78;
  ctx.font = `800 ${76 * k}px "Noto Serif", Georgia, serif`; ctx.fillStyle = '#111111'; spaced(ctx, 'WEHRLE', cxm, by, 76 * k * 0.04, 'center');
  by += 12 * k + 17 * k + 6 * k;
  ctx.font = `600 ${17 * k}px "Noto Sans", sans-serif`; ctx.fillStyle = '#C1121F'; const lw = spaced(ctx, 'HOLIDAY LIGHTING', cxm, by, 17 * k * 0.34, 'center');
  by += 14 * k; ctx.fillStyle = '#D4A537'; ctx.fillRect(cxm - lw / 2, by, lw, Math.max(1, 1.2 * k));
  by += 12 * k + 14 * k; ctx.font = `600 ${14 * k}px "Noto Sans", sans-serif`; ctx.fillStyle = '#111111'; spaced(ctx, TAGLINE.toUpperCase(), cxm, by, 14 * k * 0.16, 'center');
  ctx.restore(); return by;
}
function footer(ctx) {
  const c = S.settings.company, parts = [c.phone, c.email, c.website].filter(Boolean);
  ctx.fillStyle = '#E4DED2'; ctx.fillRect(M, PH - 150, PW - 2 * M, 2);
  txt(ctx, parts.length ? parts.join('   ·   ') : c.name, PW / 2, PH - 98, '600 26px "Noto Sans", sans-serif', '#333333', 'center');
  ctx.font = '700 20px "Noto Sans", sans-serif'; ctx.fillStyle = '#C1121F'; spaced(ctx, (c.name + ' · ' + TAGLINE).toUpperCase(), PW / 2, PH - 60, 4, 'center');
}
function coverImg(ctx, img, x, y, w, h, r) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.max(w / iw, h / ih);
  const sw = w / k, sh = h / k, sx = (iw - sw) / 2, sy = (ih - sh) / 2;
  ctx.save(); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h); ctx.restore();
}
async function loadRenderings(job, opt) {
  const out = {};
  for (const col of ['warm', 'multi']) {
    const id = job.renderings && job.renderings[opt.id + ':' + col]; if (!id) continue;
    try { const v = await Store.getPhoto(id); if (typeof v === 'string') out[col] = await loadImg(v); } catch (e) {}
  }
  return out;
}
function roundImg(ctx, img, x, y, w, h, r) { ctx.save(); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, x, y, w, h); ctx.restore(); }
function proposalHeader(g, job, shortId, date) {
  const c = S.settings.company;
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, PW, PH);
  drawLogo(g, M - 40, 70, 560);
  g.font = '700 30px "Noto Sans", sans-serif'; g.fillStyle = '#C1121F'; spaced(g, 'LIGHTING PROPOSAL', PW - M, 150, 6, 'right');
  txt(g, date, PW - M, 205, '600 30px "Noto Sans", sans-serif', '#111111', 'right');
  txt(g, 'Proposal #' + shortId, PW - M, 250, '400 26px "Noto Sans", sans-serif', '#555555', 'right');
  txt(g, 'Valid for 30 days', PW - M, 290, '400 26px "Noto Sans", sans-serif', '#555555', 'right');
  if (c.area) txt(g, 'Serving ' + c.area, PW - M, 330, '400 26px "Noto Sans", sans-serif', '#555555', 'right');
  g.fillStyle = '#D4A537'; g.fillRect(M, 400, PW - 2 * M, 3);
  g.font = '700 22px "Noto Sans", sans-serif'; g.fillStyle = '#8A6A1F'; spaced(g, 'PREPARED FOR', M, 460, 4, 'left');
  txt(g, job.customer.name, M, 520, '800 48px "Noto Serif", Georgia, serif', '#111111');
  let y = 565;
  if (job.customer.address) { txt(g, job.customer.address, M, y, '400 28px "Noto Sans", sans-serif', '#333333'); y += 40; }
  const contact = [job.customer.phone, job.customer.email].filter(Boolean).join('   ·   ');
  if (contact) { txt(g, contact, M, y, '400 28px "Noto Sans", sans-serif', '#333333'); y += 40; }
  return y;
}
async function buildOptionPage(job, opt, idx, shortId, date) {
  const st = S.settings, view = viewOf(job, opt), r = computeQuote(view, st), n = job.options.length;
  const p1 = document.createElement('canvas'); p1.width = PW; p1.height = PH; const g = p1.getContext('2d');
  let y, top;
  const oName = opt.name || `Option ${idx + 1}`, oLabel = `OPTION ${idx + 1} OF ${n}`;
  if (idx === 0) {
    y = proposalHeader(g, job, shortId, date);
    if (n > 1) {
      g.font = '800 48px "Noto Serif", Georgia, serif'; const cw = g.measureText(job.customer.name).width;
      g.font = '800 40px "Noto Serif", Georgia, serif'; const ow = g.measureText(oName).width;
      if (cw + ow + 60 <= PW - 2 * M) {
        g.font = '700 22px "Noto Sans", sans-serif'; g.fillStyle = '#C1121F'; spaced(g, oLabel, PW - M, 460, 4, 'right');
        txt(g, oName, PW - M, 520, '800 40px "Noto Serif", Georgia, serif', '#111111', 'right');
      } else {
        y += 16; g.font = '700 22px "Noto Sans", sans-serif'; g.fillStyle = '#C1121F'; spaced(g, oLabel, M, y + 20, 4, 'left');
        txt(g, oName, M, y + 72, '800 40px "Noto Serif", Georgia, serif', '#111111'); y += 90;
      }
    }
    top = Math.max(y + 10, 640);
  } else {
    // later option pages: compact header leaves room for bigger mockups
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, PW, PH);
    txt(g, S.settings.company.name, M, 150, '800 36px "Noto Serif", Georgia, serif', '#111111');
    txt(g, `Proposal #${shortId} · ${job.customer.name}`, PW - M, 150, '400 24px "Noto Sans", sans-serif', '#555555', 'right');
    g.fillStyle = '#D4A537'; g.fillRect(M, 190, PW - 2 * M, 3);
    g.font = '700 22px "Noto Sans", sans-serif'; g.fillStyle = '#C1121F'; spaced(g, oLabel, M, 262, 4, 'left');
    txt(g, oName, M, 326, '800 48px "Noto Serif", Georgia, serif', '#111111');
    y = 350; top = y + 30;
  }
  const custom = await loadRenderings(job, opt);
  const mock = (col, mw) => custom[col] || renderMockup(view, S.img, col, mw);
  // ---- measure the blocks, then spread the spare space so the page feels full ----
  const mode = job.quote.mockups || 'both', AR = job.photoH / job.photoW, FW = PW - 2 * M;
  const bottom = PH - 190;
  const rowsH = 70 + r.rows.reduce((s, row) => s + (row.detail ? 104 : 72), 0);
  const future = r.total - (r.deposit || 0);
  const incH = 66, totH = 128, dueH = 132 + (st.paymentLink && r.deposit ? 56 : 0), labH = 62;
  const capH = S.img ? (mode === 'both' ? Math.min(((FW - 40) / 2) * AR, 640) : Math.min(FW * AR, 980)) : 0;
  const fixedH = rowsH + incH + totH + dueH + (S.img ? labH : 0);
  const mockH = S.img ? Math.max(Math.min(capH, 260), Math.min(capH, bottom - top - fixedH - 4 * 28)) : 0;
  const gap = Math.max(28, Math.min(120, (bottom - top - fixedH - mockH) / 4));
  y = top + gap * 0.6;
  if (S.img) {
    if (mode === 'both') {
      const w = (FW - 40) / 2, h = mockH, ww = Math.min(w, h / AR), off = (w - ww) / 2;
      coverImg(g, mock('warm', 1200), M + off, y, ww, h, 16);
      coverImg(g, mock('multi', 1200), M + w + 40 + off, y, ww, h, 16);
      g.font = '700 20px "Noto Sans", sans-serif'; g.fillStyle = '#555555';
      spaced(g, 'WARM WHITE', M + w / 2, y + h + 42, 4, 'center'); spaced(g, 'MULTICOLOR', M + w + 40 + w / 2, y + h + 42, 4, 'center');
    } else {
      const h = mockH, ww = Math.min(FW, h / AR);
      coverImg(g, mock(mode, 1800), M + (FW - ww) / 2, y, ww, h, 16);
      g.font = '700 20px "Noto Sans", sans-serif'; g.fillStyle = '#555555'; spaced(g, mode === 'multi' ? 'MULTICOLOR' : 'WARM WHITE', PW / 2, y + h + 42, 4, 'center');
    }
    y += mockH + labH;
  }
  // price table
  y += gap;
  g.font = '700 20px "Noto Sans", sans-serif'; g.fillStyle = '#8A6A1F'; spaced(g, 'YOUR LIGHTING', M, y + 22, 4, 'left'); spaced(g, 'PRICE', PW - M, y + 22, 4, 'right');
  g.fillStyle = '#E4DED2'; g.fillRect(M, y + 42, FW, 2); y += 70;
  for (const row of r.rows) {
    txt(g, row.label, M, y + 36, '600 31px "Noto Sans", sans-serif', '#111111');
    txt(g, money(row.amount), PW - M, y + 36, '600 31px "Noto Sans", sans-serif', '#111111', 'right');
    if (row.detail) { txt(g, row.detail, M, y + 72, '400 24px "Noto Sans", sans-serif', '#666666'); g.fillStyle = '#EEEAE1'; g.fillRect(M, y + 90, FW, 2); y += 104; }
    else { g.fillStyle = '#EEEAE1'; g.fillRect(M, y + 54, FW, 2); y += 72; }
  }
  txt(g, 'Includes lighting lease, professional installation, timer setup, in-season light maintenance, takedown and storage.', M, y + 40, '400 24px "Noto Sans", sans-serif', '#555555');
  y += incH;
  // totals
  y += gap * 0.7;
  txt(g, 'Total for current season', M, y + 48, '800 44px "Noto Serif", Georgia, serif', '#111111');
  txt(g, money(r.total), PW - M, y + 48, '800 44px "Noto Serif", Georgia, serif', '#1B5E3B', 'right');
  txt(g, 'Total for future seasons', M, y + 100, 'italic 400 28px "Noto Sans", sans-serif', '#555555');
  txt(g, money(future), PW - M, y + 100, 'italic 400 28px "Noto Sans", sans-serif', '#555555', 'right');
  y += totH;
  // due at signing
  y += gap * 0.7;
  g.fillStyle = '#EEF4F0'; g.beginPath(); g.roundRect ? g.roundRect(M, y, FW, 120, 14) : g.rect(M, y, FW, 120); g.fill();
  if (r.deposit) {
    txt(g, `Due at signing: ${money(r.deposit)} startup fee to secure your install date.`, M + 30, y + 52, '700 27px "Noto Sans", sans-serif', '#1B5E3B');
    txt(g, 'The remaining balance is due once installation is complete.', M + 30, y + 92, '400 25px "Noto Sans", sans-serif', '#1B5E3B');
  } else {
    txt(g, 'No deposit needed. Your install date is reserved when you accept.', M + 30, y + 52, '700 27px "Noto Sans", sans-serif', '#1B5E3B');
    txt(g, 'The full balance is due once installation is complete.', M + 30, y + 92, '400 25px "Noto Sans", sans-serif', '#1B5E3B');
  }
  y += 120;
  if (st.paymentLink && r.deposit) txt(g, 'Pay your startup fee online: ' + st.paymentLink, M, y + 48, '400 24px "Noto Sans", sans-serif', '#333333');
  footer(g);
  return p1;
}
function buildTermsPage(job, shortId, results) {
  const st = S.settings, c = st.company, r0 = results[0];
  const p2 = document.createElement('canvas'); p2.width = PW; p2.height = PH; const h2 = p2.getContext('2d');
  h2.fillStyle = '#FFFFFF'; h2.fillRect(0, 0, PW, PH);
  txt(h2, c.name, M, 150, '800 36px "Noto Serif", Georgia, serif', '#111111');
  txt(h2, `Proposal #${shortId} · ${job.customer.name}`, PW - M, 150, '400 24px "Noto Sans", sans-serif', '#555555', 'right');
  h2.fillStyle = '#D4A537'; h2.fillRect(M, 190, PW - 2 * M, 3);
  txt(h2, 'Terms', M, 290, '800 52px "Noto Serif", Georgia, serif', '#111111');
  let ty = 370;
  st.terms.forEach((t0, i) => {
    const t = t0.replace(/\{startup\}/g, money(r0.rates.startup)); const ci = t.indexOf(':');
    const segs = ci > 0 && ci < 40 ? [{ text: `${i + 1}. ${t.slice(0, ci + 1)}`, font: '700 27px "Noto Sans", sans-serif' }, { text: t.slice(ci + 1), font: '400 27px "Noto Sans", sans-serif' }] : [{ text: `${i + 1}. ${t}`, font: '400 27px "Noto Sans", sans-serif' }];
    ty = wrapRich(h2, segs, M, ty, PW - 2 * M, 40, '#222222') + 18;
  });
  if (st.customerNote && st.customerNote.trim()) {
    ty += 30; h2.font = '700 22px "Noto Sans", sans-serif'; h2.fillStyle = '#8A6A1F'; spaced(h2, 'CUSTOMER RESPONSIBILITIES', M, ty, 4, 'left');
    ty = wrapRich(h2, [{ text: st.customerNote.trim(), font: '400 27px "Noto Sans", sans-serif' }], M, ty + 50, PW - 2 * M, 40, '#222222');
  }
  const n = results.length, dep = r0.deposit;
  if (n === 1) {
    const ay = Math.max(ty + 60, PH - 470);
    h2.font = '700 22px "Noto Sans", sans-serif'; h2.fillStyle = '#8A6A1F'; spaced(h2, 'CUSTOMER ACCEPTANCE', M, ay, 4, 'left');
    txt(h2, `I accept this proposal for ${money(r0.total)}${dep ? ', with ' + money(dep) + ' due at signing' : ''}.`, M, ay + 50, '400 26px "Noto Sans", sans-serif', '#333333');
    h2.fillStyle = '#111111'; h2.fillRect(M, ay + 170, 900, 2); h2.fillRect(M + 1000, ay + 170, PW - 2 * M - 1000, 2);
    txt(h2, 'Signature', M, ay + 205, '400 22px "Noto Sans", sans-serif', '#666666'); txt(h2, 'Date', M + 1000, ay + 205, '400 22px "Noto Sans", sans-serif', '#666666');
  } else {
    const ay = Math.max(ty + 60, PH - 265 - (225 + 58 * n));
    h2.font = '700 22px "Noto Sans", sans-serif'; h2.fillStyle = '#8A6A1F'; spaced(h2, 'CUSTOMER ACCEPTANCE', M, ay, 4, 'left');
    txt(h2, `I accept the option checked below${dep ? ', with ' + money(dep) + ' due at signing' : ''}.`, M, ay + 50, '400 26px "Noto Sans", sans-serif', '#333333');
    job.options.forEach((o, k) => {
      const ly = ay + 110 + k * 58;
      h2.strokeStyle = '#111111'; h2.lineWidth = 2.5; h2.strokeRect(M, ly - 27, 32, 32);
      txt(h2, `Option ${k + 1}${o.name ? ' · ' + o.name : ''}`, M + 56, ly, '600 28px "Noto Sans", sans-serif', '#111111');
      txt(h2, `${money(results[k].total)} this season`, PW - M, ly, '600 28px "Noto Sans", sans-serif', '#1B5E3B', 'right');
    });
    const sy = ay + 110 + n * 58 + 90;
    h2.fillStyle = '#111111'; h2.fillRect(M, sy, 900, 2); h2.fillRect(M + 1000, sy, PW - 2 * M - 1000, 2);
    txt(h2, 'Signature', M, sy + 35, '400 22px "Noto Sans", sans-serif', '#666666'); txt(h2, 'Date', M + 1000, sy + 35, '400 22px "Noto Sans", sans-serif', '#666666');
  }
  footer(h2);
  return p2;
}
async function buildProposal(job) {
  await fontsReady();
  const st = S.settings;
  if (!job.proposalNo) { job.proposalNo = Math.max(1, Math.round(num(st.nextProposalNo, 31))); st.nextProposalNo = job.proposalNo + 1; touchSettings(); touchJob(); }
  const shortId = String(job.proposalNo);
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const pages = [];
  for (let i = 0; i < job.options.length; i++) pages.push(await buildOptionPage(job, job.options[i], i, shortId, date));
  pages.push(buildTermsPage(job, shortId, job.options.map(o => computeQuote(viewOf(job, o), st))));
  return pages;
}
let proposalPages = null, proposalPdf = null, proposalPng = null;
function makeProposalPdf() {
  if (!window.jspdf || !proposalPages) return null;
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
  proposalPages.forEach((p, i) => { if (i) doc.addPage(); doc.addImage(p.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 612, 792); });
  return doc.output('blob');
}
async function renderProposal() {
  const job = S.job, mode = job.quote.mockups || 'both', n = job.options.length;
  $('#v-proposal').innerHTML = `<div class="row" style="justify-content:space-between"><h1>Proposal · ${esc(job.customer.name)}</h1>
    <div class="row"><button class="btn primary" id="btn-pdf">${IS_TOUCH ? 'Share PDF' : 'Download PDF'}</button><button class="btn" id="btn-png">${IS_TOUCH ? 'Share page 1 image' : 'Download page 1 image'}</button></div></div>
    <div class="row" style="margin-top:12px"><label class="f" for="p-mock" style="min-width:240px">Mockups on the proposal<select id="p-mock">
      <option value="both" ${mode === 'both' ? 'selected' : ''}>Warm white and multicolor</option><option value="warm" ${mode === 'warm' ? 'selected' : ''}>Warm white only</option><option value="multi" ${mode === 'multi' ? 'selected' : ''}>Multicolor only</option></select></label>
      <p class="muted" style="font-size:13px;max-width:520px;margin:20px 0 0">${n > 1 ? `This proposal has one page for each of the ${n} options, then the terms page, where the customer checks the option they want. ` : ''}Saving locks this job's rates, so later changes in Settings won't change this quote. Unlock them on the Quote tab.</p></div>
    <div id="rend"></div>
    <div class="pages" id="pages"><p class="muted">Building the proposal…</p></div>`;
  proposalPdf = null; proposalPng = null;
  await renderRenderSlots(job);
  const pages = await buildProposal(job); proposalPages = pages;
  if (S.view !== 'proposal') return;
  $('#pages').innerHTML = pages.map((p, i) => `<img alt="Proposal page ${i + 1}" src="${p.toDataURL('image/jpeg', 0.9)}">`).join('');
  setTimeout(() => {
    if (proposalPages !== pages) return;
    try { proposalPdf = makeProposalPdf(); } catch (e) { proposalPdf = null; }
    pages[0].toBlob(b => { if (proposalPages === pages) proposalPng = b; }, 'image/png');
  }, 250);
}
async function renderRenderSlots(job) {
  const box = $('#rend'); if (!box) return;
  const mode = job.quote.mockups || 'both', cols = mode === 'both' ? ['warm', 'multi'] : [mode], multi = job.options.length > 1;
  let h = '';
  for (const o of job.options) {
    const custom = await loadRenderings(job, o), view = viewOf(job, o);
    h += (multi ? `<h2 style="margin:24px 0 0">${esc(optTitle(job, o))}</h2>` : '') + `<div class="qgrid">` + cols.map(col => {
      const key = o.id + ':' + col, name = col === 'warm' ? 'Warm white' : 'Multicolor', has = !!custom[col];
      const src = has ? custom[col].src : (S.img ? renderMockup(view, S.img, col, 700).toDataURL('image/jpeg', 0.85) : '');
      return `<div class="card"><h2>${name} mockup</h2>
        ${src ? `<img src="${src}" alt="${name} mockup preview" style="width:100%;border-radius:10px;display:block;aspect-ratio:${job.photoW || 4}/${job.photoH || 3};object-fit:cover">` : ''}
        <p class="muted" style="font-size:13px;margin:10px 0">${has ? 'Using your uploaded rendering on the proposal.' : "Using the app's mockup. Upload a rendering to replace it."}</p>
        <div class="row">
          <label class="btn small" for="up-${key}">${has ? 'Replace rendering' : 'Upload rendering'}</label><input type="file" id="up-${key}" data-up="${key}" accept="image/*" hidden>
          ${has ? `<button class="btn small" data-rm-rend="${key}">Use app mockup</button>` : `<button class="btn small" data-save-mock="${key}">Save app mockup</button>`}
        </div></div>`;
    }).join('') + `</div>`;
  }
  box.innerHTML = h;
}
function lockRates(job) { if (!job.quote.snapshot) job.quote.snapshot = { at: Date.now(), rates: currentRates(S.settings) }; if (job.status === 'draft') job.status = 'sent'; touchJob(); }
const fileBase = job => `Wehrle Proposal - ${job.customer.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim() || 'Customer'}`;
$('#v-proposal').addEventListener('change', async e => {
  if (e.target.id === 'p-mock') { S.job.quote.mockups = e.target.value; touchJob(); renderProposal(); }
  const key = e.target.dataset.up;
  if (key) {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let p; try { p = await processPhoto(f); } catch (err) { return toast("That image couldn't be opened. Save it as a JPG or PNG and try again."); }
    const job = S.job; job.renderings = job.renderings || {};
    if (job.renderings[key]) await Store.deletePhoto(job.renderings[key]);
    const id = uid(); await Store.putPhoto(id, p.data); job.renderings[key] = id; touchJob();
    toast('Rendering added to the proposal.'); renderProposal();
  }
});
$('#v-proposal').addEventListener('click', async e => {
  const job = S.job;
  if (e.target.dataset.rmRend) { const key = e.target.dataset.rmRend; if (job.renderings && job.renderings[key]) { await Store.deletePhoto(job.renderings[key]); delete job.renderings[key]; touchJob(); } return renderProposal(); }
  if (e.target.dataset.saveMock) {
    if (!S.img) return toast('Add a photo to this job first.');
    const [oid, col] = e.target.dataset.saveMock.split(':'), o = job.options.find(x => x.id === oid) || cur(job);
    const b = await new Promise(r => renderMockup(viewOf(job, o), S.img, col).toBlob(r, 'image/jpeg', 0.92));
    const optPart = job.options.length > 1 ? ` - Option ${job.options.indexOf(o) + 1}` : '';
    return offerFile(`${fileBase(job).replace('Proposal', 'Mockup')}${optPart} - ${col === 'warm' ? 'warm white' : 'multicolor'}.jpg`, b, 'Mockup saved.');
  }
  if (!proposalPages) return;
  if (e.target.id === 'btn-pdf') {
    if (!window.jspdf) return toast("The PDF tool didn't load. Close and reopen the app, or share the page as an image.");
    const pdf = proposalPdf || makeProposalPdf(); if (!pdf) return;
    if (await offerFile(fileBase(S.job) + '.pdf', pdf, 'Proposal ready.')) lockRates(S.job);
  }
  if (e.target.id === 'btn-png') {
    const b = proposalPng || await new Promise(r => proposalPages[0].toBlob(r, 'image/png'));
    if (await offerFile(fileBase(S.job) + '.png', b, 'Image ready.')) lockRates(S.job);
  }
});

/* ---------- settings ---------- */
function renderSettings() {
  const st = S.settings, c = st.company;
  $('#v-settings').innerHTML = `<h1>Settings</h1>
  <div class="qgrid">
    <div class="card"><h2>Business</h2><div class="grid" style="grid-template-columns:1fr">
      <label class="f" for="s-name">Business name<input type="text" id="s-name" data-c="name" value="${esc(c.name)}"></label>
      <label class="f" for="s-phone">Phone<input type="tel" id="s-phone" data-c="phone" value="${esc(c.phone)}" placeholder="817-555-0100"></label>
      <label class="f" for="s-email">Email<input type="email" id="s-email" data-c="email" value="${esc(c.email)}"></label>
      <label class="f" for="s-web">Website<input type="text" id="s-web" data-c="website" value="${esc(c.website)}"></label>
      <label class="f" for="s-area">Service area<input type="text" id="s-area" data-c="area" value="${esc(c.area)}" placeholder="Aledo & West Fort Worth"></label>
      <label class="f" for="s-pay">Startup fee payment link (optional)<input type="text" id="s-pay" data-s="paymentLink" value="${esc(st.paymentLink)}" placeholder="square.link/…"></label>
    </div></div>
    <div class="card"><h2>Rates</h2><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
      <label class="f" for="s-rate">C9 per foot<span class="money"><span>$</span><input type="number" inputmode="decimal" step="0.25" id="s-rate" data-n="rateC9" value="${st.rateC9}"></span></label>
      <label class="f" for="s-buf">Measurement buffer (%)<input type="number" inputmode="decimal" step="1" min="0" id="s-buf" data-n="bufferPct" value="${st.bufferPct}"></label>
      <label class="f" for="s-start">New customer startup<span class="money"><span>$</span><input type="number" inputmode="decimal" step="1" id="s-start" data-n="startup" value="${st.startup}"></span></label>
      <label class="f" for="s-wmk">Wreath markup (×)<input type="number" inputmode="decimal" step="0.05" id="s-wmk" data-n="wreathMarkup" value="${st.wreathMarkup}"></label>
      <label class="f" for="s-gmk">Garland markup (×)<input type="number" inputmode="decimal" step="0.05" id="s-gmk" data-n="garlandMarkup" value="${st.garlandMarkup}"></label>
      <label class="f" for="s-spacing">Default bulb spacing<select id="s-spacing" data-n="defaultSpacing"><option value="15" ${st.defaultSpacing == 15 ? 'selected' : ''}>15″</option><option value="12" ${st.defaultSpacing == 12 ? 'selected' : ''}>12″</option></select></label>
    </div></div>
    <div class="card fees"><h2>Extra fees</h2>
      <p class="muted" style="font-size:13px;margin:0 0 12px">Each fee becomes a switch on every quote. Per-foot fees multiply by the C9 footage.</p>
      ${st.fees.map((f, i) => `<div class="fee">
        <input type="text" aria-label="Fee name" data-fee-i="${i}" data-field="name" value="${esc(f.name)}" placeholder="Fee name">
        <select aria-label="Fee type" data-fee-i="${i}" data-field="kind"><option value="perFt" ${f.kind === 'perFt' ? 'selected' : ''}>Per foot</option><option value="flat" ${f.kind === 'flat' ? 'selected' : ''}>Flat</option></select>
        <input type="number" inputmode="decimal" step="0.25" aria-label="Fee amount" data-fee-i="${i}" data-field="amount" value="${f.amount}">
        <button class="btn small" data-rmfee="${i}">Remove</button>
        <label class="check" style="grid-column:1/-1"><input type="checkbox" data-fee-i="${i}" data-field="defaultOn" ${f.defaultOn ? 'checked' : ''}> On by default</label>
      </div>`).join('')}
      <button class="btn small" id="btn-addfee">Add fee</button>
    </div>
    <div class="card" style="grid-column:1/-1"><h2>Proposal terms</h2>
      <label class="f" for="s-terms">One term per line. Text before the first colon prints in bold. {startup} becomes the startup fee amount.</label>
      <textarea id="s-terms" style="margin-top:8px">${esc(st.terms.join('\n'))}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn small" id="btn-terms-reset">Restore default terms</button></div>
      <label class="f" for="s-note" style="margin-top:16px">Customer responsibilities (prints below the terms)</label>
      <textarea id="s-note" data-s-raw="customerNote" style="margin-top:8px;min-height:110px">${esc(st.customerNote || '')}</textarea>
      <label class="f" for="s-next" style="margin-top:16px;max-width:240px">Next proposal number<input type="number" inputmode="numeric" step="1" min="1" id="s-next" data-n="nextProposalNo" value="${st.nextProposalNo}"></label>
    </div>
  </div>`;
}
$('#v-settings').addEventListener('input', e => {
  const t = e.target, st = S.settings;
  if (t.dataset.c) st.company[t.dataset.c] = t.value;
  else if (t.dataset.s) st[t.dataset.s] = t.value.trim();
  else if (t.dataset.sRaw) st[t.dataset.sRaw] = t.value;
  else if (t.dataset.n) { if (t.value === '') return; st[t.dataset.n] = num(t.value); }
  else if (t.dataset.feeI !== undefined) { const f = st.fees[+t.dataset.feeI]; const k = t.dataset.field; f[k] = k === 'defaultOn' ? t.checked : k === 'amount' ? num(t.value) : t.value; }
  else if (t.id === 's-terms') st.terms = t.value.split('\n').map(s => s.trim()).filter(Boolean);
  else return;
  touchSettings();
});
$('#v-settings').addEventListener('click', e => {
  const st = S.settings;
  if (e.target.id === 'btn-addfee') { st.fees.push({ id: uid(), name: '', kind: 'perFt', amount: 0, defaultOn: false }); touchSettings(); renderSettings(); }
  else if (e.target.dataset.rmfee !== undefined) { st.fees.splice(+e.target.dataset.rmfee, 1); touchSettings(); renderSettings(); }
  else if (e.target.id === 'btn-terms-reset') { st.terms = DEFAULT_TERMS.slice(); st.customerNote = DEFAULT_CUSTOMER_NOTE; touchSettings(); renderSettings(); toast('Default terms restored.'); }
});

/* ---------- sample job ---------- */
async function loadSamplePhoto() {
  try { const r = await fetch('assets/sample-house.jpg'); if (!r.ok) return null; return await blobToDataURL(await r.blob()); } catch (e) { return null; }
}
async function seedSample() {
  const samplePhoto = await loadSamplePhoto(); if (!samplePhoto) return;
  const job = newJob({ name: 'Sample · white brick house', address: 'Example job, delete anytime', phone: '', email: '' });
  const id = uid(); await Store.putPhoto(id, samplePhoto);
  job.sample = true; job.photoId = id; job.photoW = 1600; job.photoH = 1200;
  job.scale = { a: { x: 850, y: 722 }, b: { x: 1170, y: 722 }, feet: 16 };
  const L = (type, pts) => ({ id: uid(), type, points: pts.map(([x, y]) => ({ x, y })) });
  job.windows = [
    L('window', [[500, 493], [604, 493], [604, 591], [500, 591]]),
    L('window', [[730, 495], [764, 495], [764, 577], [730, 577]]),
    L('window', [[950, 523], [1057, 523], [1057, 614], [950, 614]]),
    L('window', [[482, 700], [589, 700], [589, 815], [482, 815]])
  ];
  cur(job).shapes = [
    L('c9', [[432, 484], [567, 315], [690, 472]]),
    L('c9', [[584, 318], [640, 248], [846, 516]]),
    L('c9', [[776, 400], [1143, 381], [1189, 540]]),
    L('c9', [[912, 490], [1093, 488]]),
    L('c9', [[822, 662], [1215, 660]]),
    L('c9', [[706, 858], [706, 700], [778, 700], [778, 858]])
  ];
  S.jobs.push(job); await Store.saveJob(job);
}

/* ---------- boot ---------- */
(async function boot() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
  try { S.settings = mergeSettings(await Store.getKV('settings')); } catch (e) { S.settings = defaultSettings(); }
  try { S.jobs = (await Store.listJobs()).map(normalizeJob); } catch (e) { S.jobs = []; }
  let seeded = false; try { seeded = !!(await Store.getKV('sampleSeeded')); } catch (e) {}
  if (!S.jobs.length && !seeded) { try { await seedSample(); await Store.setKV('sampleSeeded', true); } catch (e) { console.warn(e); } }
  show('jobs');
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
