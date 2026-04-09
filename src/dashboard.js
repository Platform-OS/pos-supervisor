/**
 * Dashboard HTML for the pos-supervisor HTTP server.
 * Served at GET /dashboard — a live view of server state and recent activity.
 */

export function buildDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>pos-supervisor</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #21262d;
    --text: #c9d1d9;
    --muted: #8b949e;
    --green: #3fb950;
    --red: #f85149;
    --blue: #58a6ff;
    --yellow: #d29922;
    --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--mono); font-size: 13px; min-height: 100vh; }
  a { color: var(--blue); text-decoration: none; }
  header { border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 15px; font-weight: 600; color: #fff; }
  header .project { color: var(--muted); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header .uptime { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .main { padding: 20px 24px; max-width: 1100px; }
  .cards { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 14px 18px; min-width: 150px; }
  .card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .card .value { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot.green { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .dot.red { background: var(--red); }
  .dot.yellow { background: var(--yellow); animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
  section { margin-bottom: 24px; }
  section h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
  section h2 .refresh-indicator { font-size: 11px; color: var(--muted); opacity: 0; transition: opacity .3s; }
  section h2 .refresh-indicator.show { opacity: 1; }
  .log-table { width: 100%; border-collapse: collapse; }
  .log-table th { text-align: left; color: var(--muted); font-size: 11px; font-weight: 500; padding: 4px 8px; border-bottom: 1px solid var(--border); }
  .log-table td { padding: 5px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; }
  .log-table tr:last-child td { border-bottom: none; }
  .log-table tr:hover td { background: var(--surface); }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 11px; font-weight: 600; }
  .badge.ok { background: #0d2a16; color: var(--green); }
  .badge.error { background: #2d0f0e; color: var(--red); }
  .badge.info { background: #0c1f3a; color: var(--blue); }
  .duration { color: var(--muted); font-size: 12px; }
  .ts { color: var(--muted); font-size: 11px; }
  .tool-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .tool-chip { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 5px 10px; font-size: 12px; color: var(--text); }
  .empty { color: var(--muted); font-size: 12px; padding: 12px 0; }
  .event-row td:first-child { color: var(--muted); font-size: 11px; width: 75px; }
  .truncate { overflow: hidden; text-overflow: ellipsis; max-width: 400px; }
</style>
</head>
<body>
<header>
  <h1>pos-supervisor</h1>
  <span class="project" id="project-dir">—</span>
  <span class="uptime" id="uptime">—</span>
</header>
<div class="main">
  <div class="cards">
    <div class="card">
      <div class="label">LSP</div>
      <div class="value" id="lsp-status"><span class="dot yellow"></span> initialising</div>
    </div>
    <div class="card">
      <div class="label">pos-cli</div>
      <div class="value" id="cli-status"><span class="dot yellow"></span> checking</div>
    </div>
    <div class="card">
      <div class="label">Tools</div>
      <div class="value" id="tool-count">—</div>
    </div>
    <div class="card">
      <div class="label">Version</div>
      <div class="value" id="version">—</div>
    </div>
  </div>

  <section>
    <h2>Tools <span class="refresh-indicator" id="tools-refresh">↻</span></h2>
    <div class="tool-grid" id="tool-list"><span class="empty">loading…</span></div>
  </section>

  <section>
    <h2>Recent Activity <span class="refresh-indicator" id="activity-refresh">↻</span></h2>
    <table class="log-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Event</th>
          <th>Detail</th>
          <th>Duration</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody id="activity-body"><tr><td colspan="5" class="empty" style="padding:12px 8px">loading…</td></tr></tbody>
    </table>
  </section>
</div>

<script>
const BASE = '';
let toolsLoaded = false;
let startTime = null;
let sessionStart = null; // ISO string — filter log entries to current server session

function fmtDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), rem = s % 60;
  if (m < 60) return m + 'm ' + rem + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function dot(color) {
  return '<span class="dot ' + color + '"></span>';
}

async function fetchStatus() {
  try {
    const r = await fetch(BASE + '/api/status');
    const d = await r.json();
    document.getElementById('project-dir').textContent = d.projectDir || '—';
    document.getElementById('version').textContent = d.version || '—';
    document.getElementById('tool-count').textContent = d.toolCount ?? '—';

    startTime = startTime ?? (Date.now() - (d.uptimeMs ?? 0));
    sessionStart = sessionStart ?? d.startedAt ?? null;
    document.getElementById('uptime').textContent = 'up ' + fmtUptime(Date.now() - startTime);

    const lspEl = document.getElementById('lsp-status');
    if (d.lspReady) {
      lspEl.innerHTML = dot('green') + ' ready';
    } else {
      lspEl.innerHTML = dot('yellow') + ' warming up';
    }

    const cliEl = document.getElementById('cli-status');
    if (d.posCliFound) {
      cliEl.innerHTML = dot('green') + ' found';
    } else {
      cliEl.innerHTML = dot('red') + ' not found';
    }
  } catch {}
}

async function fetchTools() {
  if (toolsLoaded) return;
  try {
    const r = await fetch(BASE + '/tools');
    const d = await r.json();
    const tools = d.tools || [];
    const el = document.getElementById('tool-list');
    if (tools.length === 0) { el.innerHTML = '<span class="empty">none</span>'; return; }
    el.innerHTML = tools.map(t =>
      '<div class="tool-chip" title="' + escHtml(t.description?.split('\\n')[0] || '') + '">' + escHtml(t.name) + '</div>'
    ).join('');
    toolsLoaded = true;

    const ind = document.getElementById('tools-refresh');
    ind.classList.add('show');
    setTimeout(() => ind.classList.remove('show'), 600);
  } catch {}
}

async function fetchLogs() {
  try {
    const r = await fetch(BASE + '/api/logs?limit=100');
    const d = await r.json();
    // Only show entries from the current server session to avoid stale history
    const all = d.entries || [];
    const entries = (sessionStart
      ? all.filter(e => e.ts >= sessionStart)
      : all
    ).slice(-50).reverse();

    const tbody = document.getElementById('activity-body');
    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty" style="padding:12px 8px">no activity yet</td></tr>';
      return;
    }

    tbody.innerHTML = entries.map(e => {
      let eventCell = '<span class="badge info">' + escHtml(e.event || '') + '</span>';
      let detail = '';
      let duration = '';
      let status = '';

      if (e.event === 'tool_call') {
        eventCell = escHtml(e.tool || '');
        duration = '<span class="duration">' + fmtDuration(e.durationMs) + '</span>';
        if (e.success === false) {
          status = '<span class="badge error">error</span>';
        } else {
          status = '<span class="badge ok">ok</span>';
        }
        if (e.error) detail = '<span class="truncate" style="color:var(--red)">' + escHtml(String(e.error).slice(0, 80)) + '</span>';
      } else if (e.event === 'lsp_ready') {
        eventCell = '<span class="badge info">lsp_ready</span>';
        duration = '<span class="duration">' + fmtDuration(e.durationMs) + '</span>';
      } else if (e.event === 'lsp_crash') {
        eventCell = '<span class="badge error">lsp_crash</span>';
        detail = 'restart #' + (e.restartCount ?? '');
      } else if (e.event === 'server_start') {
        eventCell = '<span class="badge info">server_start</span>';
        detail = escHtml(e.projectDir || '');
      } else if (e.event === 'log') {
        eventCell = '<span style="color:var(--muted)">log</span>';
        detail = '<span class="truncate" style="color:var(--muted)">' + escHtml((e.message || '').slice(0, 100)) + '</span>';
      }

      return '<tr class="event-row">'
        + '<td class="ts">' + fmtTime(e.ts) + '</td>'
        + '<td>' + eventCell + '</td>'
        + '<td>' + detail + '</td>'
        + '<td>' + duration + '</td>'
        + '<td>' + status + '</td>'
        + '</tr>';
    }).join('');

    const ind = document.getElementById('activity-refresh');
    ind.classList.add('show');
    setTimeout(() => ind.classList.remove('show'), 400);
  } catch {}
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function refresh() {
  await Promise.all([fetchStatus(), fetchLogs(), fetchTools()]);
}

// Update uptime counter every second
setInterval(() => {
  if (startTime) {
    document.getElementById('uptime').textContent = 'up ' + fmtUptime(Date.now() - startTime);
  }
}, 1000);

// Full refresh every 3 seconds
setInterval(refresh, 3000);

// Initial load
refresh();
</script>
</body>
</html>`;
}
