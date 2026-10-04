// src/routes/reviewPage.js — the self-contained review UI (one HTML string).
//
// The page ships with no secrets. It gets REVIEW_KEY from the user (typed once,
// or ?key=), stores it in this browser's localStorage, and sends it in an
// X-Review-Key header. NOTE: keep this file free of backticks and ${…} — it is
// one big template literal and the client script uses plain string concatenation.

export function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0f1115" />
<title>JobTrail Mailwatch — Review</title>
<style>
  :root { --bg:#0f1115; --card:#1a1d24; --line:#2a2e38; --fg:#e6e8ec; --mut:#9aa0ab; --acc:#4f8cff; --good:#3fb950; --bad:#f85149; --warn:#d29922; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); -webkit-text-size-adjust:100%; }
  header { padding:14px 16px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:10px 16px; flex-wrap:wrap; }
  h1 { font-size:16px; margin:0; }
  .mut { color:var(--mut); }
  .small { font-size:12px; }
  .wrap { max-width:820px; margin:0 auto; padding:16px; }
  button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--fg); padding:9px 14px; min-height:40px; border-radius:8px; cursor:pointer; }
  button:hover { border-color:var(--acc); }
  button:disabled { opacity:.6; cursor:default; }
  button.primary { background:var(--acc); border-color:var(--acc); color:#fff; }
  button.danger:hover { border-color:var(--bad); color:var(--bad); }
  button.link { background:none; border:none; color:var(--mut); padding:0; min-height:0; text-decoration:underline; }
  select, input { font:inherit; font-size:16px; /* >=16px stops iOS zooming on focus */ background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:9px 10px; min-height:40px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin-bottom:12px; }
  .row { display:flex; gap:8px 10px; align-items:center; flex-wrap:wrap; }
  .subj { font-weight:600; overflow-wrap:anywhere; }
  .pill { font-size:12px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--mut); }
  .pill.rej { color:var(--bad); border-color:var(--bad); }
  .pill.int { color:var(--good); border-color:var(--good); }
  .pill.warn { color:var(--warn); border-color:var(--warn); }
  .snippet { color:var(--mut); margin:8px 0; font-size:14px; overflow-wrap:anywhere; }
  .actions { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center; }
  .banner { background:var(--card); border:1px solid var(--warn); border-radius:12px; padding:12px 16px; margin-bottom:14px; }
  .banner.ok { border-color:var(--line); }
  .empty { color:var(--mut); padding:40px 0; text-align:center; }
  a { color:var(--acc); }
  code { background:var(--bg); padding:1px 6px; border-radius:4px; border:1px solid var(--line); overflow-wrap:anywhere; user-select:all; }
  .tabs { display:flex; gap:6px; margin-bottom:14px; overflow-x:auto; padding-bottom:2px; }
  .tabs button { white-space:nowrap; }
  .tabs button.active { border-color:var(--acc); color:var(--acc); }
  #lock { max-width:420px; margin:12vh auto 0; }
  #lock input { width:100%; margin:10px 0; }
  .err { color:var(--bad); min-height:1.4em; }
  @media (max-width:600px) {
    .actions select, .actions button, .row input { flex:1 1 100%; }
    .wrap { padding:12px; }
  }
</style>
</head>
<body>

<div id="lock" class="wrap" hidden>
  <h1>JobTrail Mailwatch</h1>
  <p class="mut">Enter your review key. It's saved in this browser only.</p>
  <form id="keyForm">
    <input type="text" name="username" value="mailwatch" autocomplete="username" hidden />
    <input id="keyInput" type="password" name="password" autocomplete="current-password" placeholder="Review key" autocapitalize="off" autocorrect="off" spellcheck="false" />
    <button class="primary" type="submit" style="width:100%">Unlock</button>
  </form>
  <div id="keyErr" class="err"></div>
</div>

<div id="app" hidden>
  <header>
    <h1>JobTrail Mailwatch</h1>
    <span id="status" class="mut small">loading…</span>
    <span style="flex:1"></span>
    <button id="syncBtn">Sync now</button>
    <button class="link small" id="lockBtn" title="Forget the key on this device">Lock</button>
  </header>

  <div class="wrap">
    <div id="setup"></div>

    <div class="tabs">
      <button data-tab="pending" class="active">Needs review</button>
      <button data-tab="no_match">No match</button>
      <button data-tab="applied">Applied</button>
      <button data-tab="all">All</button>
    </div>

    <div id="list"><div class="empty">loading…</div></div>
  </div>
</div>

<script>
var STORE = 'mw_key';
var KEY = null;
try {
  var qk = new URLSearchParams(location.search).get('key');
  if (qk) { localStorage.setItem(STORE, qk); history.replaceState(null, '', location.pathname); }
  KEY = localStorage.getItem(STORE);
} catch (e) {}

var JOBS = [];
var TAB = 'pending';
var STATUSES = ['applied','phone_screen','interview','offer','rejected','ghosted'];
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); };

function showLock(msg) {
  $('app').hidden = true; $('lock').hidden = false;
  $('keyErr').textContent = msg || '';
  setTimeout(function () { $('keyInput').focus(); }, 50);
}
function showApp() { $('lock').hidden = true; $('app').hidden = false; }

async function api(path, opts) {
  opts = opts || {};
  var headers = Object.assign({ 'Content-Type': 'application/json', 'X-Review-Key': KEY || '' }, opts.headers || {});
  var r = await fetch(path, Object.assign({}, opts, { headers: headers }));
  var d = await r.json().catch(function () { return {}; });
  if (r.status === 401) { var e = new Error('unauthorized'); e.unauthorized = true; throw e; }
  if (!r.ok) throw new Error(d.error || r.status);
  return d;
}

$('keyForm').onsubmit = async function (ev) {
  ev.preventDefault();
  KEY = $('keyInput').value.trim();
  try {
    await api('/review/api/status');
    try { localStorage.setItem(STORE, KEY); } catch (e) {}
    showApp(); refresh();
  } catch (e) {
    KEY = null;
    $('keyErr').textContent = e.unauthorized ? 'That key is not right.' : 'Could not reach the server: ' + e.message;
  }
};

$('lockBtn').onclick = function () {
  try { localStorage.removeItem(STORE); } catch (e) {}
  KEY = null; $('keyInput').value = ''; showLock('');
};

function handle(e) {
  if (e && e.unauthorized) { try { localStorage.removeItem(STORE); } catch (x) {} KEY = null; showLock('Key rejected — enter it again.'); return; }
  alert('Failed: ' + (e && e.message ? e.message : e));
}

async function loadStatus() {
  var s = await api('/review/api/status');
  var bits = [];
  bits.push(s.gmail_connected ? 'Gmail: ' + esc(s.gmail_email) : '<b style="color:var(--bad)">Gmail not connected</b>');
  bits.push(s.jobtrail_connected ? 'JobTrail: ' + esc(s.jobtrail_email) : '<b style="color:var(--bad)">JobTrail not connected</b>');
  if (s.last_sync_at) bits.push('synced ' + new Date(s.last_sync_at).toLocaleString());
  $('status').innerHTML = bits.join(' &nbsp;·&nbsp; ');

  var html = '';
  if (!s.jobtrail_connected) {
    html += '<div class="banner"><b>Connect JobTrail</b><div class="mut small" style="margin:6px 0">Stored encrypted; used only to read your applications and push the status changes you confirm.</div>'
      + '<div class="row"><input id="jtEmail" type="email" placeholder="JobTrail email" style="min-width:220px" autocapitalize="off" />'
      + '<input id="jtPass" type="password" placeholder="JobTrail password" style="min-width:180px" />'
      + '<button class="primary" onclick="saveJT()">Save</button></div></div>';
  }
  if (!s.gmail_connected) {
    html += '<div class="banner"><b>Connect Gmail</b><div class="mut small" style="margin:6px 0">Read-only access.</div>'
      + '<button class="primary" onclick="connectGmail()">Start Google sign-in →</button></div>';
  }
  var n = s.notifications || {};
  if (n.enabled) {
    html += '<div class="banner ok"><b>📲 Phone alerts are on</b>'
      + '<div class="mut small" style="margin:6px 0">In the free <b>ntfy</b> app, subscribe to this topic' + (n.server && n.server.indexOf('ntfy.sh') < 0 ? ' (server: ' + esc(n.server) + ')' : '') + ':</div>'
      + '<div class="row"><code>' + esc(n.topic) + '</code>'
      + '<button onclick="copyTopic(\\'' + esc(n.topic) + '\\')">Copy</button>'
      + '<button onclick="testNotify()">Send test</button></div>'
      + '<div class="mut small" style="margin-top:6px">Treat the topic like a password — anyone who knows it can read the alerts.</div></div>';
  } else {
    html += '<div class="banner ok"><b>📲 Phone alerts are off</b>'
      + '<div class="mut small" style="margin-top:6px">To get a push when emails need review, add <code>NTFY_TOPIC=auto</code> to the server&#39;s environment variables and redeploy.</div></div>';
  }
  $('setup').innerHTML = html;
}

function connectGmail() { location.href = '/oauth/start?key=' + encodeURIComponent(KEY); }

async function copyTopic(t) {
  try { await navigator.clipboard.writeText(t); alert('Copied'); } catch (e) { prompt('Copy this topic:', t); }
}

async function testNotify() {
  try { await api('/review/api/notify-test', { method:'POST', body:'{}' }); alert('Sent — check your phone.'); }
  catch (e) { handle(e); }
}

async function saveJT() {
  var email = $('jtEmail').value.trim();
  var password = $('jtPass').value;
  try {
    await api('/review/setup/jobtrail', { method:'POST', body: JSON.stringify({ email: email, password: password }) });
    await refresh();
  } catch (e) { handle(e); }
}

async function loadJobs() {
  try { JOBS = (await api('/review/api/jobs')).jobs || []; } catch (e) { if (e.unauthorized) throw e; JOBS = []; }
}

function jobOptions(selectedId) {
  return '<option value="">— pick an application —</option>' + JOBS.map(function (j) {
    return '<option value="' + j.id + '"' + (j.id === selectedId ? ' selected' : '') + '>' + esc(j.label) + ' (' + j.status + ')</option>';
  }).join('');
}

function pillClass(ev) {
  if (ev === 'rejection' || ev === 'ghosted') return 'rej';
  if (ev === 'interview_invite' || ev === 'phone_screen' || ev === 'offer' || ev === 'assessment') return 'int';
  return '';
}

function card(d) {
  var canAct = d.state === 'pending' || d.state === 'no_match';
  var conf = d.llm_confidence != null ? Math.round(d.llm_confidence * 100) + '% conf' : '';
  var score = d.match_score != null ? ' · match ' + Math.round(d.match_score * 100) + '%' : '';
  return '<div class="card" data-id="' + d.id + '">'
    + '<div class="row"><span class="subj">' + esc(d.subject || '(no subject)') + '</span>'
    + '<span class="pill ' + pillClass(d.event_type) + '">' + esc(d.event_type || d.state) + '</span>'
    + (d.note ? '<span class="pill warn">' + esc(d.note) + '</span>' : '')
    + '</div>'
    + '<div class="mut small">' + esc(d.from_addr || '') + (d.received_at ? ' · ' + new Date(d.received_at).toLocaleString() : '') + ' · ' + esc(conf) + esc(score) + '</div>'
    + '<div class="snippet">' + esc(d.snippet || '') + '</div>'
    + (canAct ? actions(d) : '<div class="mut small">' + esc(d.state) + (d.note ? ' — ' + esc(d.note) : '') + '</div>')
    + '</div>';
}

function actions(d) {
  var statusSel = '<select class="st">' + STATUSES.map(function (s) {
    return '<option value="' + s + '"' + (s === d.proposed_status ? ' selected' : '') + '>' + s + '</option>';
  }).join('') + '</select>';
  var jobSel = '<select class="job">' + jobOptions(d.matched_job_id) + '</select>';
  return '<div class="actions">' + jobSel + statusSel
    + '<button class="primary" onclick="confirmDet(' + d.id + ')">Confirm → JobTrail</button>'
    + '<button class="danger" onclick="dismissDet(' + d.id + ')">Dismiss</button></div>';
}

async function confirmDet(id) {
  var el = document.querySelector('.card[data-id="' + id + '"]');
  var job_id = el.querySelector('.job').value;
  var status = el.querySelector('.st').value;
  if (!job_id) return alert('Pick an application first.');
  try {
    await api('/review/api/detections/' + id + '/confirm', { method:'POST', body: JSON.stringify({ job_id: job_id, status: status }) });
    await refresh();
  } catch (e) { handle(e); }
}

async function dismissDet(id) {
  try {
    await api('/review/api/detections/' + id + '/dismiss', { method:'POST', body: '{}' });
    await refresh();
  } catch (e) { handle(e); }
}

async function loadList() {
  var state = TAB === 'all' ? '' : TAB;
  var out = await api('/review/api/detections' + (state ? '?state=' + state : ''));
  var detections = out.detections;
  $('list').innerHTML = detections.length ? detections.map(card).join('') : '<div class="empty">Nothing here.</div>';
}

async function refresh() {
  try {
    await loadStatus();
    await loadJobs();
    await loadList();
  } catch (e) { handle(e); }
}

Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
  b.onclick = function () {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    TAB = b.dataset.tab;
    loadList().catch(handle);
  };
});

$('syncBtn').onclick = async function () {
  var btn = $('syncBtn');
  btn.disabled = true; btn.textContent = 'Syncing…';
  try {
    var r = await api('/review/api/sync', { method:'POST', body:'{}' });
    btn.textContent = r.baseline
      ? 'Start time set'
      : 'Synced (' + (r.new || 0) + ' new' + (r.deferred ? ', ' + r.deferred + ' waiting — sync again in a minute' : '') + ')';
  } catch (e) { btn.textContent = 'Sync failed'; handle(e); }
  setTimeout(function () { btn.disabled = false; btn.textContent = 'Sync now'; }, 6000);
  refresh();
};

// Coming back to the tab/app (e.g. after tapping a notification) shows fresh data.
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && KEY && !$('app').hidden) refresh();
});

if (KEY) { showApp(); refresh(); } else { showLock(''); }
</script>
</body>
</html>`;
}
