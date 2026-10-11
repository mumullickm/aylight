const $ = (id) => document.getElementById(id);
const api = window.aylight;
const address = $('address');
let state = { tabs: [], activeId: null };
let editing = false;

const closeIcon = '<svg viewBox="0 0 10 10"><path d="m1 1 8 8M9 1 1 9"/></svg>';

function displayURL(url) {
  return url.replace(/^https:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

function render() {
  const tabsEl = $('tabs');
  tabsEl.textContent = '';
  for (const t of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === state.activeId ? ' on' : '');
    el.title = t.title;
    let lead;
    if (t.loading) { lead = document.createElement('span'); lead.className = 'spin'; }
    else if (t.favicon) {
      lead = document.createElement('img'); lead.className = 'fav'; lead.src = t.favicon;
      lead.onerror = () => { lead.removeAttribute('src'); lead.classList.add('blank'); };
    } else { lead = document.createElement('span'); lead.className = 'fav blank'; }
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title || displayURL(t.url) || 'New Tab';
    const close = document.createElement('button');
    close.className = 'close';
    close.innerHTML = closeIcon;
    close.onclick = (e) => { e.stopPropagation(); api.send('close-tab', t.id); };
    el.append(lead, title, close);
    el.onmousedown = (e) => { if (e.button === 0) api.send('activate', t.id); };
    el.onauxclick = (e) => { if (e.button === 1) api.send('close-tab', t.id); };
    tabsEl.append(el);
  }
  const a = state.tabs.find((t) => t.id === state.activeId);
  $('back').disabled = !state.canBack;
  $('forward').disabled = !state.canForward;
  document.body.classList.toggle('loading', !!(a && a.loading));
  document.body.classList.toggle('secure', !!(a && a.url.startsWith('https://')));
  if (!editing) address.value = a ? displayURL(a.url) : '';
}

api.on('state', (s) => { state = s; render(); });
api.on('platform', (p) => document.body.classList.add(p === 'darwin' ? 'mac' : p === 'win32' ? 'win' : 'linux'));
api.on('focus-address', () => { address.focus(); address.select(); });

$('new').onclick = () => api.send('new-tab');
$('back').onclick = () => api.send('back');
$('forward').onclick = () => api.send('forward');
$('reload').onclick = () => api.send('reload');
$('strip').ondblclick = (e) => { if (e.target.id === 'strip' || e.target.id === 'tabs') api.send('new-tab'); };

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
