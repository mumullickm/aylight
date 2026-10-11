const $ = (id) => document.getElementById(id);
const api = window.aylight;
const address = $('address');
let state = { tabs: [], bookmarks: [], activeId: null, sidebar: true };
let editing = false;

const closeIcon = '<svg viewBox="0 0 10 10"><path d="m1 1 8 8M9 1 1 9"/></svg>';

function displayURL(url) {
  return url.replace(/^https:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

function lead(item) {
  if (item.loading) { const s = document.createElement('span'); s.className = 'spin'; return s; }
  if (item.favicon) {
    const img = document.createElement('img'); img.className = 'fav'; img.src = item.favicon;
    img.onerror = () => { img.removeAttribute('src'); img.classList.add('blank'); };
    return img;
  }
  const s = document.createElement('span'); s.className = 'fav blank'; return s;
}

function row(item, { on, label, onClose }) {
  const el = document.createElement('div');
  el.className = 'row' + (on ? ' on' : '');
  el.title = item.url || item.title;
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = label;
  const x = document.createElement('button');
  x.className = 'x';
  x.innerHTML = closeIcon;
  x.onclick = (e) => { e.stopPropagation(); onClose(); };
  el.append(lead(item), title, x);
  return el;
}

function render() {
  const pinsEl = $('pins');
  pinsEl.textContent = '';
  for (const t of state.tabs.filter((x) => x.pinned)) {
    const el = document.createElement('div');
    el.className = 'pin' + (t.id === state.activeId ? ' on' : '');
    el.title = t.title || displayURL(t.url);
    el.append(lead(t));
    el.onmousedown = (e) => { if (e.button === 0) api.send('activate', t.id); };
    el.onauxclick = (e) => { if (e.button === 1) api.send('pin-toggle', t.id); };
    pinsEl.append(el);
  }
  const tabsEl = $('tabs');
  tabsEl.textContent = '';
  for (const t of state.tabs.filter((x) => !x.pinned)) {
    const el = row(t, {
      on: t.id === state.activeId,
      label: t.title || displayURL(t.url) || 'New Tab',
      onClose: () => api.send('close-tab', t.id),
    });
    el.onmousedown = (e) => { if (e.button === 0) api.send('activate', t.id); };
    el.onauxclick = (e) => { if (e.button === 1) api.send('close-tab', t.id); };
    tabsEl.append(el);
  }

  const bmEl = $('bookmarks');
  bmEl.textContent = '';
  for (const b of state.bookmarks) {
    const el = row(b, {
      on: false,
      label: b.title || displayURL(b.url),
      onClose: () => api.send('bookmark-remove', b.url),
    });
    el.onclick = (e) => api.send('open', { url: b.url, newTab: e.metaKey || e.ctrlKey });
    el.onauxclick = (e) => { if (e.button === 1) api.send('open', { url: b.url, newTab: true }); };
    bmEl.append(el);
  }

  const a = state.tabs.find((t) => t.id === state.activeId);
  $('back').disabled = !state.canBack;
  $('forward').disabled = !state.canForward;
  $('star').classList.toggle('on', !!state.bookmarked);
  $('pin').classList.toggle('on', !!(a && a.pinned));
  $('pin').disabled = !(a && /^https?:/.test(a.url));
  $('star').disabled = !(a && /^https?:/.test(a.url));
  document.body.classList.toggle('nosb', !state.sidebar);
  document.body.classList.toggle('loading', !!(a && a.loading));
  document.body.classList.toggle('secure', !!(a && a.url.startsWith('https://')));
  if (!editing) address.value = a ? displayURL(a.url) : '';
  renderDownloads();
}

api.on('state', (s) => { state = s; render(); });
api.on('platform', (p) => document.body.classList.add(p === 'darwin' ? 'mac' : p === 'win32' ? 'win' : 'linux'));
api.on('focus-address', () => { address.focus(); address.select(); });

$('new').onclick = () => api.send('new-tab');
$('back').onclick = () => api.send('back');
$('forward').onclick = () => api.send('forward');
$('reload').onclick = () => api.send('reload');
$('star').onclick = () => api.send('bookmark-toggle');
$('pin').onclick = () => api.send('pin-toggle', state.activeId);
$('sidetoggle').onclick = () => api.send('toggle-sidebar');
$('side').ondblclick = (e) => { if (e.target.id === 'side' || e.target.id === 'side-top') api.send('new-tab'); };

address.onfocus = () => {
  editing = true;
  const a = state.tabs.find((t) => t.id === state.activeId);
  if (a && a.url) address.value = a.url;
  requestAnimationFrame(() => address.select());
};
address.onblur = () => { editing = false; render(); };

let lastLen = 0;
address.oninput = async (e) => {
  const typed = address.value;
  const deleting = typed.length < lastLen || e.inputType?.startsWith('delete');
  lastLen = typed.length;
  if (deleting || !typed || /\s/.test(typed)) return;
  const hit = await api.complete(typed);
  if (hit && address.value === typed && hit.toLowerCase().startsWith(typed.toLowerCase()) && hit.length > typed.length) {
    address.value = typed + hit.slice(typed.length);
    address.setSelectionRange(typed.length, hit.length);
  }
};

address.onkeydown = (e) => {
  if (e.key === 'Escape') { editing = false; render(); api.send('escape-address'); }
};

$('form').onsubmit = (e) => {
  e.preventDefault();
  editing = false;
  api.send('navigate', address.value);
  address.blur();
};

const find = $('find');
const findq = $('findq');
const findn = $('findn');

function runFind(forward = true, next = false) {
  api.send('find', { text: findq.value, forward, next });
  if (!findq.value) findn.textContent = '';
}

api.on('find-open', () => { find.hidden = false; findq.focus(); findq.select(); if (findq.value) runFind(); });
api.on('find-close', () => { find.hidden = true; findn.textContent = ''; });
api.on('find-step', (forward) => { if (!find.hidden && findq.value) runFind(forward, true); });
api.on('find-result', ({ active, total }) => { findn.textContent = total ? `${active}/${total}` : 'None'; });

findq.oninput = () => runFind();
findq.onkeydown = (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runFind(!e.shiftKey, true); }
  if (e.key === 'Escape') api.send('find-close');
};
$('findprev').onclick = () => runFind(false, true);
$('findnext').onclick = () => runFind(true, true);
$('findx').onclick = () => api.send('find-close');

const jump = $('jump');
const jumpq = $('jumpq');
const jumpList = $('jump-list');
let hits = [];
let hitIndex = 0;
let jumpSeq = 0;

const clockIcon = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>';
const searchIcon = '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>';

function hitRow(h, i) {
  const el = document.createElement('div');
  el.className = 'hit' + (i === hitIndex ? ' on' : '');
  const lead = document.createElement('span');
  lead.className = 'lead';
  if (h.kind === 'history') lead.innerHTML = clockIcon;
  else if (h.kind === 'search') lead.innerHTML = searchIcon;
  else lead.append(lead$(h));
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = h.kind === 'search' ? `Search Google for “${h.q}”` : (h.title || displayURL(h.url));
  const u = document.createElement('span');
  u.className = 'u';
  u.textContent = h.kind === 'search' ? '' : displayURL(h.url).split('/')[0];
  const k = document.createElement('span');
  k.className = 'key';
  k.textContent = h.kind === 'tab' ? '↵' : '↵  ⌘↵ new tab';
  el.append(lead, t, u, k);
  el.onmousemove = () => { if (hitIndex !== i) { hitIndex = i; paintHits(); } };
  el.onclick = (e) => go(e.metaKey || e.ctrlKey);
  return el;
}

function lead$(item) {
  if (item.favicon) {
    const img = document.createElement('img'); img.className = 'fav'; img.src = item.favicon;
    img.onerror = () => { img.removeAttribute('src'); img.classList.add('blank'); };
    return img;
  }
  const s = document.createElement('span'); s.className = 'fav blank'; return s;
}

function paintHits() {
  jumpList.textContent = '';
  let last = null;
  hits.forEach((h, i) => {
    if (h.kind !== last) {
      const sec = document.createElement('div');
      sec.className = 'sec';
      sec.textContent = { tab: 'Tabs', bookmark: 'Bookmarks', history: 'History', search: 'Search' }[h.kind];
      jumpList.append(sec);
      last = h.kind;
    }
    jumpList.append(hitRow(h, i));
  });
  if (!hits.length) {
    const e = document.createElement('div'); e.id = 'jump-empty';
    e.textContent = 'Nothing yet. Pages you visit show up here.';
    jumpList.append(e);
  }
  const on = jumpList.querySelector('.hit.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

async function runJump() {
  const seq = ++jumpSeq;
  const r = await api.jump(jumpq.value);
  if (seq !== jumpSeq) return;
  hits = [
    ...r.tabs.map((x) => ({ kind: 'tab', ...x })),
    ...r.bookmarks.map((x) => ({ kind: 'bookmark', ...x })),
    ...r.history.map((x) => ({ kind: 'history', ...x })),
    ...(r.search ? [{ kind: 'search', q: r.search }] : []),
  ];
  hitIndex = 0;
  paintHits();
}

function go(newTab) {
  const h = hits[hitIndex];
  if (!h) return;
  if (h.kind === 'tab') api.send('jump-go', { tab: h.id });
  else if (h.kind === 'search') api.send('jump-go', { url: 'https://www.google.com/search?q=' + encodeURIComponent(h.q), newTab });
  else api.send('jump-go', { url: h.url, newTab });
}

api.on('jump-open', () => { jump.hidden = false; jumpq.value = ''; jumpq.focus(); runJump(); });
api.on('jump-close', () => { jump.hidden = true; });

jumpq.oninput = () => runJump();
jumpq.onkeydown = (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); hitIndex = Math.min(hits.length - 1, hitIndex + 1); paintHits(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); hitIndex = Math.max(0, hitIndex - 1); paintHits(); }
  else if (e.key === 'Enter') { e.preventDefault(); go(e.metaKey || e.ctrlKey); }
  else if (e.key === 'Escape') api.send('jump-close');
};
jump.onmousedown = (e) => { if (e.target === jump) api.send('jump-close'); };

const dlIcon = '<svg viewBox="0 0 16 16"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10"/></svg>';
const fileIcon = '<svg viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>';

function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

function renderDownloads() {
  const list = state.downloads || [];
  $('dl-head').hidden = !list.length;
  const el = $('downloads');
  el.textContent = '';
  for (const d of list) {
    const row = document.createElement('div');
    const done = d.state === 'completed';
    const bad = d.state === 'cancelled' || d.state === 'interrupted' || d.state === 'missing';
    row.className = 'row' + (done ? ' done' : '') + (bad ? ' bad' : '');
    row.title = d.path;
    const lead = document.createElement('span');
    lead.className = 'lead';
    lead.innerHTML = done ? fileIcon : dlIcon;
    const col = document.createElement('span');
    col.className = 'col';
    const t = document.createElement('span'); t.className = 'title'; t.textContent = d.name;
    const sub = document.createElement('span'); sub.className = 'sub';
    sub.textContent = done ? 'Done · click to open'
      : d.state === 'missing' ? 'File was moved'
      : d.state === 'cancelled' ? 'Cancelled'
      : d.state === 'interrupted' ? 'Interrupted'
      : d.total ? `${mb(d.received)} of ${mb(d.total)}` : mb(d.received);
    col.append(t, sub);
    const x = document.createElement('button');
    x.className = 'x';
    x.title = done || bad ? 'Remove from list' : 'Cancel';
    x.innerHTML = closeIcon;
    x.onclick = (e) => { e.stopPropagation(); api.send('download-remove', d.id); };
    row.append(lead, col, x);
    if (!done && !bad && d.total) {
      const bar = document.createElement('span'); bar.className = 'bar';
      bar.style.width = Math.round((d.received / d.total) * 100) + '%';
      row.append(bar);
    }
    row.onclick = () => { if (done) api.send('download-open', d.id); };
    row.oncontextmenu = (e) => { e.preventDefault(); api.send('download-reveal', d.id); };
    el.append(row);
  }
}

$('dl-clear').onclick = () => api.send('downloads-clear');
