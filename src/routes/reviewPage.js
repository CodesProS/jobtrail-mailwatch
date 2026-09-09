// src/routes/reviewPage.js — the self-contained review UI (one HTML string)

export function renderPage(reviewKey) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>JobTrail Mailwatch — Review</title>
<style>
  :root { --bg:#0f1115; --card:#1a1d24; --line:#2a2e38; --fg:#e6e8ec; --mut:#9aa0ab; --acc:#4f8cff; --good:#3fb950; --bad:#f85149; --warn:#d29922; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  h1 { font-size:16px; margin:0; }
  .mut { color:var(--mut); }
  .wrap { max-width:820px; margin:0 auto; padding:20px; }
  button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--fg); padding:6px 12px; border-radius:6px; cursor:pointer; }
  button:hover { border-color:var(--acc); }
  button.primary { background:var(--acc); border-color:var(--acc); color:#fff; }
  button.danger:hover { border-color:var(--bad); color:var(--bad); }
  select, input { font:inherit; background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:6px 8px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:12px; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .subj { font-weight:600; }
  .pill { font-size:12px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--mut); }
  .pill.rej { color:var(--bad); border-color:var(--bad); }
  .pill.int { color:var(--good); border-color:var(--good); }
  .pill.warn { color:var(--warn); border-color:var(--warn); }
  .snippet { color:var(--mut); margin:8px 0; font-size:13px; }
  .actions { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center; }
  .banner { background:var(--card); border:1px solid var(--warn); border-radius:10px; padding:12px 16px; margin-bottom:16px; }
  .empty { color:var(--mut); padding:40px 0; text-align:center; }
  a { color:var(--acc); }
  code { background:var(--bg); padding:1px 5px; border-radius:4px; border:1px solid var(--line); }
  .tabs { display:flex; gap:6px; margin-bottom:14px; }
  .tabs button.active { border-color:var(--acc); color:var(--acc); }
</style>
</head>
<body>
<header>
  <h1>JobTrail Mailwatch</h1>
  <span id="status" class="mut">loading…</span>
  <span style="flex:1"></span>
  <button id="syncBtn">Sync now</button>
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

<script>
const KEY = ${JSON.stringify(reviewKey)};
const H = { 'Content-Type':'application/json', 'X-Review-Key': KEY };
let JOBS = [];
let TAB = 'pending';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const STATUSES = ['applied','phone_screen','interview','offer','rejected','ghosted'];

async function api(path, opts) {
  const r = await fetch(path + (path.includes('?') ? '' : '?key=' + encodeURIComponent(KEY)), opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.status);
  return d;
}

async function loadStatus() {
  const s = await api('/review/api/status');
  const bits = [];
  bits.push(s.gmail_connected ? 'Gmail: ' + esc(s.gmail_email) : '<b style="color:var(--bad)">Gmail not connected</b>');
  bits.push(s.jobtrail_connected ? 'JobTrail: ' + esc(s.jobtrail_email) : '<b style="color:var(--bad)">JobTrail not connected</b>');
  if (s.last_sync_at) bits.push('last sync ' + new Date(s.last_sync_at).toLocaleString());
  document.getElementById('status').innerHTML = bits.join(' &nbsp;·&nbsp; ');

  const setup = document.getElementById('setup');
  let html = '';
  if (!s.jobtrail_connected) {
    html += '<div class="banner"><b>Connect JobTrail</b><div class="mut" style="margin:6px 0">Stored encrypted; used only to read your applications and push confirmed status changes.</div>'
      + '<div class="row"><input id="jtEmail" type="email" placeholder="JobTrail email" style="min-width:220px" />'
      + '<input id="jtPass" type="password" placeholder="JobTrail password" style="min-width:180px" />'
      + '<button class="primary" onclick="saveJT()">Save</button></div></div>';
  }
  if (!s.gmail_connected) {
    html += '<div class="banner"><b>Connect Gmail</b><div class="mut" style="margin:6px 0">Read-only access. <a href="' + esc(s.oauth_start) + '">Start Google sign-in →</a></div></div>';
  }
  setup.innerHTML = html;
}

async function saveJT() {
  const email = document.getElementById('jtEmail').value.trim();
  const password = document.getElementById('jtPass').value;
  try {
    await api('/review/setup/jobtrail', { method:'POST', headers:H, body: JSON.stringify({ email, password }) });
    await refresh();
  } catch (e) { alert('Failed: ' + e.message); }
}

async function loadJobs() {
  try { JOBS = (await api('/review/api/jobs')).jobs || []; } catch { JOBS = []; }
}

function jobOptions(selectedId) {
  return '<option value="">— pick an application —</option>' + JOBS.map((j) =>
    '<option value="' + j.id + '"' + (j.id === selectedId ? ' selected' : '') + '>' + esc(j.label) + ' (' + j.status + ')</option>'
  ).join('');
}

function pillClass(ev) {
  if (ev === 'rejection' || ev === 'ghosted') return 'rej';
  if (ev === 'interview_invite' || ev === 'phone_screen' || ev === 'offer' || ev === 'assessment') return 'int';
  return '';
}

function card(d) {
  const canAct = d.state === 'pending' || d.state === 'no_match';
  const conf = d.llm_confidence != null ? Math.round(d.llm_confidence * 100) + '% conf' : '';
  const score = d.match_score != null ? ' · match ' + Math.round(d.match_score * 100) + '%' : '';
  return '<div class="card" data-id="' + d.id + '">'
    + '<div class="row"><span class="subj">' + esc(d.subject || '(no subject)') + '</span>'
    + '<span class="pill ' + pillClass(d.event_type) + '">' + esc(d.event_type || d.state) + '</span>'
    + (d.note ? '<span class="pill warn">' + esc(d.note) + '</span>' : '')
    + '</div>'
    + '<div class="mut" style="font-size:12px">' + esc(d.from_addr || '') + (d.received_at ? ' · ' + new Date(d.received_at).toLocaleString() : '') + ' · ' + esc(conf) + esc(score) + '</div>'
    + '<div class="snippet">' + esc(d.snippet || '') + '</div>'
    + (canAct ? actions(d) : '<div class="mut" style="font-size:12px">' + esc(d.state) + (d.note ? ' — ' + esc(d.note) : '') + '</div>')
    + '</div>';
}

function actions(d) {
  const statusSel = '<select class="st">' + STATUSES.map((s) =>
    '<option value="' + s + '"' + (s === d.proposed_status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>';
  const jobSel = '<select class="job">' + jobOptions(d.matched_job_id) + '</select>';
  return '<div class="actions">' + jobSel + statusSel
    + '<button class="primary" onclick="confirmDet(' + d.id + ')">Confirm → JobTrail</button>'
    + '<button class="danger" onclick="dismissDet(' + d.id + ')">Dismiss</button></div>';
}

async function confirmDet(id) {
  const el = document.querySelector('.card[data-id="' + id + '"]');
  const job_id = el.querySelector('.job').value;
  const status = el.querySelector('.st').value;
  if (!job_id) return alert('Pick an application first.');
  try {
    await api('/review/api/detections/' + id + '/confirm', { method:'POST', headers:H, body: JSON.stringify({ job_id, status }) });
    await refresh();
  } catch (e) { alert('Failed: ' + e.message); }
}

async function dismissDet(id) {
  try {
    await api('/review/api/detections/' + id + '/dismiss', { method:'POST', headers:H, body: JSON.stringify({}) });
    await refresh();
  } catch (e) { alert('Failed: ' + e.message); }
}

async function loadList() {
  const state = TAB === 'all' ? '' : TAB;
  const { detections } = await api('/review/api/detections' + (state ? '?state=' + state + '&key=' + encodeURIComponent(KEY) : ''));
  const list = document.getElementById('list');
  if (!detections.length) { list.innerHTML = '<div class="empty">Nothing here.</div>'; return; }
  list.innerHTML = detections.map(card).join('');
}

async function refresh() {
  await loadStatus();
  await loadJobs();
  await loadList();
}

document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  TAB = b.dataset.tab;
  loadList();
});

document.getElementById('syncBtn').onclick = async () => {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true; btn.textContent = 'Syncing…';
  try {
    const r = await api('/review/api/sync', { method:'POST', headers:H, body:'{}' });
    btn.textContent = 'Synced (' + (r.new ?? 0) + ' new)';
  } catch (e) { btn.textContent = 'Sync failed'; alert(e.message); }
  setTimeout(() => { btn.disabled = false; btn.textContent = 'Sync now'; }, 2500);
  refresh();
};

refresh();
</script>
</body>
</html>`;
}
