const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { FiltersEngine, Request } = require('@ghostery/adblocker');
const { parse } = require('tldts-experimental');

const LISTS = {
  ads: { url: 'https://easylist.to/easylist/easylist.txt', cosmetic: true },
  trackers: { url: 'https://easylist.to/easylist/easyprivacy.txt', cosmetic: false },
};
const WEEK = 7 * 86400000;
const FP = /fingerprint|fpjs|fpcdn|fpnpmcdn|openfpcdn|online-metrix|threatmetrix|iovation|clientjs/i;
const TYPES = {
  mainFrame: 'main_frame', subFrame: 'sub_frame', stylesheet: 'stylesheet', script: 'script', image: 'image',
  font: 'font', object: 'object', xhr: 'xmlhttprequest', ping: 'ping', cspReport: 'csp_report', media: 'media',
  webSocket: 'websocket', other: 'other',
};
const DOM = `(() => {
  const c = new Set(), i = new Set(), h = new Set();
  for (const el of document.querySelectorAll('[class],[id],a[href]')) {
    for (const x of el.classList) c.add(x);
    if (el.id) i.add(el.id);
    if (el.href && typeof el.href === 'string') h.add(el.href);
  }
  return { classes: [...c].slice(0, 5000), ids: [...i].slice(0, 5000), hrefs: [...h].slice(0, 2000) };
})()`;

const dir = () => path.join(app.getPath('userData'), 'shield');
const engines = {};
let state = { off: [], fetched: 0 };
let total = 0;
let onChange = () => {};

const siteOf = (url) => {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : ''; } catch { return ''; }
};

function save() {
  try { fs.writeFileSync(path.join(dir(), 'shield.json'), JSON.stringify(state)); } catch {}
}

function load(key) {
  const bin = path.join(dir(), key + '.bin');
  const txt = path.join(dir(), key + '.txt');
  try { engines[key] = FiltersEngine.deserialize(fs.readFileSync(bin)); return true; } catch {}
  try { build(key, fs.readFileSync(txt, 'utf8')); return true; } catch {}
  return false;
}

function build(key, text) {
  const engine = FiltersEngine.parse(text, { loadCosmeticFilters: LISTS[key].cosmetic, loadNetworkFilters: true });
  engines[key] = engine;
  fs.writeFileSync(path.join(dir(), key + '.txt'), text);
  fs.writeFileSync(path.join(dir(), key + '.bin'), engine.serialize());
}

async function refresh() {
  let ok = true;
  for (const key of Object.keys(LISTS)) {
    try {
      const res = await net.fetch(LISTS[key].url);
      const text = res.ok ? await res.text() : '';
      if (!text.startsWith('[Adblock Plus')) throw new Error('bad list');
      build(key, text);
    } catch { ok = false; }
  }
  if (ok) { state.fetched = Date.now(); save(); }
  onChange();
}

function kind(url, sourceUrl, type) {
  if (!engines.ads || !engines.trackers) return null;
  const req = Request.fromRawDetails({ url, sourceUrl, type: TYPES[type] || 'other' });
  const ad = engines.ads.match(req).match;
  const tr = !ad && engines.trackers.match(req).match;
  if (!ad && !tr) return null;
  return FP.test(url) ? 'fp' : tr ? 'trackers' : 'ads';
}

function attach(ses, tabFor) {
  ses.webRequest.onBeforeRequest((d, cb) => {
    if (d.resourceType === 'mainFrame' || !/^(https?|wss?):/.test(d.url)) return cb({});
    const tab = tabFor(d.webContentsId);
    if (!tab || !tab.shield || isOff(tab.url) || !siteOf(tab.url)) return cb({});
    const k = kind(d.url, tab.url, d.resourceType);
    if (!k) return cb({});
    tab.shield[k]++;
    total++;
    onChange(tab);
    cb({ cancel: true });
  });
}

async function cosmetics(wc, url) {
  const engine = engines.ads;
  if (!engine || isOff(url) || !siteOf(url)) return;
  const { hostname, domain } = parse(url);
  const base = { url, hostname, domain: domain || '', getExtendedRules: false, getInjectionRules: false };
  try {
    const first = engine.getCosmeticsFilters({ ...base, getBaseRules: true, getRulesFromHostname: true, getRulesFromDOM: false });
    if (first.styles) await wc.insertCSS(first.styles);
    const dom = await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: DOM }]);
    if (wc.isDestroyed() || wc.getURL() !== url) return;
    const more = engine.getCosmeticsFilters({ ...base, ...dom, getBaseRules: false, getRulesFromHostname: false, getRulesFromDOM: true });
    if (more.styles) await wc.insertCSS(more.styles);
  } catch {}
}

function isOff(url) { return state.off.includes(siteOf(url)); }

function toggle(url) {
  const site = siteOf(url);
  if (!site) return;
  state.off = isOff(url) ? state.off.filter((s) => s !== site) : [...state.off, site];
  save();
}

function init(change) {
  onChange = change;
  fs.mkdirSync(dir(), { recursive: true });
  try { state = { ...state, ...JSON.parse(fs.readFileSync(path.join(dir(), 'shield.json'), 'utf8')) }; } catch {}
  const have = Object.keys(LISTS).every(load);
  const due = () => !have || Date.now() - state.fetched > WEEK;
  if (due()) refresh();
  setInterval(() => { if (Date.now() - state.fetched > WEEK) refresh(); }, 6 * 3600000);
}

const ready = () => !!(engines.ads && engines.trackers);
const fresh = () => ({ ads: 0, trackers: 0, fp: 0 });

module.exports = { init, attach, cosmetics, toggle, isOff, siteOf, ready, fresh, total: () => total };
