/**
 * Dashboard HTML for the pos-supervisor HTTP server.
 * Served at GET /dashboard.
 *
 * Features:
 *  - Real-time via SSE (no polling for activity)
 *  - Timeline strip: visual tool call sequence with duration as width
 *  - File validation map: per-file error state grid
 *  - Compliance checklist: workflow health at a glance
 *  - Activity table: file_path + error/warning counts in detail column
 *  - Stats, Playground, Knowledge browser, LSP controls
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
    --surface2: #1c2128;
    --border: #21262d;
    --text: #c9d1d9;
    --muted: #8b949e;
    --green: #3fb950;
    --red: #f85149;
    --blue: #58a6ff;
    --yellow: #d29922;
    --purple: #bc8cff;
    --orange: #ffa657;
    --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--mono); font-size: 13px; min-height: 100vh; }
  a { color: var(--blue); text-decoration: none; }
  button { cursor: pointer; font-family: var(--mono); font-size: 12px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface2); color: var(--text); padding: 5px 12px; transition: background .15s; }
  button:hover { background: var(--surface); border-color: var(--muted); }
  button.primary { background: #1a4b8c; border-color: var(--blue); color: var(--blue); }
  button.primary:hover { background: #1d5299; }
  button.danger { background: #2d0f0e; border-color: var(--red); color: var(--red); }
  button.danger:hover { background: #3a1512; }
  input, select, textarea { font-family: var(--mono); font-size: 12px; background: var(--surface2); border: 1px solid var(--border); color: var(--text); border-radius: 4px; padding: 5px 8px; outline: none; }
  input:focus, select:focus, textarea:focus { border-color: var(--blue); }
  textarea { resize: vertical; }
  select option { background: var(--surface2); }

  header { border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 15px; font-weight: 600; color: #fff; }
  header .project { color: var(--muted); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header .uptime { color: var(--muted); font-size: 12px; white-space: nowrap; }

  .status-bar { display: flex; gap: 12px; padding: 10px 24px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; }
  .stat-pill { display: flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 12px; border: 1px solid var(--border); font-size: 11px; white-space: nowrap; }
  .stat-pill .label { color: var(--muted); }
  .stat-pill .value { color: var(--text); font-weight: 600; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .dot.green  { background: var(--green);  box-shadow: 0 0 5px var(--green); }
  .dot.red    { background: var(--red); }
  .dot.yellow { background: var(--yellow); animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }

  .live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 5px var(--green); display: inline-block; animation: pulse 2s ease-in-out infinite; }
  .live-dot.off { background: var(--muted); box-shadow: none; animation: none; }

  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); padding: 0 24px; background: var(--surface); }
  .tab { padding: 9px 16px; font-size: 12px; cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s; user-select: none; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--blue); border-bottom-color: var(--blue); }

  .tab-content { display: none; padding: 20px 24px; max-width: 1200px; }
  .tab-content.active { display: block; }

  .cards { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; min-width: 140px; }
  .card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 5px; }
  .card .value { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; }

  section { margin-bottom: 24px; }
  section h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
  .tick { font-size: 10px; color: var(--muted); opacity: 0; transition: opacity .3s; }
  .tick.show { opacity: 1; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: var(--muted); font-size: 11px; font-weight: 500; padding: 4px 8px; border-bottom: 1px solid var(--border); }
  td { padding: 5px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface); }
  tr.row-error td { background: #1a0a0a; }
  tr.row-warn td { background: #1a1400; }
  tr.row-error:hover td { background: #220d0d; }
  tr.row-warn:hover td { background: #221a00; }
  .empty { color: var(--muted); font-size: 12px; padding: 12px 0; }

  .badge { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 11px; font-weight: 600; }
  .badge.ok   { background: #0d2a16; color: var(--green); }
  .badge.error { background: #2d0f0e; color: var(--red); }
  .badge.info { background: #0c1f3a; color: var(--blue); }
  .badge.warn { background: #2a1f0a; color: var(--yellow); }
  .duration { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .ts { color: var(--muted); font-size: 11px; white-space: nowrap; }

  /* ── Timeline ──────────────────────────────────────────────────────── */
  .timeline-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; overflow: hidden; }
  .timeline-strip { display: flex; gap: 2px; align-items: flex-end; height: 36px; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
  .tl-block { border-radius: 2px; min-width: 5px; flex-shrink: 0; cursor: pointer; transition: opacity .12s; position: relative; }
  .tl-block:hover { opacity: .75; }
  .tl-block.tl-validate_code    { background: var(--blue); }
  .tl-block.tl-validate_code.tl-has-errors { background: var(--red); }
  .tl-block.tl-validate_code.tl-has-warnings { background: var(--orange); }
  .tl-block.tl-validate_intent  { background: var(--purple); }
  .tl-block.tl-analyze_project  { background: var(--yellow); }
  .tl-block.tl-scaffold         { background: var(--orange); }
  .tl-block.tl-domain_guide     { background: #2a4a2a; }
  .tl-block.tl-lookup           { background: #2a4a2a; }
  .tl-block.tl-project_map      { background: #2a2a4a; }
  .tl-block.tl-other            { background: var(--surface2); }
  .tl-block.tl-fail             { outline: 1px solid var(--red); }
  .timeline-legend { display: flex; gap: 12px; margin-top: 6px; flex-wrap: wrap; }
  .tl-legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--muted); }
  .tl-legend-dot { width: 8px; height: 8px; border-radius: 1px; flex-shrink: 0; }

  /* ── Compliance checklist ──────────────────────────────────────────── */
  .compliance-grid { display: flex; gap: 8px; flex-wrap: wrap; }
  .compliance-item { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 4px; border: 1px solid var(--border); font-size: 11px; background: var(--surface); }
  .compliance-item.pass { border-color: #1a3a20; background: #0a1e0d; color: var(--green); }
  .compliance-item.fail { border-color: #3a1a1a; background: #1a0a0a; color: var(--muted); }
  .compliance-item.warn { border-color: #3a2a1a; background: #1a1400; color: var(--yellow); }
  .ci-icon { font-size: 12px; }

  /* ── File validation map ───────────────────────────────────────────── */
  .file-map { display: flex; flex-wrap: wrap; gap: 5px; }
  .fm-cell { border: 1px solid var(--border); border-radius: 3px; padding: 3px 7px; font-size: 10px; cursor: default; white-space: nowrap; transition: border-color .15s; }
  .fm-cell.clean  { border-color: #1a3a20; color: var(--green);  background: #0a1e0d; }
  .fm-cell.dirty  { border-color: #3a1a1a; color: var(--red);    background: #1a0a0a; }
  .fm-cell.warned { border-color: #3a2a10; color: var(--orange); background: #1a1400; }
  .fm-cell.fixed  { border-color: #1a3020; color: var(--green);  background: #0a1808; }
  .fm-count { font-size: 9px; opacity: .7; margin-left: 3px; }

  /* ── Plan tracker ──────────────────────────────────────────────────── */
  .plan-box { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 14px; margin-bottom: 12px; }
  .plan-box .plan-id { color: var(--blue); font-size: 12px; margin-bottom: 10px; }
  .plan-files { display: flex; flex-wrap: wrap; gap: 6px; }
  .file-pill { font-size: 11px; padding: 2px 8px; border-radius: 3px; border: 1px solid; }
  .file-pill.pending { border-color: var(--yellow); color: var(--yellow); background: #1a1500; }
  .file-pill.done    { border-color: var(--green);  color: var(--green);  background: #0a1e0d; }

  /* ── Bar charts ────────────────────────────────────────────────────── */
  .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .bar-label { width: 200px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
  .bar-track { flex: 1; height: 10px; background: var(--surface); border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; background: var(--blue); border-radius: 3px; transition: width .4s; }
  .bar-fill.red    { background: var(--red); }
  .bar-fill.orange { background: var(--orange); }
  .bar-count { font-size: 11px; color: var(--muted); width: 30px; text-align: right; }

  /* ── Tool grid ─────────────────────────────────────────────────────── */
  .tool-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .tool-chip { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 5px 10px; font-size: 12px; color: var(--text); cursor: pointer; transition: border-color .15s; }
  .tool-chip:hover { border-color: var(--blue); color: var(--blue); }

  /* ── Activity filter bar ───────────────────────────────────────────── */
  .filter-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .filter-bar input, .filter-bar select { height: 28px; }
  .filter-bar label { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); cursor: pointer; }
  .filter-bar input[type=checkbox] { width: 14px; height: 14px; cursor: pointer; }
  .file-col { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; }

  /* ── Playground ────────────────────────────────────────────────────── */
  .playground { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }
  .tool-selector { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px; height: fit-content; }
  .tool-selector h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 10px; }
  .tool-list-item { padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; color: var(--text); }
  .tool-list-item:hover  { background: var(--surface2); }
  .tool-list-item.active { background: #0c1f3a; color: var(--blue); }
  .playground-editor { display: flex; flex-direction: column; gap: 10px; }
  .playground-editor textarea { min-height: 200px; width: 100%; }
  .playground-result { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
  .playground-result pre { font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; }
  .result-ok pre    { color: var(--green); }
  .result-error pre { color: var(--red); }

  /* ── Knowledge browser ─────────────────────────────────────────────── */
  .knowledge-browser { display: grid; grid-template-columns: 220px 1fr; gap: 14px; }
  .kb-sidebar { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px; height: fit-content; max-height: 600px; overflow-y: auto; }
  .kb-sidebar h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 8px; padding: 0 4px; }
  .kb-item { padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; color: var(--muted); }
  .kb-item:hover  { background: var(--surface2); color: var(--text); }
  .kb-item.active { background: #0c1f3a; color: var(--blue); }
  .kb-content { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 16px; max-height: 600px; overflow-y: auto; }
  .kb-content pre { font-size: 12px; white-space: pre-wrap; color: var(--text); line-height: 1.6; }

  /* ── LSP panel ─────────────────────────────────────────────────────── */
  .lsp-panel { display: flex; flex-direction: column; gap: 16px; }
  .lsp-actions { display: flex; gap: 10px; align-items: center; }
  .lsp-log { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px; max-height: 300px; overflow-y: auto; }
  .lsp-log .lsp-entry { font-size: 11px; color: var(--muted); padding: 2px 0; border-bottom: 1px solid var(--border); }
  .lsp-log .lsp-entry:last-child { border-bottom: none; }
  .lsp-log .lsp-entry.ok  { color: var(--green); }
  .lsp-log .lsp-entry.err { color: var(--red); }

  .truncate { overflow: hidden; text-overflow: ellipsis; max-width: 320px; display: inline-block; vertical-align: bottom; }
  #restart-status { font-size: 12px; }

  /* ── Explorer ───────────────────────────────────────────────────────── */
  .explorer-loading { color: var(--muted); font-size: 12px; padding: 20px 0; }
  .explorer-error { color: var(--red); font-size: 12px; padding: 12px 0; }

  .ex-summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .ex-summary-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; }
  .ex-summary-card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 5px; }
  .ex-summary-card .value { font-size: 20px; font-weight: 600; color: var(--text); }

  .ex-resource { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 16px; overflow: hidden; }
  .ex-resource-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--surface2); }
  .ex-resource-name { font-size: 14px; font-weight: 600; color: #fff; text-transform: capitalize; }
  .ex-resource-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--blue); color: var(--blue); background: #0c1f3a; }
  .ex-resource-body { display: grid; grid-template-columns: repeat(4, 1fr); }
  @media (max-width: 900px) { .ex-resource-body { grid-template-columns: 1fr; } }

  .ex-layer { padding: 14px; border-right: 1px solid var(--border); }
  .ex-layer:last-child { border-right: none; }
  @media (max-width: 900px) { .ex-layer { border-right: none; border-bottom: 1px solid var(--border); } .ex-layer:last-child { border-bottom: none; } }
  .ex-layer-title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 10px; font-weight: 600; }
  .ex-layer-item { font-size: 11px; padding: 4px 8px; border-radius: 3px; border: 1px solid var(--border); margin-bottom: 4px; background: var(--surface2); }
  .ex-prop { display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 3px 8px; border-radius: 3px; border: 1px solid var(--border); margin-bottom: 3px; background: var(--surface2); }
  .ex-prop-name { color: var(--text); }
  .ex-prop-type { color: var(--purple); font-size: 10px; padding: 1px 5px; border-radius: 2px; background: #1a1530; }
  .ex-op-badge { display: inline-block; font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 2px; margin-right: 4px; text-transform: uppercase; }
  .ex-op-query { color: var(--blue); background: #0c1f3a; }
  .ex-op-mutation { color: var(--green); background: #0d2a16; }
  .ex-method-badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 2px; margin-right: 4px; text-transform: uppercase; }
  .ex-method-get    { color: var(--blue);   background: #0c1f3a; }
  .ex-method-post   { color: var(--green);  background: #0d2a16; }
  .ex-method-put    { color: var(--yellow); background: #2a1f0a; }
  .ex-method-delete { color: var(--red);    background: #2d0f0e; }

  .ex-route { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .ex-route:last-child { border-bottom: none; }
  .ex-route:hover { background: var(--surface2); }
  .ex-route-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .ex-route-slug { font-size: 12px; font-weight: 600; color: var(--text); }
  .ex-route-file { font-size: 10px; color: var(--muted); }
  .ex-route-calls { margin-left: 24px; border-left: 2px solid var(--border); padding-left: 12px; margin-top: 4px; }
  .ex-route-call { font-size: 11px; color: var(--muted); padding: 2px 0; display: flex; align-items: center; gap: 6px; }
  .ex-route-call-path { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: var(--surface2); border: 1px solid var(--border); color: var(--text); }
  .ex-static { font-size: 11px; color: var(--muted); font-style: italic; margin-left: 24px; border-left: 2px solid var(--border); padding: 4px 12px; margin-top: 4px; }

  .ex-health-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
  .ex-health-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; }
  .ex-health-card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 5px; }
  .ex-health-card .value { font-size: 22px; font-weight: 600; }
  .ex-health-card.error-card { border-color: #3a1a1a; }
  .ex-health-card.error-card .value { color: var(--red); }
  .ex-health-card.warn-card { border-color: #3a2a10; }
  .ex-health-card.warn-card .value { color: var(--yellow); }
  .ex-health-card.scan-card .value { color: var(--blue); }

  .ex-next-step { background: #0c1f3a; border: 1px solid #1a3a5a; border-radius: 6px; padding: 14px 16px; margin-bottom: 16px; }
  .ex-next-step-title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--blue); margin-bottom: 6px; font-weight: 600; }
  .ex-next-step-text { font-size: 12px; color: var(--text); line-height: 1.6; }

  .ex-health-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
  @media (max-width: 900px) { .ex-health-grid { grid-template-columns: 1fr; } }

  .ex-fix-list { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .ex-fix-header { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--surface2); font-weight: 600; }
  .ex-fix-item { display: flex; align-items: flex-start; justify-content: space-between; padding: 8px 14px; border-bottom: 1px solid var(--border); }
  .ex-fix-item:last-child { border-bottom: none; }
  .ex-fix-item:hover { background: var(--surface2); }
  .ex-fix-rank { font-size: 10px; font-weight: 700; color: #fff; background: var(--surface2); border: 1px solid var(--border); padding: 1px 6px; border-radius: 10px; margin-right: 8px; flex-shrink: 0; }
  .ex-fix-path { font-size: 11px; color: var(--text); word-break: break-all; }
  .ex-fix-reason { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .ex-fix-badges { display: flex; gap: 4px; flex-shrink: 0; margin-left: 8px; }

  .ex-sidebar-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin-bottom: 12px; }
  .ex-sidebar-title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--surface2); font-weight: 600; }
  .ex-sidebar-body { padding: 10px 14px; }
  .ex-dead-item { font-size: 10px; padding: 4px 8px; border-radius: 3px; background: var(--surface2); border: 1px solid var(--border); margin-bottom: 4px; color: var(--muted); word-break: break-all; }
  .ex-integrity-item { background: #1a1400; border: 1px solid #3a2a10; border-radius: 4px; padding: 8px 10px; margin-bottom: 6px; }
  .ex-integrity-item:last-child { margin-bottom: 0; }
  .ex-integrity-type { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--yellow); margin-bottom: 3px; }
  .ex-integrity-msg { font-size: 11px; color: var(--text); }

  .ex-module-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 700px) { .ex-module-grid { grid-template-columns: 1fr; } }
  .ex-module-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text); padding: 8px 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; }
  .ex-module-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--purple); flex-shrink: 0; }
  .ex-asset-item { font-size: 11px; color: var(--muted); padding: 4px 8px; border-radius: 3px; background: var(--surface2); border: 1px solid var(--border); margin-bottom: 3px; }

  .ex-refresh-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .ex-refresh-bar .ts { margin-left: auto; }

  /* ── POS-CLI tab ───────────────────────────────────────────────────── */
  .cli-section { margin-bottom: 24px; }
  .cli-section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .cli-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; }
  .cli-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .cli-card-body { padding: 16px 20px; }
  .cli-desc { font-size: 12px; color: var(--muted); line-height: 1.6; margin-bottom: 14px; }
  .cli-cmd-preview { font-size: 11px; color: var(--blue); background: #0c1f3a; border: 1px solid #1a3a5a; border-radius: 4px; padding: 8px 12px; margin-bottom: 14px; font-family: var(--mono); }
  .cli-caution { display: flex; align-items: flex-start; gap: 8px; background: #1a1400; border: 1px solid #3a2a10; border-radius: 4px; padding: 10px 12px; margin-bottom: 16px; font-size: 11px; color: var(--yellow); line-height: 1.5; }
  .cli-caution-label { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; padding-top: 1px; }
  .cli-action-bar { display: flex; align-items: center; gap: 10px; }
  .cli-env-select { min-width: 160px; height: 30px; }
  .cli-result { margin-top: 14px; border-radius: 4px; overflow: hidden; display: none; }
  .cli-result-banner { padding: 8px 12px; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .cli-result-banner.ok { background: #0d2a16; color: var(--green); border: 1px solid #1a3a20; border-bottom: none; border-radius: 4px 4px 0 0; }
  .cli-result-banner.fail { background: #2d0f0e; color: var(--red); border: 1px solid #3a1a1a; border-bottom: none; border-radius: 4px 4px 0 0; }
  .cli-result-banner.running { background: #0c1f3a; color: var(--blue); border: 1px solid #1a3a5a; border-bottom: none; border-radius: 4px 4px 0 0; animation: pulse 1.5s ease-in-out infinite; }
  .cli-result-output { background: var(--surface2); border: 1px solid var(--border); border-top: none; border-radius: 0 0 4px 4px; padding: 10px 12px; max-height: 300px; overflow-y: auto; }
  .cli-result-output pre { font-size: 11px; white-space: pre-wrap; word-break: break-all; color: var(--text); line-height: 1.5; margin: 0; }
  .cli-result-ts { font-size: 10px; color: var(--muted); font-weight: 400; margin-left: auto; }

  /* ── Tooltip ───────────────────────────────────────────────────────── */
  #tooltip { position: fixed; background: #0d1117; border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; font-size: 11px; color: var(--text); pointer-events: none; z-index: 1000; display: none; max-width: 300px; line-height: 1.5; }
</style>
</head>
<body>
<div id="tooltip"></div>

<header>
  <h1>pos-supervisor</h1>
  <span class="project" id="project-dir">—</span>
  <span class="uptime" id="uptime">—</span>
</header>

<div class="status-bar">
  <div class="stat-pill"><span id="lsp-dot" class="dot yellow"></span><span class="label">LSP</span><span class="value" id="lsp-label">warming up</span></div>
  <div class="stat-pill"><span id="cli-dot" class="dot yellow"></span><span class="label">pos-cli</span><span class="value" id="cli-label">checking</span></div>
  <div class="stat-pill"><span class="label">tools</span><span class="value" id="sb-tools">—</span></div>
  <div class="stat-pill"><span class="label">version</span><span class="value" id="sb-version">—</span></div>
  <div class="stat-pill"><span class="label">calls</span><span class="value" id="sb-calls">0</span></div>
  <div class="stat-pill"><span class="label">errors</span><span class="value" id="sb-errors">0</span></div>
  <div class="stat-pill" style="margin-left:auto"><span class="live-dot off" id="live-dot"></span><span class="label" style="margin-left:4px" id="live-label">connecting</span></div>
</div>

<div class="tabs">
  <div class="tab active" data-tab="overview">Overview</div>
  <div class="tab" data-tab="explorer">Explorer</div>
  <div class="tab" data-tab="routes">Routes</div>
  <div class="tab" data-tab="health">Health</div>
  <div class="tab" data-tab="activity">Activity</div>
  <div class="tab" data-tab="stats">Stats</div>
  <div class="tab" data-tab="playground">Playground</div>
  <div class="tab" data-tab="knowledge">Knowledge</div>
  <div class="tab" data-tab="pos-cli">POS-CLI</div>
  <div class="tab" data-tab="lsp">LSP</div>
</div>

<!-- ── Overview ────────────────────────────────────────────────────── -->
<div class="tab-content active" id="tab-overview">

  <section>
    <h2>Session Health</h2>
    <div class="compliance-grid" id="compliance-grid">
      <span class="empty">loading…</span>
    </div>
  </section>

  <section>
    <h2>File Validation Map <span class="tick" id="map-tick">↻</span></h2>
    <div class="file-map" id="file-map"><span class="empty">no files validated yet</span></div>
  </section>

  <section>
    <h2>Pending Plan <span class="tick" id="plan-tick">↻</span></h2>
    <div id="plan-container"><span class="empty">No active plan</span></div>
  </section>

  <section>
    <h2>Error Patterns (this session) <span class="tick" id="checks-tick">↻</span></h2>
    <div id="check-bars"><span class="empty">no validate_code calls yet</span></div>
  </section>

  <section>
    <h2>Tools <span class="tick" id="tools-tick">↻</span></h2>
    <div class="tool-grid" id="tool-list"><span class="empty">loading…</span></div>
  </section>

</div>

<!-- ── Explorer ─────────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-explorer">
  <div class="ex-refresh-bar">
    <button id="ex-refresh-btn">Refresh</button>
    <span class="ts" id="ex-last-fetched"></span>
  </div>
  <div id="ex-summary"></div>
  <div id="ex-resources"><span class="explorer-loading">Click Refresh or switch to this tab to load project data.</span></div>
</div>

<!-- ── Routes ──────────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-routes">
  <div class="ex-refresh-bar">
    <button id="rt-refresh-btn">Refresh</button>
  </div>
  <div id="rt-body"><span class="explorer-loading">Click Refresh to load route data.</span></div>
</div>

<!-- ── Health ──────────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-health">
  <div class="ex-refresh-bar">
    <button id="ht-refresh-btn">Refresh</button>
    <span class="ts" id="ht-last-fetched"></span>
  </div>
  <div id="ht-body"><span class="explorer-loading">Click Refresh to load project health data.</span></div>
</div>

<!-- ── Activity ─────────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-activity">

  <section>
    <h2>Timeline <span style="font-size:10px;color:var(--muted);text-transform:none;letter-spacing:0" id="tl-count"></span></h2>
    <div class="timeline-wrap">
      <div class="timeline-strip" id="timeline-strip"></div>
      <div class="timeline-legend">
        <span class="tl-legend-item"><span class="tl-legend-dot" style="background:var(--blue)"></span>validate_code ok</span>
        <span class="tl-legend-item"><span class="tl-legend-dot" style="background:var(--orange)"></span>validate_code warn</span>
        <span class="tl-legend-item"><span class="tl-legend-dot" style="background:var(--red)"></span>validate_code error</span>
        <span class="tl-legend-item"><span class="tl-legend-dot" style="background:var(--purple)"></span>validate_intent</span>
        <span class="tl-legend-item"><span class="tl-legend-dot" style="background:var(--yellow)"></span>analyze_project</span>
        <span class="tl-legend-item"><span class="tl-legend-dot" style="background:var(--orange)"></span>scaffold</span>
      </div>
    </div>
  </section>

  <div class="filter-bar">
    <select id="filter-tool"><option value="">All tools</option></select>
    <label><input type="checkbox" id="filter-errors"> errors only</label>
    <input type="text" id="filter-search" placeholder="search file, error…" style="width:200px">
    <span style="margin-left:auto; font-size:11px; color:var(--muted)" id="activity-count"></span>
  </div>
  <table id="activity-table">
    <thead>
      <tr>
        <th>Time</th>
        <th>Tool</th>
        <th>File / Detail</th>
        <th>Issues</th>
        <th>Duration</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody id="activity-body"><tr><td colspan="6" class="empty" style="padding:12px 8px">loading…</td></tr></tbody>
  </table>
</div>

<!-- ── Stats ────────────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-stats">
  <section>
    <h2>Tool Usage</h2>
    <table>
      <thead><tr><th>Tool</th><th>Calls</th><th>Errors</th><th>Avg Duration</th><th>Total</th></tr></thead>
      <tbody id="stats-body"><tr><td colspan="5" class="empty" style="padding:12px 8px">no calls yet</td></tr></tbody>
    </table>
  </section>
  <section>
    <h2>Check Frequency</h2>
    <div id="stats-checks"><span class="empty">no validate_code calls yet</span></div>
  </section>
</div>

<!-- ── Playground ───────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-playground">
  <div class="playground">
    <div class="tool-selector">
      <h3>Select Tool</h3>
      <div id="pg-tool-list"><span class="empty">loading…</span></div>
    </div>
    <div class="playground-editor">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
        <span id="pg-tool-name" style="font-size:13px; font-weight:600; color:var(--blue)">—</span>
        <button class="primary" id="pg-run-btn" disabled>Run</button>
        <button id="pg-format-btn" disabled>Format JSON</button>
      </div>
      <div style="font-size:11px; color:var(--muted); margin-bottom:4px;" id="pg-tool-desc"></div>
      <textarea id="pg-params" placeholder='{"param": "value"}' spellcheck="false"></textarea>
      <div id="pg-result" style="display:none" class="playground-result">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:11px; color:var(--muted);">
          <span id="pg-result-label">Result</span>
          <span id="pg-result-duration"></span>
        </div>
        <pre id="pg-result-pre"></pre>
      </div>
    </div>
  </div>
</div>

<!-- ── Knowledge ────────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-knowledge">
  <div class="knowledge-browser">
    <div class="kb-sidebar">
      <h3>Hints</h3>
      <div id="kb-hint-list"><span class="empty">loading…</span></div>
    </div>
    <div class="kb-content" id="kb-body">
      <pre style="color:var(--muted)">Select a hint to view its content.</pre>
    </div>
  </div>
</div>

<!-- ── POS-CLI ─────────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-pos-cli">

  <div class="cli-section">
    <div class="cli-section-header"><span class="cli-section-title">Data Clean</span></div>
    <div class="cli-card">
      <div class="cli-card-body">
        <div class="cli-desc">Wipes all records and schema definitions from the selected environment. Useful for resetting a dev/staging instance to a clean state before re-deploying.</div>
        <div class="cli-cmd-preview" id="cli-dc-cmd">pos-cli data clean --auto-confirm --include-schema <span id="cli-dc-cmd-env">staging</span></div>
        <div class="cli-caution">
          <span class="cli-caution-label">Caution</span>
          <span>Permanently deletes all database records and schemas. Cannot be undone. Only use on development or staging environments.</span>
        </div>
        <div class="cli-action-bar">
          <select class="cli-env-select" id="cli-dc-env"><option value="">loading envs…</option></select>
          <button class="danger" id="cli-dc-btn" disabled>Run Data Clean</button>
        </div>
        <div class="cli-result" id="cli-dc-result">
          <div class="cli-result-banner" id="cli-dc-banner"><span id="cli-dc-status"></span><span class="cli-result-ts" id="cli-dc-ts"></span></div>
          <div class="cli-result-output"><pre id="cli-dc-pre"></pre></div>
        </div>
      </div>
    </div>
  </div>

  <div class="cli-section">
    <div class="cli-section-header"><span class="cli-section-title">Deploy</span></div>
    <div class="cli-card">
      <div class="cli-card-body">
        <div class="cli-desc">Pushes all local project files to the selected environment. This syncs your app directory, GraphQL, schemas, pages, and assets with the remote instance.</div>
        <div class="cli-cmd-preview" id="cli-dep-cmd">pos-cli deploy <span id="cli-dep-cmd-env">staging</span></div>
        <div class="cli-caution">
          <span class="cli-caution-label">Caution</span>
          <span>Overwrites remote files with local versions. Verify your local state is correct before deploying. Consider running validation first.</span>
        </div>
        <div class="cli-action-bar">
          <select class="cli-env-select" id="cli-dep-env"><option value="">loading envs…</option></select>
          <button class="primary" id="cli-dep-btn" disabled>Run Deploy</button>
        </div>
        <div class="cli-result" id="cli-dep-result">
          <div class="cli-result-banner" id="cli-dep-banner"><span id="cli-dep-status"></span><span class="cli-result-ts" id="cli-dep-ts"></span></div>
          <div class="cli-result-output"><pre id="cli-dep-pre"></pre></div>
        </div>
      </div>
    </div>
  </div>

</div>

<!-- ── LSP ──────────────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-lsp">
  <div class="lsp-panel">
    <section>
      <h2>LSP Process</h2>
      <div class="cards">
        <div class="card">
          <div class="label">Status</div>
          <div class="value" id="lsp-status-card"><span class="dot yellow"></span> initialising</div>
        </div>
        <div class="card">
          <div class="label">pos-cli</div>
          <div class="value" id="cli-status-card"><span class="dot yellow"></span> checking</div>
        </div>
      </div>
      <div class="lsp-actions">
        <button class="danger" id="lsp-restart-btn">Restart LSP</button>
        <span id="restart-status"></span>
      </div>
    </section>
    <section>
      <h2>LSP Events (this session)</h2>
      <div class="lsp-log" id="lsp-log"><span class="empty lsp-entry">no events yet</span></div>
    </section>
  </div>
</div>

<script>
const BASE = '';
let toolsLoaded = false;
let toolSchemas  = [];
let allLogEntries = [];   // historical (from /api/logs)
let liveEntries  = [];    // real-time (from SSE)
let startTime    = null;
let sessionStart = null;
let activeTab    = localStorage.getItem('pos-dash-tab') || 'overview';
let lastStatus   = null;

// ── Tooltip ─────────────────────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');
function showTip(e, html) {
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  moveTip(e);
}
function moveTip(e) {
  let x = e.clientX + 12, y = e.clientY + 12;
  if (x + 300 > window.innerWidth) x = e.clientX - 12 - tooltip.offsetWidth;
  if (y + 100 > window.innerHeight) y = e.clientY - 12 - tooltip.offsetHeight;
  tooltip.style.left = x + 'px';
  tooltip.style.top  = y + 'px';
}
function hideTip() { tooltip.style.display = 'none'; }
document.addEventListener('mousemove', moveTip);

// ── Tab switching ────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      const name = t.dataset.tab;
      localStorage.setItem('pos-dash-tab', name);
      activeTab = name;
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
      if (name === 'playground' && !toolsLoaded) fetchTools();
      if (name === 'knowledge') fetchHints();
      if ((name === 'explorer' || name === 'routes') && !explorerLoaded) fetchExplorerData();
      if (name === 'health' && !analysisLoaded) fetchAnalysisData();
      if (name === 'pos-cli' && !cliEnvsLoaded) fetchCliEnvs();
    });
  });
  const saved = document.querySelector('.tab[data-tab="' + activeTab + '"]');
  if (saved && activeTab !== 'overview') saved.click();
}

// ── Utilities ────────────────────────────────────────────────────────────
function fmtDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}
function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
}
function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + 'm ' + r + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function dot(color) { return '<span class="dot ' + color + '"></span>'; }
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function firstDescLine(desc) {
  if (!desc) return '';
  for (const line of desc.split('\\n')) {
    const t = line.trim();
    if (t && !/^[A-Z ]+:$/.test(t)) return t;
  }
  return desc.split('\\n')[0]?.trim() || '';
}
function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 500);
}
function shortPath(p) {
  if (!p) return '';
  // Show last 2 segments: partials/notes/card.liquid → notes/card.liquid
  const parts = p.replace(/\\\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

// ── SSE connection ───────────────────────────────────────────────────────
function initSse() {
  const liveDot   = document.getElementById('live-dot');
  const liveLabel = document.getElementById('live-label');

  function connect() {
    const es = new EventSource(BASE + '/api/events');

    es.addEventListener('message', (e) => {
      try {
        const entry = JSON.parse(e.data);
        if (entry.type === 'connected') return;
        liveEntries.push(entry);
        if (liveEntries.length > 500) liveEntries.shift();

        if (entry.event === 'tool_call') {
          renderActivityFromLive();
          renderTimeline();
          // Also refresh status for stats/plan on interesting calls
          const important = ['validate_code','validate_intent','analyze_project','scaffold'];
          if (important.includes(entry.tool)) fetchStatus();
        } else if (['lsp_ready','lsp_crash','lsp_init_failed','lsp_warmed_up'].includes(entry.event)) {
          fetchStatus();
          renderLspLog();
        }
      } catch {}
    });

    es.addEventListener('open', () => {
      liveDot.className   = 'live-dot';
      liveLabel.textContent = 'live';
    });

    es.addEventListener('error', () => {
      liveDot.className   = 'live-dot off';
      liveLabel.textContent = 'reconnecting';
      es.close();
      setTimeout(connect, 3000);
    });
  }

  connect();
}

// ── Status polling (for stats / plan / compliance) ───────────────────────
async function fetchStatus() {
  try {
    const r = await fetch(BASE + '/api/status');
    const d = await r.json();
    lastStatus = d;

    document.getElementById('project-dir').textContent = d.projectDir || '—';
    document.getElementById('sb-version').textContent  = d.version    || '—';
    document.getElementById('sb-tools').textContent    = d.toolCount  ?? '—';

    startTime    = startTime    ?? (Date.now() - (d.uptimeMs ?? 0));
    sessionStart = sessionStart ?? d.startedAt ?? null;

    const lspReady = !!d.lspReady;
    document.getElementById('lsp-dot').className   = 'dot ' + (lspReady ? 'green' : 'yellow');
    document.getElementById('lsp-label').textContent = lspReady ? 'ready' : 'warming up';
    document.getElementById('cli-dot').className   = 'dot ' + (d.posCliFound ? 'green' : 'red');
    document.getElementById('cli-label').textContent = d.posCliFound ? 'found' : 'not found';

    document.getElementById('lsp-status-card').innerHTML = dot(lspReady ? 'green' : 'yellow') + ' ' + (lspReady ? 'ready' : 'warming up');
    document.getElementById('cli-status-card').innerHTML = dot(d.posCliFound ? 'green' : 'red') + ' ' + (d.posCliFound ? 'found' : 'not found');

    const stats = d.stats || {};
    let totalCalls = 0, totalErrors = 0;
    for (const k of Object.keys(stats)) {
      totalCalls  += stats[k].calls  || 0;
      totalErrors += stats[k].errors || 0;
    }
    document.getElementById('sb-calls').textContent = totalCalls;
    const errEl = document.getElementById('sb-errors');
    errEl.textContent  = totalErrors;
    errEl.style.color  = totalErrors > 0 ? 'var(--red)' : 'var(--muted)';

    renderStatsTable(stats);
    renderCheckFrequency(d.checkFrequency || {});
    renderCheckBars(d.checkFrequency || {});
    renderPlan(d.plan);
    renderCompliance(d);
    renderFileMap(d.fileHistory || []);

    flash('plan-tick');
    flash('map-tick');
  } catch {}
}

// ── Bootstrap: load historical logs, then switch to SSE ─────────────────
async function fetchInitialLogs() {
  try {
    const r = await fetch(BASE + '/api/logs?limit=200');
    const d = await r.json();
    const all = d.entries || [];
    allLogEntries = sessionStart ? all.filter(e => e.ts >= sessionStart) : all;
    renderActivityFromAll();
    renderTimeline();
  } catch {}
}

// ── Compliance checklist ─────────────────────────────────────────────────
function renderCompliance(d) {
  const el = document.getElementById('compliance-grid');
  if (!el) return;
  const stats = d.stats || {};

  const items = [
    {
      label: 'LSP ready',
      pass: !!d.lspReady,
      icon: d.lspReady ? '●' : '○',
    },
    {
      label: 'pos-cli found',
      pass: !!d.posCliFound,
      icon: d.posCliFound ? '●' : '○',
    },
    {
      label: 'validate_intent called',
      pass: (stats.validate_intent?.calls || 0) > 0,
      icon: (stats.validate_intent?.calls || 0) > 0 ? '●' : '○',
      detail: stats.validate_intent?.calls ? stats.validate_intent.calls + 'x' : null,
    },
    {
      label: 'validate_code used',
      pass: (stats.validate_code?.calls || 0) > 0,
      icon: (stats.validate_code?.calls || 0) > 0 ? '●' : '○',
      detail: stats.validate_code?.calls ? stats.validate_code.calls + ' calls' : null,
    },
    {
      label: 'analyze_project run',
      pass: (stats.analyze_project?.calls || 0) > 0,
      warn: false,
      icon: (stats.analyze_project?.calls || 0) > 0 ? '●' : '○',
    },
  ];

  // Manual plan progress (pendingFiles = ALL planned files; validatedFiles ⊆ pendingFiles)
  if (d.plan && d.plan.source === 'manual') {
    const total = d.plan.pendingFiles?.length || 0;
    const done  = d.plan.validatedFiles?.length || 0;
    items.push({
      label: 'manual files validated',
      pass: done === total && total > 0,
      warn: done < total && done > 0,
      icon: done === total ? '●' : '◑',
      detail: done + '/' + total,
    });
  }

  el.innerHTML = items.map(item => {
    const cls = item.pass ? 'pass' : (item.warn ? 'warn' : 'fail');
    const detail = item.detail ? ' <span style="opacity:.6">(' + escHtml(item.detail) + ')</span>' : '';
    return '<div class="compliance-item ' + cls + '">'
      + '<span class="ci-icon">' + item.icon + '</span>'
      + escHtml(item.label) + detail
      + '</div>';
  }).join('');
}

// ── File validation map ──────────────────────────────────────────────────
function renderFileMap(fileHistory) {
  const el = document.getElementById('file-map');
  if (!el) return;
  if (!fileHistory.length) {
    el.innerHTML = '<span class="empty">no files validated yet</span>';
    return;
  }
  const sorted = [...fileHistory].sort((a, b) => {
    // dirty first, then warned, then fixed/clean by call count descending
    if (a.lastErrorCount > 0 && b.lastErrorCount === 0) return -1;
    if (a.lastErrorCount === 0 && b.lastErrorCount > 0) return 1;
    const aw = a.lastWarningCount || 0, bw = b.lastWarningCount || 0;
    if (aw > 0 && bw === 0) return -1;
    if (aw === 0 && bw > 0) return 1;
    return b.calls - a.calls;
  });
  el.innerHTML = sorted.map(f => {
    const warns = f.lastWarningCount || 0;
    const cls   = f.lastErrorCount > 0 ? 'dirty'
                : warns > 0            ? 'warned'
                : f.calls > 1          ? 'fixed'
                : 'clean';
    const label = shortPath(f.path);
    const titleParts = [f.path, 'calls: ' + f.calls];
    if (f.lastErrorCount) titleParts.push('errors: ' + f.lastErrorCount);
    if (warns)            titleParts.push('warnings: ' + warns);
    if (!f.lastErrorCount && !warns) titleParts.push('clean');
    const title = titleParts.join('\\n');
    return '<div class="fm-cell ' + cls + '" title="' + escHtml(title) + '">'
      + escHtml(label)
      + (f.calls > 1 ? '<span class="fm-count">×' + f.calls + '</span>' : '')
      + '</div>';
  }).join('');
}

// ── Timeline ─────────────────────────────────────────────────────────────
function renderTimeline() {
  const strip = document.getElementById('timeline-strip');
  if (!strip) return;

  // Merge historical + live, keep tool_call only, deduplicate by ts
  const seen = new Set();
  const entries = [...allLogEntries, ...liveEntries]
    .filter(e => {
      if (e.event !== 'tool_call') return false;
      if (seen.has(e.ts + e.tool)) return false;
      seen.add(e.ts + e.tool);
      return true;
    })
    .sort((a, b) => (a.ts > b.ts ? 1 : -1));

  const tlCount = document.getElementById('tl-count');
  if (tlCount) tlCount.textContent = '— ' + entries.length + ' calls';

  if (entries.length === 0) {
    strip.innerHTML = '<span style="color:var(--muted);font-size:11px;padding:4px">no tool calls yet</span>';
    return;
  }

  const maxMs  = Math.max(...entries.map(e => e.durationMs || 1));
  const minH   = 8;
  const maxH   = 34;

  strip.innerHTML = entries.map((e, i) => {
    const ms    = e.durationMs || 1;
    const h     = Math.max(minH, Math.round((Math.log(ms + 1) / Math.log(maxMs + 1)) * maxH));
    const w     = Math.max(5, Math.round(Math.log(ms + 1) * 2));

    let cls = 'tl-block tl-' + (e.tool || 'other');
    if (e.tool === 'validate_code') {
      if ((e.error_count || 0) > 0)        cls += ' tl-has-errors';
      else if ((e.warning_count || 0) > 0) cls += ' tl-has-warnings';
    }
    if (e.success === false) cls += ' tl-fail';

    const tipLines = [
      '#' + (i + 1) + ' ' + (e.tool || '?'),
      fmtTime(e.ts) + (e.durationMs ? ' · ' + fmtDuration(e.durationMs) : ''),
      e.file_path ? shortPath(e.file_path) : '',
      e.error_count   ? e.error_count   + ' error(s)'   : '',
      e.warning_count ? e.warning_count + ' warning(s)' : '',
      e.model         ? 'model: ' + e.model             : '',
      e.file_count    ? e.file_count    + ' files'       : '',
      e.success === false ? '✗ failed' + (e.error ? ': ' + e.error.slice(0,50) : '') : '',
    ].filter(Boolean).join('\\n');

    return '<div class="' + cls + '" style="width:' + w + 'px;height:' + h + 'px"'
      + ' onmouseenter="showTip(event, \`' + escHtml(tipLines).replace(/\\n/g,'<br>') + '\`)"'
      + ' onmouseleave="hideTip()"></div>';
  }).join('');

  // Auto-scroll to end
  strip.scrollLeft = strip.scrollWidth;
}

// ── Activity table ───────────────────────────────────────────────────────
function mergedEntries() {
  const seen = new Set();
  return [...allLogEntries, ...liveEntries]
    .filter(e => {
      const key = e.ts + (e.event || '') + (e.tool || '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.ts > b.ts ? 1 : -1));
}

function renderActivityFromAll()  { renderActivity(mergedEntries()); }
function renderActivityFromLive() { renderActivity(mergedEntries()); }

function renderActivity(source) {
  const entries = source ?? mergedEntries();
  const toolFilter = document.getElementById('filter-tool')?.value  || '';
  const errOnly    = document.getElementById('filter-errors')?.checked;
  const search     = (document.getElementById('filter-search')?.value || '').toLowerCase();

  let rows = [...entries].reverse();

  if (toolFilter) rows = rows.filter(e => e.tool === toolFilter);
  if (errOnly)    rows = rows.filter(e => e.success === false || (e.error_count || 0) > 0
                                       || e.event === 'lsp_crash' || e.event === 'lsp_init_failed');
  if (search)     rows = rows.filter(e => JSON.stringify(e).toLowerCase().includes(search));

  const tbody = document.getElementById('activity-body');
  const count = document.getElementById('activity-count');
  if (count) count.textContent = rows.length + ' entries';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty" style="padding:12px 8px">no matching activity</td></tr>';
    return;
  }

  tbody.innerHTML = rows.slice(0, 80).map(e => {
    let toolCell = '<span class="badge info">' + escHtml(e.event || '') + '</span>';
    let fileCell = '', issueCell = '', durationCell = '', statusCell = '';
    let rowCls = '';

    if (e.event === 'tool_call') {
      toolCell = escHtml(e.tool || '');
      durationCell = '<span class="duration">' + fmtDuration(e.durationMs) + '</span>';

      if (e.success === false) {
        statusCell = '<span class="badge error">error</span>';
        rowCls = 'row-error';
        fileCell = e.error ? '<span class="truncate" style="color:var(--red)">' + escHtml(String(e.error).slice(0,80)) + '</span>' : '';
      } else {
        statusCell = '<span class="badge ok">ok</span>';
      }

      if (e.file_path) {
        fileCell = '<span class="file-col" title="' + escHtml(e.file_path) + '">' + escHtml(shortPath(e.file_path)) + '</span>';
      } else if (e.model) {
        fileCell = '<span style="color:var(--muted);font-size:11px">model: ' + escHtml(e.model) + '</span>';
      } else if (e.file_count != null) {
        fileCell = '<span style="color:var(--muted);font-size:11px">' + e.file_count + ' files</span>';
      }

      const errs  = e.error_count   || 0;
      const warns = e.warning_count || 0;
      if (errs > 0) {
        rowCls = 'row-error';
        issueCell = '<span class="badge error">' + errs + 'E</span>';
        if (warns > 0) issueCell += ' <span class="badge warn">' + warns + 'W</span>';
      } else if (warns > 0) {
        rowCls = rowCls || 'row-warn';
        issueCell = '<span class="badge warn">' + warns + 'W</span>';
      }

    } else if (e.event === 'lsp_ready' || e.event === 'lsp_warmed_up') {
      durationCell  = '<span class="duration">' + fmtDuration(e.durationMs) + '</span>';
      statusCell    = '<span class="badge ok">ok</span>';
    } else if (e.event === 'lsp_crash') {
      toolCell    = '<span class="badge error">lsp_crash</span>';
      fileCell    = 'restart #' + (e.restartCount ?? '');
      statusCell  = '<span class="badge error">fail</span>';
      rowCls      = 'row-error';
    } else if (e.event === 'server_start') {
      fileCell = '<span style="color:var(--muted);font-size:11px">' + escHtml(e.projectDir || '') + '</span>';
    } else if (e.event === 'log') {
      toolCell = '<span style="color:var(--muted)">log</span>';
      fileCell = '<span class="truncate" style="color:var(--muted)">' + escHtml((e.message || '').slice(0,100)) + '</span>';
    }

    return '<tr class="' + rowCls + '">'
      + '<td class="ts">' + fmtTime(e.ts) + '</td>'
      + '<td>' + toolCell + '</td>'
      + '<td>' + fileCell + '</td>'
      + '<td>' + issueCell + '</td>'
      + '<td>' + durationCell + '</td>'
      + '<td>' + statusCell + '</td>'
      + '</tr>';
  }).join('');

  renderLspLog();
}

// ── Plan tracker ──────────────────────────────────────────────────────────
function renderPlan(plan) {
  const el = document.getElementById('plan-container');
  if (!plan) { el.innerHTML = '<span class="empty">No active plan</span>'; return; }

  const allFiles    = plan.pendingFiles   || [];
  const validated   = plan.validatedFiles || [];
  const validatedSet = new Set(validated);
  // True pending = planned but not yet validated (pendingFiles is the full set, never shrinks)
  const pending     = allFiles.filter(f => !validatedSet.has(f));
  const isScaffold  = plan.source === 'scaffold';

  const pills = isScaffold
    ? allFiles.map(f => '<span class="file-pill done" title="scaffold — valid by construction">⬡ ' + escHtml(shortPath(f)) + '</span>').join('')
    : [
        ...pending.map(f   => '<span class="file-pill pending" title="needs validate_code">◌ ' + escHtml(shortPath(f)) + '</span>'),
        ...validated.map(f => '<span class="file-pill done"    title="validated">✓ ' + escHtml(shortPath(f)) + '</span>'),
      ].join('');

  const sourceLabel = isScaffold ? 'scaffold' : 'manual';
  const summary     = isScaffold
    ? allFiles.length + ' scaffold files'
    : validated.length + '/' + allFiles.length + ' manually validated';

  el.innerHTML = '<div class="plan-box"><div class="plan-id">Plan: '
    + escHtml(plan.planId || '(unnamed)') + ' [' + sourceLabel + '] — ' + summary
    + '</div><div class="plan-files">' + pills + '</div></div>';
}

// ── Stats tab ─────────────────────────────────────────────────────────────
function renderStatsTable(stats) {
  const tbody = document.getElementById('stats-body');
  const rows  = Object.entries(stats).sort((a, b) => b[1].calls - a[1].calls);
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty" style="padding:12px 8px">no calls yet</td></tr>'; return; }
  tbody.innerHTML = rows.map(([tool, s]) => {
    const avg      = s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0;
    const errColor = s.errors > 0 ? 'color:var(--red)' : '';
    return '<tr>'
      + '<td>' + escHtml(tool) + '</td>'
      + '<td>' + s.calls + '</td>'
      + '<td style="' + errColor + '">' + s.errors + '</td>'
      + '<td class="duration">' + fmtDuration(avg) + '</td>'
      + '<td class="duration">' + fmtDuration(s.totalMs) + '</td>'
      + '</tr>';
  }).join('');
}

function renderCheckFrequency(freq) {
  const el      = document.getElementById('stats-checks');
  const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { el.innerHTML = '<span class="empty">no validate_code calls yet</span>'; return; }
  const max = entries[0][1];
  el.innerHTML = entries.map(([check, count]) =>
    '<div class="bar-row">'
    + '<div class="bar-label">' + escHtml(check) + '</div>'
    + '<div class="bar-track"><div class="bar-fill" style="width:' + (count / max * 100).toFixed(1) + '%"></div></div>'
    + '<div class="bar-count">' + count + '</div>'
    + '</div>'
  ).join('');
}

function renderCheckBars(freq) {
  const el      = document.getElementById('check-bars');
  const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) { el.innerHTML = '<span class="empty">no validate_code calls yet</span>'; return; }
  const max = entries[0][1];
  el.innerHTML = entries.map(([check, count]) =>
    '<div class="bar-row">'
    + '<div class="bar-label">' + escHtml(check) + '</div>'
    + '<div class="bar-track"><div class="bar-fill red" style="width:' + (count / max * 100).toFixed(1) + '%"></div></div>'
    + '<div class="bar-count">' + count + '</div>'
    + '</div>'
  ).join('');
  flash('checks-tick');
}

// ── LSP event log ─────────────────────────────────────────────────────────
function renderLspLog() {
  const lspEvents = ['lsp_ready','lsp_warmed_up','lsp_crash','lsp_init_failed','lsp_restart_requested','lsp_restart_failed'];
  const entries   = mergedEntries().filter(e => lspEvents.includes(e.event)).reverse().slice(0, 30);
  const el        = document.getElementById('lsp-log');
  if (!el) return;
  if (!entries.length) { el.innerHTML = '<span class="empty lsp-entry">no events yet</span>'; return; }
  el.innerHTML = entries.map(e => {
    const cls    = (e.event.includes('failed') || e.event.includes('crash')) ? 'err' : 'ok';
    const detail = e.durationMs ? ' (' + fmtDuration(e.durationMs) + ')' : (e.error ? ': ' + e.error : '');
    return '<div class="lsp-entry ' + cls + '">'
      + fmtTime(e.ts) + ' ' + escHtml(e.event) + escHtml(detail)
      + '</div>';
  }).join('');
}

// ── Tools list ────────────────────────────────────────────────────────────
async function fetchTools() {
  if (toolsLoaded) return;
  try {
    const r = await fetch(BASE + '/tools');
    const d = await r.json();
    toolSchemas = d.tools || [];

    document.getElementById('tool-list').innerHTML = toolSchemas.length === 0
      ? '<span class="empty">none</span>'
      : toolSchemas.map(t =>
          '<div class="tool-chip" title="' + escHtml(firstDescLine(t.description)) + '" onclick="openPlayground(' + escHtml(JSON.stringify(t.name)) + ')">' + escHtml(t.name) + '</div>'
        ).join('');

    document.getElementById('pg-tool-list').innerHTML = toolSchemas.map(t =>
      '<div class="tool-list-item" id="pg-item-' + escHtml(t.name) + '" onclick="selectPlaygroundTool(' + escHtml(JSON.stringify(t.name)) + ')">' + escHtml(t.name) + '</div>'
    ).join('');

    const sel = document.getElementById('filter-tool');
    toolSchemas.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });

    toolsLoaded = true;
    flash('tools-tick');
  } catch {}
}

// ── Playground ────────────────────────────────────────────────────────────
let pgSelectedTool = null;

function openPlayground(toolName) {
  const tab = document.querySelector('.tab[data-tab="playground"]');
  if (tab) tab.click();
  setTimeout(() => selectPlaygroundTool(toolName), 50);
}

function selectPlaygroundTool(name) {
  pgSelectedTool = name;
  document.querySelectorAll('.tool-list-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('pg-item-' + name);
  if (el) el.classList.add('active');

  const tool = toolSchemas.find(t => t.name === name);
  document.getElementById('pg-tool-name').textContent = name;
  document.getElementById('pg-tool-desc').textContent = firstDescLine(tool?.description);
  document.getElementById('pg-run-btn').disabled    = false;
  document.getElementById('pg-format-btn').disabled = false;

  if (tool?.inputSchema?.properties) {
    const props    = tool.inputSchema.properties;
    const required = tool.inputSchema.required || [];
    const template = {};
    for (const [k, v] of Object.entries(props)) {
      if (required.includes(k) || Object.keys(props).length <= 4) {
        template[k] = v.type === 'string' ? '' : v.type === 'number' ? 0 : v.type === 'boolean' ? false : v.type === 'array' ? [] : {};
      }
    }
    document.getElementById('pg-params').value = JSON.stringify(template, null, 2);
  } else {
    document.getElementById('pg-params').value = '{}';
  }
  document.getElementById('pg-result').style.display = 'none';
}

// ── Knowledge browser ─────────────────────────────────────────────────────
let hintsLoaded = false;

async function fetchHints() {
  if (hintsLoaded) return;
  try {
    const r = await fetch(BASE + '/api/hints');
    const d = await r.json();
    const hints = d.hints || [];
    const list  = document.getElementById('kb-hint-list');
    if (!hints.length) { list.innerHTML = '<span class="empty">none</span>'; return; }
    list.innerHTML = hints.sort().map(h =>
      '<div class="kb-item" id="kb-hint-' + escHtml(h) + '" onclick="loadHint(' + escHtml(JSON.stringify(h)) + ')">' + escHtml(h) + '</div>'
    ).join('');
    hintsLoaded = true;
  } catch {}
}

async function loadHint(name) {
  document.querySelectorAll('.kb-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('kb-hint-' + name);
  if (el) el.classList.add('active');
  const body = document.getElementById('kb-body');
  body.innerHTML = '<pre style="color:var(--muted)">loading…</pre>';
  try {
    const r = await fetch(BASE + '/api/hints?name=' + encodeURIComponent(name));
    const d = await r.json();
    body.innerHTML = '<pre>' + escHtml(d.content || '') + '</pre>';
  } catch (e) {
    body.innerHTML = '<pre style="color:var(--red)">' + escHtml(e.message) + '</pre>';
  }
}

// ── Explorer / Routes / Health ─────────────────────────────────────────────
let explorerData = null;
let analysisData = null;
let explorerLoaded = false;
let analysisLoaded = false;

async function fetchExplorerData() {
  const btn = document.getElementById('ex-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const r = await fetch(BASE + '/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'project_map', params: { scope: 'full' } }),
    });
    const d = await r.json();
    explorerData = d.result;
    explorerLoaded = true;
    renderExplorerSummary();
    renderExplorerResources();
    renderRoutes();
    const ts = document.getElementById('ex-last-fetched');
    if (ts) ts.textContent = 'fetched ' + fmtTime(new Date().toISOString());
  } catch (e) {
    document.getElementById('ex-resources').innerHTML = '<span class="explorer-error">Failed to load: ' + escHtml(e.message) + '</span>';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Refresh'; }
}

async function fetchAnalysisData() {
  const btn = document.getElementById('ht-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
  try {
    const r = await fetch(BASE + '/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'analyze_project', params: {} }),
    });
    const d = await r.json();
    analysisData = d.result;
    analysisLoaded = true;
    renderHealth();
    const ts = document.getElementById('ht-last-fetched');
    if (ts) ts.textContent = 'fetched ' + fmtTime(new Date().toISOString());
  } catch (e) {
    document.getElementById('ht-body').innerHTML = '<span class="explorer-error">Failed to load: ' + escHtml(e.message) + '</span>';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Refresh'; }
}

function renderExplorerSummary() {
  const el = document.getElementById('ex-summary');
  if (!el || !explorerData) return;
  const fc = explorerData.summary?.file_counts || {};
  const items = [
    { label: 'Schemas', value: fc.schema || 0 },
    { label: 'GraphQL', value: fc.graphql || 0 },
    { label: 'Pages', value: fc.pages || 0 },
    { label: 'Partials', value: fc.partials || 0 },
    { label: 'Commands', value: fc.commands || 0 },
    { label: 'Queries', value: fc.queries || 0 },
    { label: 'Layouts', value: fc.layouts || 0 },
    { label: 'Assets', value: fc.assets || 0 },
  ];
  el.innerHTML = '<div class="ex-summary-grid">'
    + items.map(i => '<div class="ex-summary-card"><div class="label">' + escHtml(i.label) + '</div><div class="value">' + i.value + '</div></div>').join('')
    + '</div>';
}

function renderExplorerResources() {
  const el = document.getElementById('ex-resources');
  if (!el || !explorerData) return;
  const resources = explorerData.summary?.resources || {};
  if (!Object.keys(resources).length) {
    el.innerHTML = '<span class="empty">No resources detected in project.</span>';
    return;
  }
  el.innerHTML = Object.entries(resources).map(([name, data]) => {
    const schema = explorerData.schema?.[name];
    const propsHtml = (schema?.properties || []).map(p =>
      '<div class="ex-prop"><span class="ex-prop-name">' + escHtml(p.name) + '</span><span class="ex-prop-type">' + escHtml(p.type) + '</span></div>'
    ).join('') || '<span class="empty">no properties</span>';

    const gqlHtml = (data.graphql || []).map(g => {
      const op = explorerData.graphql?.[g];
      const opCls = op?.operation === 'query' ? 'ex-op-query' : 'ex-op-mutation';
      const opLabel = op?.operation === 'query' ? 'Q' : 'M';
      return '<div class="ex-layer-item"><span class="ex-op-badge ' + opCls + '">' + opLabel + '</span>' + escHtml(g.split('/').pop()) + '</div>';
    }).join('') || '<span class="empty">none</span>';

    const cmdHtml = (data.commands || []).map(c =>
      '<div class="ex-layer-item" style="border-color:#3a2a10;color:var(--orange)">' + escHtml(c.split('/').pop()) + '</div>'
    ).join('');
    const qryHtml = (data.queries || []).map(q =>
      '<div class="ex-layer-item" style="border-color:#0c1f3a;color:var(--blue)">' + escHtml(q.split('/').pop()) + '</div>'
    ).join('');
    const logicHtml = (cmdHtml || qryHtml)
      ? (cmdHtml ? '<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">COMMANDS</div>' + cmdHtml + '</div>' : '')
        + (qryHtml ? '<div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">QUERIES</div>' + qryHtml + '</div>' : '')
      : '<span class="empty">none</span>';

    const pagesHtml = (data.pages || []).map(p => {
      const pageInfo = explorerData.pages?.[p];
      if (!pageInfo) return '';
      const m = (pageInfo.method || 'get').toLowerCase();
      return '<div class="ex-layer-item" style="display:flex;align-items:center;gap:4px">'
        + '<span class="ex-method-badge ex-method-' + m + '">' + escHtml(m) + '</span>'
        + '<span style="font-size:10px;color:var(--text)">/' + escHtml(pageInfo.slug || '') + '</span>'
        + '</div>';
    }).join('') || '<span class="empty">none</span>';

    const missingHtml = (data.missing || []).length > 0
      ? '<div style="margin-top:8px;padding:6px 10px;border-radius:4px;background:#1a0a0a;border:1px solid #3a1a1a;font-size:10px;color:var(--red)">'
        + 'Missing: ' + data.missing.join(', ')
        + '</div>'
      : '';

    return '<div class="ex-resource">'
      + '<div class="ex-resource-header">'
      + '<span class="ex-resource-name">' + escHtml(name) + '</span>'
      + '<span class="ex-resource-badge">Vertical Slice</span>'
      + '</div>'
      + '<div class="ex-resource-body">'
      + '<div class="ex-layer"><div class="ex-layer-title">Schema</div>'
        + '<div class="ex-layer-item" style="font-size:10px;color:var(--muted);margin-bottom:8px">' + escHtml((data.schema || '').split('/').pop()) + '</div>'
        + propsHtml + '</div>'
      + '<div class="ex-layer"><div class="ex-layer-title">GraphQL API</div>' + gqlHtml + '</div>'
      + '<div class="ex-layer"><div class="ex-layer-title">Business Logic</div>' + logicHtml + '</div>'
      + '<div class="ex-layer"><div class="ex-layer-title">Pages</div>' + pagesHtml + missingHtml + '</div>'
      + '</div></div>';
  }).join('');
}

function renderRoutes() {
  const el = document.getElementById('rt-body');
  if (!el || !explorerData) return;
  const pages = explorerData.pages || {};
  const entries = Object.entries(pages);
  if (!entries.length) {
    el.innerHTML = '<span class="empty">No routes found.</span>';
    return;
  }
  el.innerHTML = '<div class="ex-resource" style="overflow:hidden">'
    + '<div class="ex-resource-header"><span class="ex-resource-name">Route &amp; Lifecycle Flow</span></div>'
    + entries.map(([key, page]) => {
        const m = (page.method || 'get').toLowerCase();
        const calls = page.function_calls || [];
        const callsHtml = calls.length > 0
          ? '<div class="ex-route-calls">'
            + calls.map(c => '<div class="ex-route-call">Calls: <span class="ex-route-call-path">' + escHtml(c.path) + '</span></div>').join('')
            + '</div>'
          : '<div class="ex-static">Static render (no logic called)</div>';
        return '<div class="ex-route">'
          + '<div class="ex-route-header">'
          + '<span class="ex-method-badge ex-method-' + m + '">' + escHtml(m) + '</span>'
          + '<span class="ex-route-slug">/' + escHtml(page.slug || '') + '</span>'
          + '<span class="ex-route-file">(' + escHtml((page.path || '').split('/').pop()) + ')</span>'
          + '</div>'
          + callsHtml
          + '</div>';
      }).join('')
    + '</div>';
}

function renderHealth() {
  const el = document.getElementById('ht-body');
  if (!el || !analysisData) return;
  const a = analysisData;

  const statsHtml = '<div class="ex-health-stats">'
    + '<div class="ex-health-card error-card"><div class="label">Total Errors</div><div class="value">' + (a.total_errors ?? 0) + '</div></div>'
    + '<div class="ex-health-card warn-card"><div class="label">Total Warnings</div><div class="value">' + (a.total_warnings ?? 0) + '</div></div>'
    + '<div class="ex-health-card scan-card"><div class="label">Files Scanned</div><div class="value">' + (a.files_scanned ?? 0) + '</div></div>'
    + '</div>';

  const nextStepHtml = a.next_step
    ? '<div class="ex-next-step"><div class="ex-next-step-title">Recommended Next Step</div><div class="ex-next-step-text">' + escHtml(a.next_step) + '</div></div>'
    : '';

  const fixOrder = a.fix_order || [];
  const fixHtml = '<div class="ex-fix-list"><div class="ex-fix-header">Fix Order Priority</div>'
    + (fixOrder.length === 0
      ? '<div style="padding:12px 14px" class="empty">No files with issues.</div>'
      : fixOrder.map((f, i) => {
          const badges = [];
          if (f.errors > 0) badges.push('<span class="badge error">' + f.errors + 'E</span>');
          if (f.warnings > 0) badges.push('<span class="badge warn">' + f.warnings + 'W</span>');
          return '<div class="ex-fix-item">'
            + '<div style="flex:1"><div style="display:flex;align-items:center"><span class="ex-fix-rank">' + (i + 1) + '</span><span class="ex-fix-path">' + escHtml(f.path) + '</span></div>'
            + '<div class="ex-fix-reason">' + escHtml(f.reason || '') + '</div></div>'
            + '<div class="ex-fix-badges">' + badges.join('') + '</div>'
            + '</div>';
        }).join(''))
    + '</div>';

  const deadCode = a.dead_code || [];
  const deadHtml = '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">Dead Code</div><div class="ex-sidebar-body">'
    + (deadCode.length === 0
      ? '<span class="empty">No dead code detected.</span>'
      : deadCode.map(p => '<div class="ex-dead-item">' + escHtml(p) + '</div>').join(''))
    + '</div></div>';

  const integrity = a.integrity || [];
  const integrityHtml = '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">Integrity Issues</div><div class="ex-sidebar-body">'
    + (integrity.length === 0
      ? '<span class="empty">No integrity issues.</span>'
      : integrity.map(issue =>
          '<div class="ex-integrity-item"><div class="ex-integrity-type">' + escHtml(issue.severity || 'warning') + ' / ' + escHtml(issue.type || '') + '</div>'
          + '<div class="ex-integrity-msg">' + escHtml(issue.message || '') + '</div></div>'
        ).join(''))
    + '</div></div>';

  const blockingFiles = a.blocking_files || [];
  const blockingHtml = blockingFiles.length > 0
    ? '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">Blocking Files (' + blockingFiles.length + ')</div><div class="ex-sidebar-body">'
      + blockingFiles.map(f =>
          '<div class="ex-dead-item" style="border-color:#3a1a1a;color:var(--red)">' + escHtml(f.path) + ' <span style="font-size:9px;opacity:.7">' + f.total + ' errors</span></div>'
        ).join('')
      + '</div></div>'
    : '';

  const diffHtml = a.diff_from_last_run
    ? '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">Diff from Last Run</div><div class="ex-sidebar-body">'
      + '<div style="font-size:11px;color:var(--text);line-height:1.8">'
      + 'Error delta: <span style="color:' + (a.diff_from_last_run.error_delta > 0 ? 'var(--red)' : a.diff_from_last_run.error_delta < 0 ? 'var(--green)' : 'var(--muted)') + '">'
      + (a.diff_from_last_run.error_delta > 0 ? '+' : '') + a.diff_from_last_run.error_delta + '</span><br>'
      + 'Warning delta: <span style="color:' + (a.diff_from_last_run.warning_delta > 0 ? 'var(--red)' : a.diff_from_last_run.warning_delta < 0 ? 'var(--green)' : 'var(--muted)') + '">'
      + (a.diff_from_last_run.warning_delta > 0 ? '+' : '') + a.diff_from_last_run.warning_delta + '</span>'
      + '</div></div></div>'
    : '';

  // Also show modules/config if explorer data is loaded
  let modulesHtml = '';
  if (explorerData) {
    const modules = explorerData.project?.modules || [];
    const assets = explorerData.assets || [];
    if (modules.length || assets.length) {
      modulesHtml = '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">Modules &amp; Assets</div><div class="ex-sidebar-body">'
        + '<div class="ex-module-grid" style="margin-bottom:8px">'
        + modules.map(m => '<div class="ex-module-item"><span class="ex-module-dot"></span>' + escHtml(m) + '</div>').join('')
        + '</div>'
        + (assets.length > 0
          ? '<div style="font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Assets</div>'
            + assets.map(a => '<div class="ex-asset-item">' + escHtml(a) + '</div>').join('')
          : '')
        + '</div></div>';
    }
  }

  el.innerHTML = statsHtml + nextStepHtml
    + '<div class="ex-health-grid">'
    + '<div>' + fixHtml + '</div>'
    + '<div>' + deadHtml + integrityHtml + blockingHtml + diffHtml + modulesHtml + '</div>'
    + '</div>';
}

// ── POS-CLI tab ─────────────────────────────────────────────────────────
let cliEnvsLoaded = false;

function updateCmdPreview(envSelectId, cmdEnvSpanId) {
  const env = document.getElementById(envSelectId).value || '…';
  document.getElementById(cmdEnvSpanId).textContent = env;
}

async function fetchCliEnvs() {
  if (cliEnvsLoaded) return;
  try {
    const r = await fetch(BASE + '/api/pos-cli/envs');
    const d = await r.json();
    if (!r.ok || !d.envs) throw new Error(d.error || 'Failed to load envs');
    const envs = d.envs;
    ['cli-dc-env', 'cli-dep-env'].forEach(id => {
      const sel = document.getElementById(id);
      sel.innerHTML = envs.length
        ? envs.map(e => '<option value="' + e + '">' + e + '</option>').join('')
        : '<option value="">no envs found</option>';
    });
    if (envs.length) {
      document.getElementById('cli-dc-btn').disabled = false;
      document.getElementById('cli-dep-btn').disabled = false;
      updateCmdPreview('cli-dc-env', 'cli-dc-cmd-env');
      updateCmdPreview('cli-dep-env', 'cli-dep-cmd-env');
    }
    cliEnvsLoaded = true;
  } catch (e) {
    ['cli-dc-env', 'cli-dep-env'].forEach(id => {
      document.getElementById(id).innerHTML = '<option value="">' + e.message + '</option>';
    });
  }
}

async function runCliCommand(command, envSelectId, btnId, resultId, bannerId, statusId, tsId, preId) {
  const env = document.getElementById(envSelectId).value;
  if (!env) return;
  const btn = document.getElementById(btnId);
  const resultEl = document.getElementById(resultId);
  const bannerEl = document.getElementById(bannerId);
  const statusEl = document.getElementById(statusId);
  const tsEl = document.getElementById(tsId);
  const preEl = document.getElementById(preId);
  const label = command === 'data-clean' ? 'Run Data Clean' : 'Run Deploy';
  const cmdStr = command === 'data-clean'
    ? 'pos-cli data clean --auto-confirm --include-schema ' + env
    : 'pos-cli deploy ' + env;

  btn.disabled = true;
  btn.textContent = 'Running…';
  resultEl.style.display = 'block';
  bannerEl.className = 'cli-result-banner running';
  statusEl.textContent = 'Running: ' + cmdStr;
  tsEl.textContent = '';
  preEl.textContent = '';

  const t0 = Date.now();
  try {
    const r = await fetch(BASE + '/api/pos-cli/' + command, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env }),
    });
    const d = await r.json();
    const dur = fmtDuration(Date.now() - t0);
    tsEl.textContent = fmtTime(Date.now()) + ' (' + dur + ')';
    if (r.ok) {
      bannerEl.className = 'cli-result-banner ok';
      statusEl.textContent = 'Completed successfully';
      const parts = [];
      if (d.output && d.output.trim()) parts.push(d.output.trim());
      if (d.stderr && d.stderr.trim()) parts.push(d.stderr.trim());
      preEl.textContent = parts.length ? parts.join('\\n') : 'Command finished with no output.';
    } else {
      bannerEl.className = 'cli-result-banner fail';
      statusEl.textContent = 'Failed';
      const parts = [d.error || 'Unknown error'];
      if (d.output && d.output.trim()) parts.push('stdout:\\n' + d.output.trim());
      if (d.stderr && d.stderr.trim()) parts.push('stderr:\\n' + d.stderr.trim());
      preEl.textContent = parts.join('\\n\\n');
    }
  } catch (e) {
    const dur = fmtDuration(Date.now() - t0);
    tsEl.textContent = fmtTime(Date.now()) + ' (' + dur + ')';
    bannerEl.className = 'cli-result-banner fail';
    statusEl.textContent = 'Request failed';
    preEl.textContent = e.message;
  }
  btn.disabled = false;
  btn.textContent = label;
}

// ── DOMContentLoaded wiring ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Playground run
  document.getElementById('pg-run-btn').addEventListener('click', async () => {
    if (!pgSelectedTool) return;
    const btn = document.getElementById('pg-run-btn');
    btn.disabled = true; btn.textContent = 'Running…';

    let params = {};
    try { params = JSON.parse(document.getElementById('pg-params').value || '{}'); }
    catch (e) {
      const resultEl = document.getElementById('pg-result');
      resultEl.className = 'playground-result result-error';
      resultEl.style.display = '';
      document.getElementById('pg-result-pre').textContent = 'Invalid JSON: ' + e.message;
      btn.disabled = false; btn.textContent = 'Run';
      return;
    }

    const t0 = Date.now();
    try {
      const r  = await fetch(BASE + '/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: pgSelectedTool, params }),
      });
      const d  = await r.json();
      const resultEl = document.getElementById('pg-result');
      resultEl.className   = 'playground-result ' + (r.ok ? 'result-ok' : 'result-error');
      resultEl.style.display = '';
      document.getElementById('pg-result-label').textContent    = r.ok ? 'Result' : 'Error';
      document.getElementById('pg-result-duration').textContent = fmtDuration(Date.now() - t0);
      document.getElementById('pg-result-pre').textContent      = JSON.stringify(d.result ?? d, null, 2);
    } catch (e) {
      const resultEl = document.getElementById('pg-result');
      resultEl.className = 'playground-result result-error';
      resultEl.style.display = '';
      document.getElementById('pg-result-label').textContent = 'Error';
      document.getElementById('pg-result-pre').textContent   = e.message;
    }
    btn.disabled = false; btn.textContent = 'Run';
    fetchStatus();
  });

  // Playground format
  document.getElementById('pg-format-btn').addEventListener('click', () => {
    try {
      const val = document.getElementById('pg-params').value;
      document.getElementById('pg-params').value = JSON.stringify(JSON.parse(val), null, 2);
    } catch {}
  });

  // Activity filters
  ['filter-tool','filter-errors','filter-search'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input',  renderActivityFromAll);
    if (el) el.addEventListener('change', renderActivityFromAll);
  });

  // LSP restart
  document.getElementById('lsp-restart-btn').addEventListener('click', async () => {
    const btn    = document.getElementById('lsp-restart-btn');
    const status = document.getElementById('restart-status');
    btn.disabled = true;
    status.style.color  = 'var(--yellow)';
    status.textContent  = 'restarting…';
    try {
      const r = await fetch(BASE + '/api/lsp/restart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const d = await r.json();
      if (r.ok) {
        status.style.color = 'var(--green)';
        status.textContent = 'restarted successfully';
        sessionStart = null;
      } else {
        status.style.color = 'var(--red)';
        status.textContent = d.error || 'restart failed';
      }
    } catch (e) {
      status.style.color = 'var(--red)';
      status.textContent = e.message;
    }
    btn.disabled = false;
    setTimeout(() => { status.textContent = ''; }, 4000);
    fetchStatus();
  });

  // Explorer refresh buttons
  document.getElementById('ex-refresh-btn').addEventListener('click', fetchExplorerData);
  document.getElementById('rt-refresh-btn').addEventListener('click', fetchExplorerData);
  document.getElementById('ht-refresh-btn').addEventListener('click', fetchAnalysisData);

  // POS-CLI buttons and env selectors
  document.getElementById('cli-dc-btn').addEventListener('click', () => {
    runCliCommand('data-clean', 'cli-dc-env', 'cli-dc-btn', 'cli-dc-result', 'cli-dc-banner', 'cli-dc-status', 'cli-dc-ts', 'cli-dc-pre');
  });
  document.getElementById('cli-dep-btn').addEventListener('click', () => {
    runCliCommand('deploy', 'cli-dep-env', 'cli-dep-btn', 'cli-dep-result', 'cli-dep-banner', 'cli-dep-status', 'cli-dep-ts', 'cli-dep-pre');
  });
  document.getElementById('cli-dc-env').addEventListener('change', () => updateCmdPreview('cli-dc-env', 'cli-dc-cmd-env'));
  document.getElementById('cli-dep-env').addEventListener('change', () => updateCmdPreview('cli-dep-env', 'cli-dep-cmd-env'));
});

// ── Uptime counter ─────────────────────────────────────────────────────────
setInterval(() => {
  if (startTime) document.getElementById('uptime').textContent = 'up ' + fmtUptime(Date.now() - startTime);
}, 1000);

// ── Boot sequence ──────────────────────────────────────────────────────────
initTabs();
fetchTools();
fetchStatus().then(() => {
  fetchInitialLogs().then(() => {
    initSse(); // start SSE only after historical load to avoid duplicate rendering
  });
});

// Slow-poll status every 10s as SSE fallback for stats/plan updates
setInterval(fetchStatus, 10_000);
</script>
</body>
</html>`;
}
