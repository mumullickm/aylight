const $ = (id) => document.getElementById(id);
const api = window.aylight;
const fmt = (n) => n.toLocaleString();

api.on('state', (s) => {
  const sh = s.shield;
  if (!sh) return;
  const c = sh.counts;
  document.body.classList.toggle('is-off', sh.off || !sh.ready);
  $('status').textContent = !sh.ready ? 'Shield is getting its lists' : sh.off ? 'Shield is off' : 'Shield is on';
  $('site').textContent = sh.site;
  $('n').textContent = fmt(c.ads + c.trackers + c.fp);
  $('what').textContent = sh.off ? 'blocked, off for this site' : 'blocked on this page';
  $('ads').textContent = fmt(c.ads);
  $('trackers').textContent = fmt(c.trackers);
  $('fp').textContent = fmt(c.fp);
  $('off').checked = sh.off;
  $('off').disabled = !sh.ready;
  $('lists').textContent = `Lists: EasyList, EasyPrivacy. Updated weekly, kept on ${sh.where}.`;
});

$('off').onchange = () => api.send('shield-toggle');
document.onkeydown = (e) => { if (e.key === 'Escape') api.send('shield-close'); };
document.onmousedown = (e) => { if (!$('pop').contains(e.target)) api.send('shield-close'); };
