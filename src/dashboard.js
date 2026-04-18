/**
 * Dashboard HTML for the pos-supervisor HTTP server.
 * Served at GET /dashboard.
 *
 * Features:
 * - Real-time via SSE (no polling for activity)
 * - Timeline strip: visual tool call sequence with duration as width
 * - File validation map: per-file error state grid
 * - Compliance checklist: workflow health at a glance
 * - Activity table: file_path + error/warning counts in detail column
 * - Stats, Playground, Knowledge browser, LSP controls
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
    --bg: #282828;
    --surface: #3c3836;
    --surface2: #504945;
    --border: #665c54;
    --text: #ebdbb2;
    --muted: #928374;
    --green: #b8bb26;
    --red: #fb4934;
    --blue: #83a598;
    --yellow: #fabd2f;
    --purple: #d3869b;
    --orange: #fe8019;
    --mono: "JetBrains Mono", "Fira Code", "Courier New", monospace;
  }
  
  * { 
    box-sizing: border-box; 
    margin: 0; 
    padding: 0; 
    border-radius: 0 !important; /* Strict TUI edges */
  }
  
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: var(--bg); border-left: 1px dashed var(--border); }
  ::-webkit-scrollbar-track:horizontal { border-left: none; border-top: 1px dashed var(--border); }
  ::-webkit-scrollbar-thumb { background: var(--border); }
  ::-webkit-scrollbar-thumb:hover { background: var(--muted); }
  ::-webkit-scrollbar-button { display: none; }
  ::-webkit-scrollbar-corner { background: var(--bg); }

  body { background: var(--bg); color: var(--text); font-family: var(--mono); font-size: 13px; min-height: 100vh; line-height: 1.4; }
  a { color: var(--blue); text-decoration: none; border-bottom: 1px dotted var(--blue); }
  a:hover { background: var(--blue); color: var(--bg); }
  
  button { 
    cursor: pointer; font-family: var(--mono); font-size: 12px; font-weight: bold; text-transform: uppercase;
    border: 1px solid var(--border); background: var(--bg); color: var(--text); padding: 4px 12px; transition: none; 
  }
  button:hover:not(:disabled) { background: var(--text); color: var(--bg); border-color: var(--text); }
  button:disabled { opacity: 0.5; cursor: not-allowed; border-style: dashed; }
  
  button.primary { color: var(--blue); border-color: var(--blue); }
  button.primary:hover:not(:disabled) { background: var(--blue); color: var(--bg); border-color: var(--blue); }
  button.danger { color: var(--red); border-color: var(--red); }
  button.danger:hover:not(:disabled) { background: var(--red); color: var(--bg); border-color: var(--red); }
  
  input, select, textarea { 
    font-family: var(--mono); font-size: 12px; background: var(--bg); border: 1px solid var(--border); 
    color: var(--blue); padding: 5px 8px; outline: none; 
  }
  input:focus, select:focus, textarea:focus { border-color: var(--blue); background: #32302f; }
  textarea { resize: vertical; }
  select option { background: var(--bg); color: var(--text); }

  .topnav { position: sticky; top: 0; z-index: 100; background: var(--bg); box-shadow: 0 2px 0 var(--border); }
  header { border-bottom: 1px dashed var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 16px; background: var(--bg); }
  header h1 { font-size: 14px; font-weight: bold; color: var(--blue); text-transform: uppercase; }
  header h1::before { content: "root@supervisor:~# "; color: var(--muted); font-weight: normal; }
  header .project { color: var(--green); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header .project::before { content: "dir: "; color: var(--muted); }
  header .uptime { color: var(--muted); font-size: 12px; white-space: nowrap; }

  .status-bar { display: flex; gap: 12px; padding: 10px 24px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; }
  .stat-pill { display: flex; align-items: center; gap: 8px; padding-right: 12px; border-right: 1px solid var(--border); font-size: 11px; white-space: nowrap; }
  .stat-pill:last-child { border-right: none; }
  .stat-pill .label { color: var(--muted); text-transform: uppercase; }
  .stat-pill .value { color: var(--text); font-weight: bold; }
  
  .dot { width: 8px; height: 8px; display: inline-block; flex-shrink: 0; }
  .dot.green  { background: var(--green); }
  .dot.red    { background: var(--red); }
  .dot.yellow { background: var(--yellow); animation: blink 1s steps(2, start) infinite; }
  
  @keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }

  .live-dot { width: 8px; height: 8px; background: var(--green); display: inline-block; animation: blink 1s steps(2, start) infinite; }
  .live-dot.off { background: var(--muted); animation: none; }

  .health-ring { position: relative; width: 34px; height: 34px; cursor: help; }
  .health-ring svg { transform: rotate(-90deg); }
  .health-ring .ring-bg   { stroke: var(--surface2); fill: none; }
  .health-ring .ring-fg   { fill: none; transition: stroke-dashoffset 400ms ease, stroke 400ms ease; }
  .health-ring .ring-fg.good  { stroke: var(--green); }
  .health-ring .ring-fg.ok    { stroke: var(--yellow); }
  .health-ring .ring-fg.poor  { stroke: var(--red); }
  .health-ring .ring-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: var(--text); }
  .health-ring-tip { font-size: 10px; line-height: 1.5; }
  .health-ring-tip .row { display: flex; justify-content: space-between; gap: 12px; }
  .health-ring-tip .pass { color: var(--green); }
  .health-ring-tip .fail { color: var(--red); }

  .export-btn { border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; padding: 4px 10px; font-family: var(--mono); font-size: 10px; text-transform: uppercase; font-weight: bold; }
  .export-btn:hover { background: var(--blue); color: var(--bg); border-color: var(--blue); }

  .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); padding: 0 24px; background: var(--surface); }
  .tab { padding: 6px 14px; font-size: 12px; font-weight: bold; text-transform: uppercase; cursor: pointer; color: var(--muted); border: 1px solid transparent; border-bottom: none; user-select: none; }
  .tab:hover:not(.active) { color: var(--text); border: 1px dashed var(--border); border-bottom: none; }
  .tab.active { color: var(--bg); background: var(--blue); border: 1px solid var(--blue); border-bottom: none; }

  .tab-content { display: none; padding: 24px; max-width: 1200px; }
  .tab-content.active { display: block; }

  .cards { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  .card { background: var(--bg); border: 1px solid var(--border); padding: 12px 16px; min-width: 160px; box-shadow: 2px 2px 0 var(--border); }
  .card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 8px; }
  .card .value { font-size: 14px; font-weight: bold; display: flex; align-items: center; gap: 8px; color: var(--blue); }

  section { margin-bottom: 28px; }
  section h2 { font-size: 12px; text-transform: uppercase; color: var(--text); margin-bottom: 12px; display: inline-flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  section h2::before { content: "=== "; color: var(--blue); }
  section h2::after { content: " ==="; color: var(--blue); }
  .tick { font-size: 10px; color: var(--blue); opacity: 0; transition: none; }
  .tick.show { opacity: 1; }

  table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); }
  th { text-align: left; color: var(--muted); font-size: 11px; font-weight: bold; text-transform: uppercase; padding: 6px 10px; border-bottom: 1px dashed var(--border); background: var(--surface); }
  td { padding: 6px 10px; border-bottom: 1px solid var(--surface2); vertical-align: middle; }
  tr:hover td { background: var(--text); color: var(--bg); cursor: default; }
  tr:hover td * { color: var(--bg) !important; } /* Invert everything on hover */
  tr.row-error td { background: #3c1f1e; }
  tr.row-warn td { background: #3c2f1e; }
  tr.row-error:hover td { background: var(--red); color: var(--bg); }
  tr.row-warn:hover td { background: var(--yellow); color: var(--bg); }
  .empty { color: var(--muted); font-size: 12px; padding: 12px 0; font-style: italic; }

  .badge { display: inline-block; padding: 1px 6px; font-size: 10px; font-weight: bold; text-transform: uppercase; border: 1px solid currentColor; background: transparent !important; }
  .badge.ok   { color: var(--green); }
  .badge.error { color: var(--red); }
  .badge.info { color: var(--blue); }
  .badge.warn { color: var(--yellow); }
  
  .duration { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .ts { color: var(--muted); font-size: 11px; white-space: nowrap; }

  /* ── Timeline ──────────────────────────────────────────────────────── */
  .timeline-wrap { background: var(--bg); border: 1px solid var(--border); padding: 12px; margin-bottom: 14px; overflow: hidden; box-shadow: 2px 2px 0 var(--border); }
  .timeline-strip { display: flex; gap: 1px; align-items: flex-end; height: 46px; overflow-x: scroll; overflow-y: hidden; }
  .tl-block { min-width: 5px; flex-shrink: 0; cursor: pointer; position: relative; border-top: 1px solid rgba(255,255,255,0.2); }
  .tl-block:hover { background: var(--text) !important; border-top-color: var(--bg); }
  .tl-block.tl-validate_code    { background: var(--blue); }
  .tl-block.tl-validate_code.tl-has-errors { background: var(--red); }
  .tl-block.tl-validate_code.tl-has-warnings { background: var(--orange); }
  .tl-block.tl-validate_intent  { background: var(--purple); }
  .tl-block.tl-analyze_project  { background: var(--yellow); }
  .tl-block.tl-scaffold         { background: var(--orange); }
  .tl-block.tl-domain_guide     { background: #8ec07c; }
  .tl-block.tl-lookup           { background: #8ec07c; }
  .tl-block.tl-project_map      { background: #458588; }
  .tl-block.tl-other            { background: var(--muted); }
  .tl-block.tl-fail             { border: 1px dashed var(--red); }
  .timeline-legend { display: flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
  .tl-legend-item { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--muted); text-transform: uppercase; }
  .tl-legend-dot { width: 8px; height: 8px; flex-shrink: 0; }

  /* ── Compliance checklist ──────────────────────────────────────────── */
  .compliance-grid { display: flex; gap: 10px; flex-wrap: wrap; }
  .compliance-item { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid var(--border); font-size: 11px; background: var(--bg); text-transform: uppercase; font-weight: bold; }
  .compliance-item.pass { border-color: var(--green); color: var(--green); }
  .compliance-item.fail { border-color: var(--red); color: var(--red); }
  .compliance-item.warn { border-color: var(--yellow); color: var(--yellow); }
  .ci-icon { font-size: 12px; }

  /* ── File validation map ───────────────────────────────────────────── */
  .file-map { display: flex; flex-wrap: wrap; gap: 2px; border: 1px solid var(--border); padding: 8px; background: var(--surface); }
  .fm-cell { border: 1px solid var(--border); padding: 3px 7px; font-size: 10px; cursor: pointer; white-space: nowrap; background: var(--bg); display: inline-flex; align-items: center; gap: 6px; }
  .fm-cell.clean  { border-color: var(--green); color: var(--green); }
  .fm-cell.dirty  { border-color: var(--red); color: var(--red); }
  .fm-cell.warned { border-color: var(--orange); color: var(--orange); }
  .fm-cell.fixed  { border-color: var(--blue); color: var(--blue); }
  .fm-cell:hover  { background: var(--text); color: var(--bg); border-color: var(--text); }
  .fm-cell:hover .fm-spark .spark-line { stroke: var(--bg); }
  .fm-cell:hover .fm-spark .spark-dot  { fill: var(--bg); }
  .fm-count { font-size: 9px; opacity: .7; }
  .fm-count::before { content: "["; }
  .fm-count::after { content: "]"; }
  .fm-spark { vertical-align: middle; }
  .fm-spark .spark-line { fill: none; stroke-width: 1.2; }
  .fm-spark .spark-dot  { r: 1.5; }
  .spark-line.trend-down { stroke: var(--green); }
  .spark-line.trend-flat { stroke: var(--yellow); }
  .spark-line.trend-up   { stroke: var(--red); }
  .spark-dot.trend-down  { fill: var(--green); }
  .spark-dot.trend-flat  { fill: var(--yellow); }
  .spark-dot.trend-up    { fill: var(--red); }

  .fd-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 100; display: none; }
  .fd-overlay.open { display: block; }
  .fd-flyout { position: fixed; top: 0; right: 0; bottom: 0; width: min(520px, 92vw); background: var(--bg); border-left: 2px solid var(--blue); padding: 20px 22px; z-index: 101; overflow-y: auto; box-shadow: -4px 0 12px rgba(0,0,0,0.3); transform: translateX(100%); transition: transform 180ms ease; display: flex; flex-direction: column; gap: 16px; }
  .fd-flyout.open { transform: translateX(0); }
  .fd-flyout .fd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px dashed var(--border); padding-bottom: 10px; }
  .fd-flyout .fd-title { font-size: 12px; font-weight: bold; color: var(--blue); text-transform: uppercase; word-break: break-all; }
  .fd-flyout .fd-close { background: transparent; border: 1px solid var(--border); color: var(--text); padding: 2px 10px; font-family: var(--mono); font-size: 12px; cursor: pointer; }
  .fd-flyout .fd-close:hover { background: var(--red); color: var(--bg); border-color: var(--red); }
  .fd-flyout .fd-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .fd-flyout .fd-metric { border: 1px solid var(--border); padding: 8px 10px; font-size: 11px; }
  .fd-flyout .fd-metric .label { color: var(--muted); font-size: 10px; text-transform: uppercase; }
  .fd-flyout .fd-metric .value { color: var(--text); font-weight: bold; font-size: 13px; }
  .fd-flyout h4 { font-size: 11px; text-transform: uppercase; color: var(--muted); border-bottom: 1px dashed var(--border); padding-bottom: 4px; margin-bottom: 8px; }
  .fd-flyout .fd-spark-wrap { background: var(--surface); border: 1px solid var(--border); padding: 12px; }
  .fd-flyout table { width: 100%; border-collapse: collapse; font-size: 10px; }
  .fd-flyout th { text-align: left; color: var(--muted); font-weight: bold; text-transform: uppercase; padding: 4px 6px; border-bottom: 1px dashed var(--border); background: var(--surface); }
  .fd-flyout td { padding: 4px 6px; border-bottom: 1px solid var(--surface2); color: var(--text); vertical-align: top; }
  .fd-flyout td.num { text-align: right; }
  .fd-flyout .fd-chip { display: inline-block; font-size: 9px; padding: 1px 5px; border: 1px solid var(--border); margin: 1px 2px 1px 0; color: var(--muted); }

  /* ── Plan tracker ──────────────────────────────────────────────────── */
  .plan-box { background: var(--bg); border: 1px solid var(--border); padding: 14px; margin-bottom: 12px; box-shadow: 2px 2px 0 var(--border); }
  .plan-box .plan-id { color: var(--blue); font-size: 12px; margin-bottom: 12px; font-weight: bold; text-transform: uppercase; border-bottom: 1px dashed var(--border); padding-bottom: 6px; }
  .plan-box .plan-id::before { content: "> "; }
  .plan-files { display: flex; flex-wrap: wrap; gap: 8px; }
  .file-pill { font-size: 11px; padding: 2px 8px; border: 1px solid currentColor; background: transparent !important; }
  .file-pill.pending { color: var(--yellow); }
  .file-pill.done    { color: var(--green); }

  /* ── Bar charts ────────────────────────────────────────────────────── */
  .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .bar-label { width: 220px; font-size: 11px; overflow: hidden; text-overflow: ellipsis; color: var(--text); text-transform: uppercase; }
  .bar-track { flex: 1; height: 12px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; }
  .bar-fill { height: 100%; background: var(--blue); transition: width .4s steps(10); }
  .bar-fill.red    { background: var(--red); }
  .bar-fill.orange { background: var(--orange); }
  .bar-count { font-size: 11px; color: var(--muted); width: 40px; text-align: right; }
  .bar-count::before { content: "["; }
  .bar-count::after { content: "]"; }

  /* ── Tool grid ─────────────────────────────────────────────────────── */
  .tool-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .tool-chip { background: var(--bg); border: 1px solid var(--border); padding: 6px 12px; font-size: 11px; font-weight: bold; color: var(--text); cursor: pointer; text-transform: uppercase; }
  .tool-chip:hover { background: var(--text); color: var(--bg); border-color: var(--text); }

  /* ── Activity filter bar ───────────────────────────────────────────── */
  .filter-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; background: var(--surface); padding: 8px; border: 1px solid var(--border); }
  .filter-bar input, .filter-bar select { height: 26px; }
  .filter-bar label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text); cursor: pointer; text-transform: uppercase; }
  .filter-bar input[type=checkbox] { width: 12px; height: 12px; cursor: pointer; accent-color: var(--blue); }
  .file-col { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 11px; }

  /* ── Playground ────────────────────────────────────────────────────── */
  .playground { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }
  .tool-selector { background: var(--bg); border: 1px solid var(--border); padding: 12px; height: fit-content; box-shadow: 2px 2px 0 var(--border); }
  .tool-selector h3 { font-size: 11px; text-transform: uppercase; color: var(--blue); margin-bottom: 12px; border-bottom: 1px dashed var(--border); padding-bottom: 4px; }
  .tool-list-item { padding: 6px 8px; cursor: pointer; font-size: 11px; text-transform: uppercase; color: var(--text); border: 1px solid transparent; }
  .tool-list-item:hover:not(.active)  { border: 1px dashed var(--border); color: var(--text); }
  .tool-list-item.active { background: var(--text); color: var(--bg); font-weight: bold; }
  .tool-list-item.active::before { content: "> "; }
  .playground-editor { display: flex; flex-direction: column; gap: 12px; }
  .playground-editor textarea { min-height: 200px; width: 100%; border: 1px solid var(--border); padding: 12px; background: #1d2021; }
  .playground-result { background: #1d2021; border: 1px solid var(--border); padding: 12px; }
  .playground-result pre { font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; color: var(--text); }
  .result-ok { border-color: var(--green); }
  .result-ok pre { color: var(--green); }
  .result-error { border-color: var(--red); }
  .result-error pre { color: var(--red); }

  /* ── Knowledge browser ─────────────────────────────────────────────── */
  .knowledge-browser { display: grid; grid-template-columns: 220px 1fr; gap: 16px; }
  .kb-sidebar { background: var(--bg); border: 1px solid var(--border); padding: 12px; height: fit-content; max-height: 600px; overflow-y: auto; box-shadow: 2px 2px 0 var(--border); }
  .kb-sidebar h3 { font-size: 11px; text-transform: uppercase; color: var(--blue); margin-bottom: 12px; border-bottom: 1px dashed var(--border); padding-bottom: 4px; }
  .kb-item { padding: 6px 8px; cursor: pointer; font-size: 11px; color: var(--muted); border: 1px solid transparent; }
  .kb-item:hover:not(.active)  { border: 1px dashed var(--border); color: var(--text); }
  .kb-item.active { background: var(--text); color: var(--bg); font-weight: bold; }
  .kb-item.active::before { content: "> "; }
  .kb-content { background: #1d2021; border: 1px solid var(--border); padding: 16px; max-height: 600px; overflow-y: auto; }
  .kb-content pre { font-size: 11px; white-space: pre-wrap; color: var(--text); line-height: 1.6; }

  /* ── LSP panel ─────────────────────────────────────────────────────── */
  .lsp-panel { display: flex; flex-direction: column; gap: 24px; }
  .lsp-actions { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
  .lsp-log { background: #1d2021; border: 1px solid var(--border); padding: 12px; max-height: 300px; overflow-y: auto; }
  .lsp-log .lsp-entry { font-size: 11px; color: var(--muted); padding: 4px 0; border-bottom: 1px dashed var(--surface2); }
  .lsp-log .lsp-entry:last-child { border-bottom: none; }
  .lsp-log .lsp-entry.ok  { color: var(--green); }
  .lsp-log .lsp-entry.err { color: var(--red); }
  .lsp-log .lsp-entry::before { content: ">> "; }

  .truncate { overflow: hidden; text-overflow: ellipsis; max-width: 320px; display: inline-block; vertical-align: bottom; }
  #restart-status { font-size: 11px; text-transform: uppercase; font-weight: bold; }

  /* ── Explorer ───────────────────────────────────────────────────────── */
  .explorer-loading { color: var(--muted); font-size: 12px; padding: 20px 0; font-style: italic; }
  .explorer-error { color: var(--red); font-size: 12px; padding: 12px 0; font-weight: bold; text-transform: uppercase; }

  .ex-summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .ex-summary-card { background: var(--bg); border: 1px solid var(--border); padding: 12px 16px; box-shadow: 2px 2px 0 var(--border); }
  .ex-summary-card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 8px; }
  .ex-summary-card .value { font-size: 18px; font-weight: bold; color: var(--blue); }

  .ex-resource { background: var(--bg); border: 1px solid var(--border); margin-bottom: 20px; box-shadow: 2px 2px 0 var(--border); }
  .ex-resource-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px dashed var(--border); background: var(--surface); }
  .ex-resource-name { font-size: 13px; font-weight: bold; color: var(--text); text-transform: uppercase; }
  .ex-resource-name::before { content: "MODULE: "; color: var(--muted); font-weight: normal; }
  .ex-resource-badge { font-size: 10px; padding: 2px 6px; border: 1px solid var(--blue); color: var(--blue); text-transform: uppercase; }
  .ex-resource-body { display: grid; grid-template-columns: repeat(4, 1fr); }
  @media (max-width: 900px) { .ex-resource-body { grid-template-columns: 1fr; } }

  .ex-layer { padding: 14px; border-right: 1px dashed var(--border); }
  .ex-layer:last-child { border-right: none; }
  @media (max-width: 900px) { .ex-layer { border-right: none; border-bottom: 1px dashed var(--border); } .ex-layer:last-child { border-bottom: none; } }
  .ex-layer-title { font-size: 11px; text-transform: uppercase; color: var(--blue); margin-bottom: 12px; font-weight: bold; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  .ex-layer-item { font-size: 11px; padding: 4px 8px; border: 1px solid var(--border); margin-bottom: 6px; background: var(--surface); }
  .ex-prop { display: flex; justify-content: space-between; align-items: center; font-size: 10px; padding: 4px 8px; border: 1px solid var(--border); margin-bottom: 4px; background: var(--surface); }
  .ex-prop-name { color: var(--text); font-weight: bold; }
  .ex-prop-type { color: var(--purple); font-size: 9px; text-transform: uppercase; }
  .ex-op-badge { display: inline-block; font-size: 9px; font-weight: bold; padding: 1px 4px; margin-right: 6px; text-transform: uppercase; border: 1px solid currentColor; }
  .ex-op-query { color: var(--blue); }
  .ex-op-mutation { color: var(--green); }
  .ex-method-badge { display: inline-block; font-size: 9px; font-weight: bold; padding: 1px 4px; margin-right: 6px; text-transform: uppercase; border: 1px solid currentColor; }
  .ex-method-get    { color: var(--blue); }
  .ex-method-post   { color: var(--green); }
  .ex-method-put    { color: var(--yellow); }
  .ex-method-delete { color: var(--red); }

  .ex-route { padding: 10px 14px; border-bottom: 1px dashed var(--border); }
  .ex-route:last-child { border-bottom: none; }
  .ex-route:hover { background: var(--surface); }
  .ex-route-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .ex-route-slug { font-size: 12px; font-weight: bold; color: var(--text); }
  .ex-route-file { font-size: 10px; color: var(--muted); }
  .ex-route-calls { margin-left: 24px; border-left: 1px solid var(--border); padding-left: 12px; margin-top: 6px; }
  .ex-route-call { font-size: 10px; color: var(--muted); padding: 3px 0; display: flex; align-items: center; gap: 8px; text-transform: uppercase; }
  .ex-route-call-path { font-size: 10px; padding: 2px 6px; border: 1px solid var(--border); color: var(--text); text-transform: none; }
  .ex-static { font-size: 10px; color: var(--muted); margin-left: 24px; border-left: 1px solid var(--border); padding: 6px 12px; margin-top: 6px; text-transform: uppercase; }

  .ex-health-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .ex-health-card { background: var(--bg); border: 1px solid var(--border); padding: 14px 16px; box-shadow: 2px 2px 0 var(--border); }
  .ex-health-card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 8px; }
  .ex-health-card .value { font-size: 20px; font-weight: bold; }
  .ex-health-card.error-card { border-color: var(--red); }
  .ex-health-card.error-card .value { color: var(--red); }
  .ex-health-card.warn-card { border-color: var(--yellow); }
  .ex-health-card.warn-card .value { color: var(--yellow); }
  .ex-health-card.scan-card .value { color: var(--blue); }

  .ex-next-step { background: var(--surface); border: 1px solid var(--blue); padding: 14px 16px; margin-bottom: 20px; }
  .ex-next-step-title { font-size: 11px; text-transform: uppercase; color: var(--blue); margin-bottom: 8px; font-weight: bold; }
  .ex-next-step-title::before { content: ">> "; }
  .ex-next-step-text { font-size: 12px; color: var(--text); line-height: 1.6; }

  .ex-health-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
  @media (max-width: 900px) { .ex-health-grid { grid-template-columns: 1fr; } }

  .ex-fix-list { background: var(--bg); border: 1px solid var(--border); box-shadow: 2px 2px 0 var(--border); }
  .ex-fix-header { font-size: 11px; text-transform: uppercase; color: var(--blue); padding: 10px 14px; border-bottom: 1px dashed var(--border); background: var(--surface); font-weight: bold; }
  .ex-fix-item { display: flex; align-items: flex-start; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--surface2); }
  .ex-fix-item:last-child { border-bottom: none; }
  .ex-fix-item:hover { background: var(--surface); }
  .ex-fix-rank { font-size: 10px; font-weight: bold; color: var(--bg); background: var(--muted); padding: 2px 6px; margin-right: 12px; flex-shrink: 0; }
  .ex-fix-path { font-size: 11px; color: var(--text); word-break: break-all; font-weight: bold; }
  .ex-fix-reason { font-size: 10px; color: var(--muted); margin-top: 4px; }
  .ex-fix-badges { display: flex; gap: 6px; flex-shrink: 0; margin-left: 12px; }

  .ex-sidebar-panel { background: var(--bg); border: 1px solid var(--border); margin-bottom: 16px; box-shadow: 2px 2px 0 var(--border); }
  .ex-sidebar-title { font-size: 11px; text-transform: uppercase; color: var(--blue); padding: 10px 14px; border-bottom: 1px dashed var(--border); background: var(--surface); font-weight: bold; }
  .ex-sidebar-body { padding: 12px 14px; }
  .ex-orphan-item { font-size: 10px; padding: 4px 8px; border: 1px solid var(--border); margin-bottom: 6px; color: var(--muted); word-break: break-all; background: var(--surface); }
  .ex-orphan-item::before { content: "ORPHAN "; color: var(--red); font-weight: bold; }
  .ex-integrity-item { border: 1px dashed var(--yellow); padding: 8px 10px; margin-bottom: 10px; }
  .ex-integrity-item:last-child { margin-bottom: 0; }
  .ex-integrity-type { font-size: 10px; font-weight: bold; text-transform: uppercase; color: var(--yellow); margin-bottom: 4px; }
  .ex-integrity-msg { font-size: 11px; color: var(--text); }

  .ex-module-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 700px) { .ex-module-grid { grid-template-columns: 1fr; } }
  .ex-module-item { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text); padding: 6px 10px; border: 1px solid var(--border); text-transform: uppercase; }
  .ex-module-dot { width: 8px; height: 8px; background: var(--purple); flex-shrink: 0; }
  .ex-asset-item { font-size: 10px; color: var(--muted); padding: 4px 8px; border: 1px solid var(--border); margin-bottom: 4px; background: var(--surface); }

  .ex-refresh-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; border-bottom: 1px dashed var(--border); padding-bottom: 12px; }
  .ex-refresh-bar .ts { margin-left: auto; }

  /* ── Dependency Impact Tree ────────────────────────────────────────── */
  .dep-layout { display: grid; grid-template-columns: 320px 1fr; gap: 16px; margin-top: 12px; }
  @media (max-width: 900px) { .dep-layout { grid-template-columns: 1fr; } }
  .dep-sidebar { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border); background: var(--surface); padding: 10px; max-height: 560px; }
  .dep-sidebar #dep-filter { background: var(--bg); color: var(--text); border: 1px solid var(--border); padding: 6px 8px; font-family: inherit; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; outline: none; }
  .dep-sidebar #dep-filter:focus { border-color: var(--blue); }
  .dep-sidebar #dep-file-list { overflow-y: auto; display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .dep-sidebar .empty { color: var(--muted); font-size: 11px; padding: 8px; }
  .dep-file-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 10px; border: 1px solid transparent; cursor: pointer; background: var(--bg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dep-file-item:hover { border-color: var(--text); background: var(--surface2); }
  .dep-file-item.selected { border-color: var(--blue); background: var(--surface2); }
  .dep-file-item .path { flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
  .dep-file-item .counts { color: var(--muted); font-size: 9px; letter-spacing: .04em; }
  .dep-file-item.clean .path  { color: var(--green); }
  .dep-file-item.dirty .path  { color: var(--red); }
  .dep-file-item.warned .path { color: var(--orange); }
  .dep-file-item.fixed .path  { color: var(--blue); }
  .dep-file-item.pristine .path { color: var(--muted); }
  .dep-detail { border: 1px solid var(--border); background: var(--surface); padding: 14px; min-height: 320px; max-height: 560px; overflow-y: auto; }
  .dep-detail h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--text); margin: 0 0 6px; font-weight: 600; }
  .dep-detail .dep-path { font-size: 11px; color: var(--muted); margin-bottom: 14px; word-break: break-all; }
  .dep-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 700px) { .dep-cols { grid-template-columns: 1fr; } }
  .dep-col-title { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px dashed var(--border); }
  .dep-node { display: flex; align-items: center; gap: 6px; padding: 3px 6px; font-size: 10px; border: 1px solid var(--border); margin-bottom: 3px; cursor: pointer; background: var(--bg); }
  .dep-node:hover { border-color: var(--text); }
  .dep-node.clean { border-left: 3px solid var(--green); }
  .dep-node.dirty { border-left: 3px solid var(--red); }
  .dep-node.warned { border-left: 3px solid var(--orange); }
  .dep-node.fixed { border-left: 3px solid var(--blue); }
  .dep-node.pristine { border-left: 3px solid var(--muted); }
  .dep-node .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dep-node .badge { font-size: 9px; color: var(--muted); }
  .dep-empty { color: var(--muted); font-size: 11px; font-style: italic; }

  /* ── Tool Insights tab ─────────────────────────────────────────────── */
  .ti-alert { background: #1a1400; border: 1px solid #3a2a10; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
  .ti-alert-header { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--yellow); font-weight: 600; margin-bottom: 8px; }
  .ti-alert-item { font-size: 12px; color: var(--text); padding: 4px 0; display: flex; align-items: center; gap: 8px; }
  .ti-alert-file { color: var(--muted); font-size: 11px; }
  .ti-alert-count { font-size: 10px; padding: 1px 6px; border-radius: 10px; background: #2d0f0e; color: var(--red); border: 1px solid #3a1a1a; font-weight: 600; }

  .ti-section { margin-bottom: 24px; }
  .ti-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; margin-bottom: 6px; }
  .ti-legend { font-size: 11px; color: var(--muted); line-height: 1.55; margin-bottom: 12px; padding: 8px 10px; background: var(--surface); border-left: 3px solid var(--blue); }
  .ti-legend code { background: var(--bg); padding: 1px 4px; border: 1px solid var(--border); font-size: 10px; color: var(--text); }
  .ti-legend b { color: var(--text); }

  .ti-eff-table { width: 100%; border-collapse: collapse; }
  .ti-eff-table th { text-align: left; color: var(--muted); font-size: 10px; font-weight: 500; padding: 6px 10px; border-bottom: 1px solid var(--border); text-transform: uppercase; letter-spacing: .04em; }
  .ti-eff-table td { padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 12px; vertical-align: middle; }
  .ti-eff-table tr:last-child td { border-bottom: none; }
  .ti-eff-table tr:hover td { background: var(--surface); }
  .ti-eff-bar { display: flex; height: 8px; border-radius: 2px; overflow: hidden; min-width: 80px; background: var(--surface2); }
  .ti-eff-bar .fixed { background: var(--green); }
  .ti-eff-bar .stuck { background: var(--red); }
  .ti-eff-bar .open { background: var(--surface2); }
  .ti-eff-pct { font-size: 11px; font-weight: 600; min-width: 36px; text-align: right; }
  .ti-eff-pct.good { color: var(--green); }
  .ti-eff-pct.mid { color: var(--yellow); }
  .ti-eff-pct.bad { color: var(--red); }
  .ti-eff-pct.na { color: var(--muted); }

  .ti-gap-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; margin-bottom: 6px; }
  .ti-gap-item:hover { border-color: var(--muted); }
  .ti-gap-check { font-size: 12px; color: var(--text); flex: 1; }
  .ti-gap-count { font-size: 11px; color: var(--muted); min-width: 40px; text-align: right; }
  .ti-gap-tags { display: flex; gap: 4px; }
  .ti-gap-tag { font-size: 9px; padding: 1px 5px; border-radius: 2px; text-transform: uppercase; font-weight: 600; }
  .ti-gap-tag.has { background: #0d2a16; color: var(--green); }
  .ti-gap-tag.miss { background: #2d0f0e; color: var(--red); }

  .ti-wf-row { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-bottom: 1px solid var(--border); }
  .ti-wf-row:last-child { border-bottom: none; }
  .ti-wf-row:hover { background: var(--surface); }
  .ti-wf-label { font-size: 12px; color: var(--text); flex: 1; }
  .ti-wf-count { font-size: 11px; color: var(--muted); min-width: 30px; text-align: right; }
  .ti-wf-bar-track { flex: 0 0 100px; height: 8px; background: var(--surface2); border-radius: 2px; overflow: hidden; }
  .ti-wf-bar-fill { height: 100%; border-radius: 2px; }
  .ti-wf-bar-fill.expected { background: var(--green); }
  .ti-wf-bar-fill.retry { background: var(--yellow); }
  .ti-wf-bar-fill.skip { background: var(--red); }

  .ti-scaffold-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 12px; overflow: hidden; }
  .ti-scaffold-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--surface2); }
  .ti-scaffold-title { font-size: 13px; font-weight: 600; color: #fff; }
  .ti-scaffold-meta { font-size: 10px; color: var(--muted); }
  .ti-scaffold-files { padding: 8px 16px; }
  .ti-scaffold-file { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 11px; }
  .ti-scaffold-file .path { color: var(--muted); flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .ti-scaffold-quality { font-size: 11px; padding: 8px 16px; border-top: 1px solid var(--border); color: var(--muted); background: var(--surface2); display: flex; gap: 16px; }

  .ti-empty { color: var(--muted); font-size: 12px; padding: 12px 0; }

  /* ── POS-CLI tab ───────────────────────────────────────────────────── */
  .cli-section { margin-bottom: 28px; }
  .cli-section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  .cli-section-title { font-size: 12px; text-transform: uppercase; color: var(--text); font-weight: bold; }
  .cli-section-title::before { content: "=== "; color: var(--blue); }
  .cli-section-title::after { content: " ==="; color: var(--blue); }
  .cli-card { background: var(--bg); border: 1px solid var(--border); box-shadow: 2px 2px 0 var(--border); }
  .cli-card-body { padding: 16px 20px; }
  .cli-desc { font-size: 11px; color: var(--muted); line-height: 1.6; margin-bottom: 16px; text-transform: uppercase; }
  .cli-cmd-preview { font-size: 11px; color: var(--blue); background: #1d2021; border: 1px solid var(--blue); border-left: 4px solid var(--blue); padding: 10px 14px; margin-bottom: 16px; font-family: var(--mono); }
  .cli-cmd-preview::before { content: "$ "; font-weight: bold; }
  .cli-caution { display: flex; align-items: flex-start; gap: 10px; border: 1px dashed var(--yellow); padding: 10px 14px; margin-bottom: 20px; font-size: 11px; color: var(--yellow); line-height: 1.5; background: #322922; }
  .cli-caution-label { font-weight: bold; font-size: 10px; text-transform: uppercase; white-space: nowrap; padding-top: 1px; }
  .cli-caution-label::after { content: ":"; }
  .cli-action-bar { display: flex; align-items: center; gap: 12px; background: var(--surface); padding: 10px; border: 1px solid var(--border); }
  .cli-env-select { min-width: 180px; height: 32px; font-weight: bold; text-transform: uppercase; }
  .cli-result { margin-top: 16px; display: none; }
  .cli-result-banner { padding: 8px 12px; font-size: 11px; font-weight: bold; display: flex; align-items: center; gap: 10px; border: 1px solid var(--border); border-bottom: none; text-transform: uppercase; }
  .cli-result-banner.ok { color: var(--green); border-color: var(--green); }
  .cli-result-banner.fail { color: var(--red); border-color: var(--red); }
  .cli-result-banner.running { color: var(--blue); border-color: var(--blue); animation: blink 1s steps(2, start) infinite; }
  .cli-result-output { background: #1d2021; border: 1px solid var(--border); padding: 12px; max-height: 300px; overflow-y: auto; }
  .cli-result-output pre { font-size: 11px; white-space: pre-wrap; word-break: break-all; color: var(--text); line-height: 1.5; margin: 0; }
  .cli-result-ts { font-size: 10px; color: var(--muted); font-weight: normal; margin-left: auto; }

  /* ── Hint Effectiveness (A2) ──────────────────────────────────────── */
  .he-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); }
  .he-table th { text-align: left; color: var(--muted); font-size: 10px; font-weight: bold; padding: 6px 10px; border-bottom: 1px dashed var(--border); background: var(--surface); text-transform: uppercase; }
  .he-table td { padding: 6px 10px; border-bottom: 1px solid var(--surface2); font-size: 11px; }
  .he-table tr:last-child td { border-bottom: none; }
  .he-table tr:hover td { background: var(--surface); }
  .he-pct { font-weight: bold; }
  .he-pct.good { color: var(--green); }
  .he-pct.mid { color: var(--yellow); }
  .he-pct.bad { color: var(--red); }

  /* ── Analytics tab ────────────────────────────────────────────────── */
  .an-section { margin-bottom: 28px; }
  .an-section-title { font-size: 12px; text-transform: uppercase; color: var(--text); font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  .an-section-title::before { content: "=== "; color: var(--blue); }
  .an-section-title::after { content: " ==="; color: var(--blue); }
  .an-legend { font-size: 11px; color: var(--muted); line-height: 1.55; margin-bottom: 12px; padding: 8px 10px; background: var(--surface); border-left: 3px solid var(--blue); }
  .an-legend code { background: var(--bg); padding: 1px 4px; border: 1px solid var(--border); font-size: 10px; color: var(--text); }
  .an-legend b { color: var(--text); }
  .an-empty { color: var(--muted); font-size: 12px; padding: 12px 0; }

  .an-stats-row { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .an-stat { background: var(--bg); border: 1px solid var(--border); padding: 10px 16px; min-width: 140px; box-shadow: 2px 2px 0 var(--border); }
  .an-stat .label { color: var(--muted); font-size: 10px; text-transform: uppercase; margin-bottom: 6px; }
  .an-stat .value { font-size: 14px; font-weight: bold; color: var(--blue); }

  .an-sc-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); }
  .an-sc-table th { text-align: left; color: var(--muted); font-size: 10px; font-weight: bold; padding: 6px 10px; border-bottom: 1px dashed var(--border); background: var(--surface); text-transform: uppercase; }
  .an-sc-table td { padding: 6px 10px; border-bottom: 1px solid var(--surface2); font-size: 11px; vertical-align: middle; }
  .an-sc-table tr:last-child td { border-bottom: none; }
  .an-sc-table tr:hover td { background: var(--surface); }

  .an-ci-bar { display: flex; align-items: center; gap: 4px; min-width: 160px; }
  .an-ci-track { flex: 1; height: 10px; background: var(--surface2); position: relative; overflow: hidden; border: 1px solid var(--border); }
  .an-ci-fill { position: absolute; top: 0; height: 100%; }
  .an-ci-fill.good { background: var(--green); }
  .an-ci-fill.mid { background: var(--yellow); }
  .an-ci-fill.bad { background: var(--red); }
  .an-ci-fill.neutral { background: var(--blue); }
  .an-ci-marker { position: absolute; top: -1px; bottom: -1px; width: 2px; background: var(--text); }
  .an-ci-val { font-size: 10px; font-weight: bold; min-width: 36px; text-align: right; }
  .an-ci-val.good { color: var(--green); }
  .an-ci-val.mid { color: var(--yellow); }
  .an-ci-val.bad { color: var(--red); }
  .an-ci-val.neutral { color: var(--blue); }

  .an-rec-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); margin-bottom: 8px; box-shadow: 2px 2px 0 var(--border); }
  .an-rec-icon { font-size: 12px; color: var(--yellow); flex-shrink: 0; padding-top: 1px; }
  .an-rec-body { flex: 1; }
  .an-rec-check { font-size: 12px; font-weight: bold; color: var(--text); text-transform: uppercase; margin-bottom: 4px; }
  .an-rec-text { font-size: 11px; color: var(--muted); line-height: 1.5; }
  .an-rec-text code { background: var(--bg); padding: 1px 4px; border: 1px solid var(--border); font-size: 10px; color: var(--text); }
  .an-rec-rate { font-size: 11px; font-weight: bold; color: var(--red); flex-shrink: 0; }

  .an-sess-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); }
  .an-sess-table th { text-align: left; color: var(--muted); font-size: 10px; font-weight: bold; padding: 6px 10px; border-bottom: 1px dashed var(--border); background: var(--surface); text-transform: uppercase; }
  .an-sess-table td { padding: 6px 10px; border-bottom: 1px solid var(--surface2); font-size: 11px; }
  .an-sess-table tr:last-child td { border-bottom: none; }
  .an-sess-table tr:hover td { background: var(--surface); }
  .an-sess-id { color: var(--blue); font-weight: bold; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }

  .an-bigram-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--surface2); }
  .an-bigram-row:last-child { border-bottom: none; }
  .an-bigram-seq { font-size: 11px; color: var(--text); flex: 1; text-transform: uppercase; }
  .an-bigram-arrow { color: var(--muted); }
  .an-bigram-metric { font-size: 10px; color: var(--muted); min-width: 50px; text-align: right; }
  .an-bigram-metric b { color: var(--text); }

  .an-explain { font-size: 11px; color: var(--muted); line-height: 1.7; padding: 14px; background: #1d2021; border: 1px solid var(--border); }
  .an-explain dt { color: var(--blue); font-weight: bold; text-transform: uppercase; margin-top: 10px; }
  .an-explain dt:first-child { margin-top: 0; }
  .an-explain dd { margin-left: 16px; margin-bottom: 6px; }

  /* ── Tool Lab (A5) ────────────────────────────────────────────────── */
  .tl-browser { display: grid; grid-template-columns: 220px 1fr; gap: 16px; }
  .tl-sidebar { background: var(--bg); border: 1px solid var(--border); padding: 12px; height: fit-content; max-height: 600px; overflow-y: auto; box-shadow: 2px 2px 0 var(--border); }
  .tl-sidebar h3 { font-size: 11px; text-transform: uppercase; color: var(--blue); margin-bottom: 12px; border-bottom: 1px dashed var(--border); padding-bottom: 4px; }
  .tl-tool-item { padding: 6px 8px; cursor: pointer; font-size: 11px; color: var(--muted); border: 1px solid transparent; text-transform: uppercase; }
  .tl-tool-item:hover:not(.active) { border: 1px dashed var(--border); color: var(--text); }
  .tl-tool-item.active { background: var(--text); color: var(--bg); font-weight: bold; }
  .tl-tool-item.active::before { content: "> "; }
  .tl-detail { background: #1d2021; border: 1px solid var(--border); padding: 16px; max-height: 600px; overflow-y: auto; }
  .tl-metrics { display: flex; gap: 16px; margin-bottom: 16px; }
  .tl-metric { padding: 6px 12px; border: 1px solid var(--border); font-size: 11px; text-transform: uppercase; }
  .tl-metric .label { color: var(--muted); font-size: 10px; }
  .tl-metric .value { color: var(--blue); font-weight: bold; }
  .tl-desc { font-size: 11px; color: var(--text); line-height: 1.6; white-space: pre-wrap; margin-bottom: 16px; padding: 12px; background: var(--surface); border: 1px solid var(--border); }
  .tl-schema-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); }
  .tl-schema-table th { text-align: left; color: var(--muted); font-size: 10px; font-weight: bold; padding: 6px 10px; border-bottom: 1px dashed var(--border); background: var(--surface); text-transform: uppercase; }
  .tl-schema-table td { padding: 6px 10px; border-bottom: 1px solid var(--surface2); font-size: 11px; }
  .tl-schema-table tr:last-child td { border-bottom: none; }
  .tl-schema-table tr:hover td { background: var(--surface); }

  /* ── Diagnostic Diff (B3) ─────────────────────────────────────────── */
  .dd-file { background: var(--bg); border: 1px solid var(--border); margin-bottom: 10px; box-shadow: 2px 2px 0 var(--border); }
  .dd-file-header { font-size: 11px; font-weight: bold; color: var(--text); padding: 8px 12px; background: var(--surface); border-bottom: 1px dashed var(--border); text-transform: uppercase; }
  .dd-file-body { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 6px; }
  .dd-check { font-size: 10px; padding: 2px 8px; border: 1px solid currentColor; font-weight: bold; text-transform: uppercase; }
  .dd-check.fixed { color: var(--green); }
  .dd-check.new { color: var(--red); }
  .dd-check.unchanged { color: var(--muted); }

  /* ── False Positive Manager (A3) ──────────────────────────────────── */
  .fp-section { margin-top: 28px; }
  .fp-list { margin-bottom: 16px; }
  .fp-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--border); margin-bottom: 6px; background: var(--surface); font-size: 11px; text-transform: uppercase; }
  .fp-item-check { font-weight: bold; color: var(--text); min-width: 180px; }
  .fp-item-pattern { color: var(--muted); flex: 1; }
  .fp-item-reason { color: var(--muted); font-size: 10px; flex: 1; }
  .fp-form { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; padding: 12px; background: var(--surface); border: 1px solid var(--border); }
  .fp-form-group { display: flex; flex-direction: column; gap: 4px; }
  .fp-form-group label { font-size: 10px; color: var(--muted); text-transform: uppercase; }
  .fp-form-group input { height: 28px; min-width: 160px; }

  /* ── Module Integration Health (C1) ───────────────────────────────── */
  .mih-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .mih-card { background: var(--bg); border: 1px solid var(--border); box-shadow: 2px 2px 0 var(--border); }
  .mih-card-header { font-size: 12px; font-weight: bold; color: var(--text); padding: 10px 14px; background: var(--surface); border-bottom: 1px dashed var(--border); text-transform: uppercase; }
  .mih-card-header::before { content: "MODULE: "; color: var(--muted); font-weight: normal; }
  .mih-card-body { padding: 10px 14px; }
  .mih-stat { font-size: 11px; color: var(--muted); text-transform: uppercase; padding: 2px 0; }
  .mih-stat .value { color: var(--blue); font-weight: bold; }
  .mih-callers { margin-top: 8px; }
  .mih-caller { font-size: 10px; color: var(--muted); padding: 2px 8px; border: 1px solid var(--border); margin-bottom: 4px; background: var(--surface); }

  /* ── Schema-GraphQL Matrix (C2) ───────────────────────────────────── */
  .sgm-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); }
  .sgm-table th { text-align: left; color: var(--muted); font-size: 10px; font-weight: bold; padding: 6px 10px; border-bottom: 1px dashed var(--border); background: var(--surface); text-transform: uppercase; }
  .sgm-table td { padding: 6px 10px; border-bottom: 1px solid var(--surface2); font-size: 11px; text-transform: uppercase; }
  .sgm-table tr:last-child td { border-bottom: none; }
  .sgm-table tr:hover td { background: var(--surface); }
  .sgm-ops { display: flex; flex-wrap: wrap; gap: 4px; }
  .sgm-op { font-size: 9px; font-weight: bold; padding: 1px 6px; border: 1px solid currentColor; text-transform: uppercase; }
  .sgm-op.query { color: var(--blue); }
  .sgm-op.mutation { color: var(--green); }
  .sgm-none { color: var(--muted); font-size: 10px; }

  /* ── Live Console (D1) ────────────────────────────────────────────── */
  .lc-toggle { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; padding: 8px; background: var(--surface); border: 1px solid var(--border); }
  .lc-toggle label { font-size: 11px; color: var(--text); text-transform: uppercase; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .lc-panel { background: var(--bg); border: 1px solid var(--border); padding: 16px; margin-bottom: 16px; box-shadow: 2px 2px 0 var(--border); }
  .lc-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
  .lc-controls select { height: 28px; }
  .lc-textarea { width: 100%; min-height: 150px; font-family: var(--mono); font-size: 11px; background: #1d2021; border: 1px solid var(--border); color: var(--text); padding: 12px; }
  .lc-result { margin-top: 12px; background: #1d2021; border: 1px solid var(--border); padding: 12px; max-height: 300px; overflow-y: auto; }
  .lc-result pre { font-size: 11px; white-space: pre-wrap; word-break: break-all; color: var(--text); }
  .lc-diag { padding: 6px 8px; margin-bottom: 4px; border-left: 3px solid var(--border); font-size: 11px; }
  .lc-diag.error { border-left-color: var(--red); color: var(--red); }
  .lc-diag.warning { border-left-color: var(--yellow); color: var(--yellow); }
  .lc-diag.info { border-left-color: var(--blue); color: var(--blue); }

  /* ── Pipeline Inspector (D2) ──────────────────────────────────────── */
  .pi-file { background: var(--bg); border: 1px solid var(--border); margin-bottom: 10px; box-shadow: 2px 2px 0 var(--border); }
  .pi-file-header { font-size: 11px; font-weight: bold; color: var(--text); padding: 8px 12px; background: var(--surface); border-bottom: 1px dashed var(--border); text-transform: uppercase; cursor: pointer; display: flex; justify-content: space-between; }
  .pi-file-header:hover { background: var(--text); color: var(--bg); }
  .pi-file-body { display: none; padding: 0; }
  .pi-file-body.open { display: block; }
  .pi-step { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-bottom: 1px solid var(--surface2); font-size: 11px; text-transform: uppercase; }
  .pi-step:last-child { border-bottom: none; }
  .pi-step.active { background: rgba(184, 187, 38, 0.1); }
  .pi-step.noop { color: var(--muted); }
  .pi-step-name { flex: 1; font-weight: bold; }
  .pi-step-stat { font-size: 10px; min-width: 60px; text-align: right; }
  .pi-step-stat.removed { color: var(--green); }
  .pi-step-stat.remaining { color: var(--muted); }

  /* ── Sessions (D3) ────────────────────────────────────────────────── */
  .sess-actions { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
  .sess-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); }
  .sess-table th { text-align: left; color: var(--muted); font-size: 10px; font-weight: bold; padding: 6px 10px; border-bottom: 1px dashed var(--border); background: var(--surface); text-transform: uppercase; }
  .sess-table td { padding: 6px 10px; border-bottom: 1px solid var(--surface2); font-size: 11px; cursor: pointer; }
  .sess-table tr:last-child td { border-bottom: none; }
  .sess-table tr:hover td { background: var(--surface); }
  .sess-table tr.selected td { background: var(--blue); color: var(--bg); }
  .sess-table tr.selected td * { color: var(--bg) !important; }
  .sess-compare { margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .sess-compare-panel { background: var(--bg); border: 1px solid var(--border); box-shadow: 2px 2px 0 var(--border); }
  .sess-compare-header { font-size: 11px; font-weight: bold; color: var(--blue); padding: 10px 14px; background: var(--surface); border-bottom: 1px dashed var(--border); text-transform: uppercase; }
  .sess-compare-body { padding: 10px 14px; }
  .sess-diff-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--surface2); }
  .sess-diff-row:last-child { border-bottom: none; }
  .sess-diff-up { color: var(--red); }
  .sess-diff-down { color: var(--green); }
  .sess-diff-same { color: var(--muted); }

  /* ── Tooltip ───────────────────────────────────────────────────────── */
  #tooltip { position: fixed; background: var(--bg); border: 1px solid var(--blue); box-shadow: 4px 4px 0 rgba(131,165,152,0.2); padding: 8px 12px; font-size: 11px; color: var(--text); pointer-events: none; z-index: 1000; display: none; max-width: 320px; line-height: 1.5; text-transform: uppercase; font-weight: bold; }
</style>
</head>
<body>
<div id="tooltip"></div>

<div class="topnav">
<header>
  <h1>pos-supervisor</h1>
  <span class="project" id="project-dir">—</span>
  <span class="uptime" id="uptime">—</span>
</header>

<div class="status-bar">
  <div class="stat-pill" id="sb-health-pill">
    <span class="label">HEALTH : </span>
    <div class="health-ring" id="health-ring" onmousemove="showHealthTip(event)" onmouseleave="hideTip()">
      <svg width="34" height="34" viewBox="0 0 34 34">
        <circle class="ring-bg" cx="17" cy="17" r="14" stroke-width="4"/>
        <circle class="ring-fg good" id="health-ring-fg" cx="17" cy="17" r="14" stroke-width="4" stroke-dasharray="88" stroke-dashoffset="88"/>
      </svg>
      <span class="ring-label" id="health-ring-label">—</span>
    </div>
  </div>
  <div class="stat-pill"><span id="lsp-dot" class="dot yellow"></span><span class="label">LSP : </span><span class="value" id="lsp-label">WAIT</span></div>
  <div class="stat-pill"><span id="cli-dot" class="dot yellow"></span><span class="label">POS-CLI : </span><span class="value" id="cli-label">WAIT</span></div>
  <div class="stat-pill"><span class="label">TOOLS : </span><span class="value" id="sb-tools">—</span></div>
  <div class="stat-pill"><span class="label">VER : </span><span class="value" id="sb-version">—</span></div>
  <div class="stat-pill"><span class="label">CALLS : </span><span class="value" id="sb-calls">0</span></div>
  <div class="stat-pill"><span class="label">ERR : </span><span class="value" id="sb-errors">0</span></div>
  <div class="stat-pill" style="margin-left:auto"><button class="export-btn" id="export-btn" title="Download session report as Markdown">Export Report</button></div>
  <div class="stat-pill"><span class="live-dot off" id="live-dot"></span><span class="label" style="margin-left:8px" id="live-label">CONNECTING</span></div>
</div>

<div class="tabs">
  <div class="tab active" data-tab="overview">Overview</div>
  <div class="tab" data-tab="activity">Activity</div>
  <div class="tab" data-tab="explorer">Explorer</div>
  <div class="tab" data-tab="health">Health</div>
  <div class="tab" data-tab="insights">Tool Insights</div>
  <div class="tab" data-tab="analytics">Analytics</div>
  <div class="tab" data-tab="toollab">Tool Lab</div>
  <div class="tab" data-tab="lsp">LSP</div>
  <div class="tab" data-tab="pos-cli">POS-CLI</div>
</div>
</div>

<!-- ── Overview ────────────────────────────────────────────────────── -->
<div class="tab-content active" id="tab-overview">

  <section>
    <h2>Project Health</h2>
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
    <h2>Error Patterns <span style="font-size:9px;color:var(--muted)">(SESSION)</span> <span class="tick" id="checks-tick">↻</span></h2>
    <div id="check-bars"><span class="empty">no validate_code calls yet</span></div>
  </section>

  <section>
    <h2>Tools <span class="tick" id="tools-tick">↻</span></h2>
    <div class="tool-grid" id="tool-list"><span class="empty">loading…</span></div>
  </section>

</div>

<!-- ── Health (merged: analyze_project + explorer + routes + suppressions) ── -->
<!-- ── Explorer (merged: project map + routes + module + schema-graphql) ── -->
<div class="tab-content" id="tab-explorer">

  <section>
    <h2>Project Map</h2>
    <div class="ti-legend">Runs <code>project_map</code> — vertical slices (schema → GraphQL → business logic → pages).</div>
    <div class="ex-refresh-bar">
      <button id="ex-refresh-btn">Fetch Project Map</button>
      <span class="ts" id="ex-last-fetched"></span>
    </div>
    <div id="ex-summary"></div>
    <div id="ex-resources"><span class="explorer-loading">Execute FETCH PROJECT MAP to load resources.</span></div>
  </section>

  <section id="ex-module-health-section" style="display:none">
    <h2>Module Integration Health</h2>
    <div id="ex-module-health"></div>
  </section>

  <section id="ex-schema-gql-section" style="display:none">
    <h2>Schema-GraphQL Consistency</h2>
    <div id="ex-schema-gql"></div>
  </section>

  <section>
    <h2>Routes &amp; Lifecycle</h2>
    <div id="rt-body"><span class="explorer-loading">Execute FETCH PROJECT MAP above to load route tables.</span></div>
  </section>

  <section>
    <h2>Dependency Impact Tree</h2>
    <div class="ti-legend">Click a file to see what it depends on and what depends on it. Colored by validation state — fixing red files unblocks everything that references them.</div>
    <div class="ex-refresh-bar">
      <button id="dep-refresh-btn">Load Graph</button>
      <span class="ts" id="dep-last-fetched"></span>
    </div>
    <div class="dep-layout" id="dep-layout" style="display:none">
      <div class="dep-sidebar">
        <input type="text" id="dep-filter" placeholder="FILTER FILES..." autocomplete="off">
        <div id="dep-file-list"><span class="empty">LOADING...</span></div>
      </div>
      <div class="dep-detail" id="dep-detail">
        <pre style="color:var(--muted)">SELECT A FILE ON THE LEFT TO SEE ITS IMPACT.</pre>
      </div>
    </div>
  </section>
</div>

<!-- ── Health (project analysis + suppressions) ────────────────────────── -->
<div class="tab-content" id="tab-health">

  <section>
    <h2>Project Analysis</h2>
    <div class="ti-legend">Runs <code>analyze_project</code> for stuck files, orphaned files, integrity, orphans, cycles. Pair with the Project Map in the Explorer tab to interpret findings in context.</div>
    <div class="ex-refresh-bar">
      <button id="ht-refresh-btn">Run Analysis</button>
      <span class="ts" id="ht-last-fetched"></span>
    </div>
    <div id="ht-body"><span class="explorer-loading">Execute RUN ANALYSIS to load project health data.</span></div>
  </section>

  <section class="fp-section">
    <h2>Suppressions</h2>
    <div class="ti-legend">Rules written to <code>.pos-supervisor-ignore.yml</code>. The diagnostic pipeline drops matching checks before enrichment.</div>
    <div id="fp-list"><span class="empty">LOADING SUPPRESSIONS...</span></div>
    <div class="fp-form" id="fp-form">
      <div class="fp-form-group">
        <label>CHECK NAME</label>
        <select id="fp-check">
          <option value="">— SELECT A CHECK —</option>
        </select>
      </div>
      <div class="fp-form-group">
        <label>OR TYPE CUSTOM NAME</label>
        <input type="text" id="fp-check-custom" placeholder="CHECK NAME IF NOT IN LIST">
      </div>
      <div class="fp-form-group">
        <label>FILE PATTERN (OPTIONAL)</label>
        <input type="text" id="fp-pattern" placeholder="E.G. **/LEGACY/**">
      </div>
      <div class="fp-form-group">
        <label>REASON (OPTIONAL)</label>
        <input type="text" id="fp-reason" placeholder="FALSE POSITIVE">
      </div>
      <button class="primary" id="fp-add-btn">Add Suppression</button>
    </div>
  </section>
</div>

<!-- ── Activity (merged: timeline + table + stats + sessions) ─────────── -->
<div class="tab-content" id="tab-activity">

  <section>
    <h2>Timeline <span style="font-size:10px;color:var(--blue);text-transform:none;letter-spacing:0;margin-left:8px" id="tl-count"></span></h2>
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

  <section>
    <h2>Call Log</h2>
    <div class="filter-bar">
      <select id="filter-tool"><option value="">ALL TOOLS</option></select>
      <label><input type="checkbox" id="filter-errors"> [ERRORS ONLY]</label>
      <input type="text" id="filter-search" placeholder="SEARCH FILE, ERROR…" style="width:220px">
      <span style="margin-left:auto; font-size:11px; color:var(--blue); font-weight:bold;" id="activity-count"></span>
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
      <tbody id="activity-body"><tr><td colspan="6" class="empty" style="padding:12px 8px">awaiting entries…</td></tr></tbody>
    </table>
  </section>

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

  <section>
    <h2>Session History</h2>
    <div class="ti-legend">Previous sessions are persisted to <code>.pos-supervisor/sessions/</code>. Click <b>SAVE CURRENT</b> to snapshot now, or <b>LOAD SESSIONS</b> to compare past runs side-by-side.</div>
    <div class="sess-actions">
      <button class="primary" id="sess-load-btn">Load Sessions</button>
      <button id="sess-save-btn">Save Current</button>
      <span class="ts" id="sess-status"></span>
    </div>
    <div id="sess-table-wrap"><span class="empty">CLICK LOAD SESSIONS TO FETCH SESSION HISTORY.</span></div>
    <div id="sess-compare-wrap"></div>
  </section>

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
          <button class="danger" id="cli-dc-btn" disabled>Exec Data Clean</button>
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
          <button class="primary" id="cli-dep-btn" disabled>Exec Deploy</button>
        </div>
        <div class="cli-result" id="cli-dep-result">
          <div class="cli-result-banner" id="cli-dep-banner"><span id="cli-dep-status"></span><span class="cli-result-ts" id="cli-dep-ts"></span></div>
          <div class="cli-result-output"><pre id="cli-dep-pre"></pre></div>
        </div>
      </div>
    </div>
  </div>

</div>

<!-- ── Tool Insights ────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-insights">
  <div class="ex-refresh-bar">
    <button id="ti-refresh-btn">Refresh</button>
    <span class="ts" id="ti-last-fetched"></span>
  </div>
  <div id="ti-stuck-alert"></div>
  <div class="ti-section">
    <div class="ti-section-title">Diagnostic Effectiveness</div>
    <div class="ti-legend">For every check the LSP fires, this shows how often a later validation makes it go away. <b>LOW FIX RATE</b> = the agent sees the error but doesn't fix it — the <i>hint/fix text</i> is probably wrong or missing. Action: improve the hint in <code>src/data/hints/&lt;check&gt;.md</code>.</div>
    <div id="ti-effectiveness"><span class="ti-empty">No validate_code calls yet — effectiveness data appears after files are validated multiple times.</span></div>
  </div>
  <div class="ti-section">
    <div class="ti-section-title">Hint Effectiveness</div>
    <div class="ti-legend">Counts how many times <code>enrich_error</code> was called for a check, and how many of those calls led to the error being fixed on the next validation. <b>LOW CONVERSION</b> = agent read the hint but didn't act on it. Action: rewrite the hint to be more directive.</div>
    <div id="ti-hint-eff"><span class="ti-empty">No hint data yet — call enrich_error on a few errors first.</span></div>
  </div>
  <div class="ti-section">
    <div class="ti-section-title">Per-File Diagnostic Diff</div>
    <div class="ti-legend">For each file validated more than once, shows what changed between runs: <b style="color:var(--green)">RESOLVED</b> checks, <b style="color:var(--red)">NEW</b> checks, <b style="color:var(--yellow)">STILL PRESENT</b>. Use it to see if the last edit helped or made things worse.</div>
    <div id="ti-diag-diff"><span class="ti-empty">No files with multiple validations yet.</span></div>
  </div>
  <div class="ti-section">
    <div class="ti-section-title">Knowledge Gaps</div>
    <div class="ti-legend">Lists LSP checks that fired in this session but have <b>no hint file</b> in <code>src/data/hints/</code>. Agents got an error message with no guidance on how to fix it. Action: add a hint file for each listed check.</div>
    <div id="ti-gaps"><span class="ti-empty">Loading…</span></div>
  </div>
  <div class="ti-section">
    <div class="ti-section-title">Workflow Patterns</div>
    <div class="ti-legend">Common tool-call sequences observed in this session (e.g. <code>project_map → scaffold → validate_intent → validate_code</code>). Confirms whether agents are following the intended workflow or taking shortcuts.</div>
    <div id="ti-workflow"><span class="ti-empty">No tool calls yet.</span></div>
  </div>
  <div class="ti-section">
    <div class="ti-section-title">Scaffold Quality</div>
    <div class="ti-legend">Every scaffold call is scored on: files generated, conflicts, and whether the follow-up <code>validate_intent</code> passed. <b>LOW SCORE</b> = scaffold produced output that didn't match intent. Action: improve the scaffold template or the validator's ontology.</div>
    <div id="ti-scaffolds"><span class="ti-empty">No scaffold calls in this session.</span></div>
  </div>
  <div class="ti-section">
    <div class="ti-section-title">Pipeline Inspector</div>
    <div class="ti-legend">Per-file trace through the <code>diagnostic-pipeline</code> — shows how many errors/warnings each step removed. Use it to find <b>inactive steps</b> (never triggered → candidates for removal) and <b>over-eager steps</b> (suppressing too much). Click a file header to expand the trace.</div>
    <div id="ti-pipeline"><span class="ti-empty">No pipeline trace data yet.</span></div>
  </div>
  <div class="ti-section">
    <div class="ti-section-title">Knowledge Library</div>
    <div class="ti-legend">The hint files in <code>src/data/hints/</code> rendered into the <i>hint</i> field of every enriched diagnostic. Use this to review what agents will actually see when a check fires.</div>
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
</div>

<!-- ── Analytics ────────────────────────────────────────────────────── -->
<div class="tab-content" id="tab-analytics">
  <div class="ex-refresh-bar">
    <button id="an-refresh-btn">Refresh</button>
    <button id="an-rebuild-btn" class="danger" title="Rebuild analytics DB from session event logs">Rebuild DB</button>
    <span class="ts" id="an-last-fetched"></span>
  </div>

  <div class="an-stats-row" id="an-stats">
    <span class="an-empty">Loading analytics...</span>
  </div>

  <div class="an-section">
    <div class="an-section-title">Check Scorecards</div>
    <div class="an-legend">Per-check performance across all sessions. <b>Resolution rate</b> = how often a diagnostic disappears after the agent edits. <b>Mislead rate</b> = how often a fix introduces new diagnostics (regression). <b>Adoption rate</b> = how often the agent applies the proposed fix verbatim. Bars show the 95% credible interval (Beta-binomial posterior, Beta(2,2) prior).</div>
    <div id="an-scorecards"><span class="an-empty">No analytics data yet — rebuild the database or wait for sessions to accumulate.</span></div>
  </div>

  <div class="an-section">
    <div class="an-section-title">Recommendations</div>
    <div class="an-legend">Checks with a <b>mislead rate above 30%</b> — the hint or fix text is actively harmful. Prioritize rewriting these hints in <code>src/data/hints/&lt;check&gt;.md</code> or adjusting the rule in <code>src/core/rules/&lt;check&gt;.js</code>.</div>
    <div id="an-recommendations"><span class="an-empty">No recommendations yet.</span></div>
  </div>

  <div class="an-section">
    <div class="an-section-title">Session Improvement Report</div>
    <div class="an-legend">Per-session summary showing tool usage, diagnostics emitted, and outcomes (resolved vs regressed). Use this to compare session quality over time and identify which sessions had the best resolution rates.</div>
    <div id="an-sessions"><span class="an-empty">No session data yet.</span></div>
  </div>

  <div class="an-section">
    <div class="an-section-title">Tool Sequence Patterns</div>
    <div class="an-legend">Frequently observed tool-call pairs across all sessions with <b>lift</b> (how much more likely than chance) and <b>confidence</b> (probability of B following A). High lift + high confidence = strong workflow pattern.</div>
    <div id="an-bigrams"><span class="an-empty">No sequence data yet.</span></div>
  </div>

  <div class="an-section">
    <div class="an-section-title">Rule Performance</div>
    <div class="an-legend">Per-rule effectiveness scores. <b>Effectiveness</b> = resolution_rate - regression_rate. Rules below 15% effectiveness with 10+ outcomes are flagged for <b>disabling</b>. A disabled rule means its hint is doing more harm than good.</div>
    <div id="an-rule-scores"><span class="an-empty">No rule score data yet.</span></div>
  </div>

  <div class="an-section">
    <div class="an-section-title">Suggested Rules</div>
    <div class="an-legend">Diagnostics with <b>no matching rule</b> but a clear case-base signal (high resolution rate on consistent fix patterns). These are candidates for new rules — click to see a template. <b>Never auto-merge</b>; always review.</div>
    <div id="an-suggested-rules"><span class="an-empty">No suggestions yet.</span></div>
  </div>

  <div class="an-section">
    <div class="an-section-title">How to Read This</div>
    <div class="an-explain">
      <dl>
        <dt>Resolution Rate</dt>
        <dd>Fraction of diagnostics that disappear between consecutive validate_code calls on the same file. A resolved diagnostic means the agent successfully acted on the hint. Higher is better.</dd>
        <dt>Mislead Rate</dt>
        <dd>Fraction of outcomes where new diagnostics appeared that weren't in the previous call (regressions). This means the agent's fix introduced new problems. Lower is better. Above 30% = the hint is actively harmful.</dd>
        <dt>Adoption Rate</dt>
        <dd>Of diagnostics with proposed fixes, how often the agent applied the fix verbatim (exact text match). Low adoption may mean the fix text is wrong, or the agent prefers its own approach.</dd>
        <dt>Credible Intervals</dt>
        <dd>The bars show 95% Bayesian credible intervals using a Beta(2,2) prior. With few observations, intervals are wide (uncertain). As data accumulates, they narrow. The marker shows the posterior mean.</dd>
        <dt>Collateral</dt>
        <dd>Average net new diagnostics introduced per regression: max(0, new_diags - resolved_diags). High collateral = the fix is causing cascading failures.</dd>
        <dt>Lift (Bigrams)</dt>
        <dd>How much more likely a tool pair occurs vs random chance. Lift > 1 = tools are used together more than expected. Lift = 1 = no association.</dd>
      </dl>
    </div>
  </div>
</div>

<!-- ── Tool Lab (merged: tool browser + executor + live diagnostic console) ── -->
<div class="tab-content" id="tab-toollab">
  <div class="ti-legend" style="margin-bottom:12px">
    Every tool exposed by this server — description, input schema, live usage stats, and an executor. Select a tool to see its docs and run it; toggle <b>Live Diagnostic Console</b> to validate arbitrary or project content without wiring params.
  </div>

  <div class="lc-toggle">
    <label><input type="checkbox" id="lc-mode-toggle"> LIVE DIAGNOSTIC CONSOLE</label>
  </div>
  <div id="lc-panel" class="lc-panel" style="display:none">
    <div class="lc-controls">
      <input id="lc-file-filter" placeholder="filter…" autocomplete="off" style="width:140px">
      <select id="lc-file-picker" style="min-width:280px; max-width:440px">
        <option value="">— LOAD FILE FROM PROJECT —</option>
      </select>
      <button id="lc-load-btn">Load</button>
      <select id="lc-filetype">
        <option value=".liquid">.LIQUID</option>
        <option value=".graphql">.GRAPHQL</option>
        <option value=".yml">.YML</option>
      </select>
      <button class="primary" id="lc-validate-btn">Validate</button>
      <span class="ts" id="lc-status"></span>
    </div>
    <textarea id="lc-content" class="lc-textarea" placeholder="PASTE CONTENT OR PICK A FILE ABOVE AND CLICK LOAD..." spellcheck="false"></textarea>
    <div id="lc-result" class="lc-result" style="display:none"></div>
  </div>

  <div id="tl-browser-wrap" class="tl-browser">
    <div class="tl-sidebar">
      <h3>Tools</h3>
      <div id="tl-tool-list"><span class="empty">LOADING...</span></div>
    </div>
    <div class="tl-detail">
      <div id="tl-detail">
        <pre style="color:var(--muted)">SELECT A TOOL ON THE LEFT TO VIEW DOCS, SESSION STATS, AND RUN IT.</pre>
      </div>
      <div id="tl-exec" style="display:none; margin-top:16px; border-top:1px dashed var(--border); padding-top:16px">
        <h4 style="font-size:11px; text-transform:uppercase; color:var(--blue); margin-bottom:8px">Execute</h4>
        <textarea id="tl-params" class="lc-textarea" placeholder='{"param": "value"}' spellcheck="false"></textarea>
        <div style="display:flex; gap:8px; align-items:center; margin-top:8px">
          <button class="primary" id="tl-run-btn" disabled>Execute</button>
          <button id="tl-format-btn" disabled>Format JSON</button>
          <span class="ts" id="tl-status"></span>
        </div>
        <div id="tl-result" class="playground-result" style="display:none; margin-top:12px">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px">
            <span id="tl-result-label" style="font-weight:bold; color:var(--green); font-size:11px; text-transform:uppercase">RESULT</span>
            <span id="tl-result-duration" class="ts"></span>
          </div>
          <pre id="tl-result-pre"></pre>
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
          <div class="value" id="lsp-status-card"><span class="dot yellow"></span> WAIT</div>
        </div>
        <div class="card">
          <div class="label">pos-cli</div>
          <div class="value" id="cli-status-card"><span class="dot yellow"></span> WAIT</div>
        </div>
      </div>
      <div class="lsp-actions">
        <button class="danger" id="lsp-restart-btn">Restart Server</button>
        <span id="restart-status"></span>
      </div>
    </section>
    <section>
      <h2>Daemon Log <span style="font-size:9px;color:var(--muted)">(SESSION)</span></h2>
      <div class="lsp-log" id="lsp-log"><span class="empty lsp-entry">no events yet</span></div>
    </section>
  </div>
</div>

<!-- ── File Detail Flyout (opened from any file-map cell) ─────────────────── -->
<div class="fd-overlay" id="fd-overlay"></div>
<aside class="fd-flyout" id="fd-flyout" role="dialog" aria-hidden="true"></aside>

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
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + 320 > window.innerWidth) x = e.clientX - 16 - tooltip.offsetWidth;
  if (y + 120 > window.innerHeight) y = e.clientY - 16 - tooltip.offsetHeight;
  tooltip.style.left = x + 'px';
  tooltip.style.top  = y + 'px';
}
function hideTip() { tooltip.style.display = 'none'; }
document.addEventListener('mousemove', moveTip);

// ── Tab switching ────────────────────────────────────────────────────────
// Lazy-load hooks per tab. Each runs at most once unless the underlying
// loader function itself implements re-fetch on click.
const TAB_LOADERS = {
  explorer: () => { if (!explorerLoaded) fetchExplorerData(); },
  health:   () => { if (!analysisLoaded) fetchAnalysisData(); if (!suppressionsLoaded) fetchSuppressions(); },
  insights: () => { fetchInsightsData(); if (!hintsLoaded) fetchHints(); },
  analytics: () => { fetchAnalytics(); },
  toollab:  () => { if (!toolsLoaded) fetchTools(); fetchToolLab(); },
  'pos-cli': () => { if (!cliEnvsLoaded) fetchCliEnvs(); },
  // overview, activity, lsp: eagerly loaded via boot sequence / SSE
};

// Legacy → new tab name migration (user's saved tab may reference a removed one)
const LEGACY_TAB_MAP = {
  routes: 'explorer',
  stats: 'activity', sessions: 'activity',
  playground: 'toollab', knowledge: 'insights',
};

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
      TAB_LOADERS[name]?.();
    });
  });
  if (LEGACY_TAB_MAP[activeTab]) activeTab = LEGACY_TAB_MAP[activeTab];
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
      liveLabel.textContent = 'LIVE';
    });

    es.addEventListener('error', () => {
      liveDot.className   = 'live-dot off';
      liveLabel.textContent = 'RECONNECTING';
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
    document.getElementById('lsp-label').textContent = lspReady ? 'OK' : 'WAIT';
    document.getElementById('cli-dot').className   = 'dot ' + (d.posCliFound ? 'green' : 'red');
    document.getElementById('cli-label').textContent = d.posCliFound ? 'OK' : 'ERR';

    document.getElementById('lsp-status-card').innerHTML = dot(lspReady ? 'green' : 'yellow') + ' ' + (lspReady ? 'READY' : 'WARMING UP');
    document.getElementById('cli-status-card').innerHTML = dot(d.posCliFound ? 'green' : 'red') + ' ' + (d.posCliFound ? 'FOUND' : 'MISSING');

    const stats = d.stats || {};
    let totalCalls = 0;
    for (const k of Object.keys(stats)) totalCalls += stats[k].calls || 0;
    const fh = d.fileHistory || [];
    const totalErrors = fh.reduce((n, f) => n + (f.lastErrorCount || 0), 0);
    document.getElementById('sb-calls').textContent = totalCalls;
    const errEl = document.getElementById('sb-errors');
    errEl.textContent  = totalErrors;
    errEl.style.color  = totalErrors > 0 ? 'var(--red)' : 'var(--muted)';

    renderStatsTable(stats);
    renderCheckFrequency(d.checkFrequency || {});
    renderCheckBars(d.checkFrequency || {});
    populateSuppressionChecks();
    renderPlan(d.plan);
    renderCompliance(d);
    renderHealthRing(d);
    renderFileMap(d.fileHistory || []);

    if (insightsLoaded && activeTab === 'insights') renderInsights();

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
  const fh = d.fileHistory || [];
  const vcCalls = stats.validate_code?.calls || 0;
  const dirtyFiles = fh.filter(f => (f.lastErrorCount || 0) > 0).length;

  const items = [
    {
      label: 'LSP ready',
      pass: !!d.lspReady,
      icon: d.lspReady ? '[X]' : '[ ]',
    },
    {
      label: 'pos-cli found',
      pass: !!d.posCliFound,
      icon: d.posCliFound ? '[X]' : '[ ]',
    },
    {
      label: 'validate_intent',
      pass: (stats.validate_intent?.calls || 0) > 0,
      icon: (stats.validate_intent?.calls || 0) > 0 ? '[X]' : '[ ]',
      detail: stats.validate_intent?.calls ? stats.validate_intent.calls + 'x' : null,
    },
    {
      label: 'validate_code',
      pass: vcCalls > 0 && dirtyFiles === 0,
      warn: vcCalls > 0 && dirtyFiles > 0,
      icon: vcCalls === 0 ? '[ ]' : (dirtyFiles === 0 ? '[X]' : '[-]'),
      detail: vcCalls ? (vcCalls + ' calls' + (dirtyFiles ? ', ' + dirtyFiles + ' dirty' : '')) : null,
    },
    {
      label: 'analyze_project',
      pass: (stats.analyze_project?.calls || 0) > 0,
      warn: false,
      icon: (stats.analyze_project?.calls || 0) > 0 ? '[X]' : '[ ]',
    },
  ];

  // Manual plan progress (pendingFiles = ALL planned files; validatedFiles ⊆ pendingFiles)
  if (d.plan && d.plan.source === 'manual') {
    const total = d.plan.pendingFiles?.length || 0;
    const done  = d.plan.validatedFiles?.length || 0;
    items.push({
      label: 'manual valid.',
      pass: done === total && total > 0,
      warn: done < total && done > 0,
      icon: done === total ? '[X]' : '[-]',
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

// ── Project Health Score ────────────────────────────────────────────────
// Pure function of project state. Two modes:
//   1. Before analysis: infrastructure-only (LSP + pos-cli) — caps at 15/100
//   2. After analysis:  real project health from diagnostic data
//
// Dimensions (post-analysis):
//   Error free     (0-30): % of files with zero errors
//   Warning free   (0-15): % of files with zero warnings
//   Integrity      (0-20): broken refs, missing graphql, broken function calls
//   Orphaned files (0-10): orphaned partial ratio
//   Schema health  (0-10): schema files passing validation
//   Infrastructure (0-15): LSP ready + pos-cli found
let lastHealth = null;

function computeHealthScore(d) {
  const hasAnalysis = !!analysisData;

  const infraChecks = [
    { label: 'LSP ready',    weight: 10, pass: !!d.lspReady },
    { label: 'pos-cli found', weight: 5, pass: !!d.posCliFound },
  ];
  const infraScore = infraChecks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0);

  if (!hasAnalysis) {
    return {
      score: infraScore,
      mode: 'infrastructure',
      checks: infraChecks,
      totalFiles: 0, totalErrors: 0, totalWarnings: 0,
      dirtyFiles: 0, dirtyRate: 0,
      integrityIssues: 0, orphanedCount: 0,
    };
  }

  const a = analysisData;
  const totalFiles = a.files_scanned || 0;
  const totalErrors = a.total_errors || 0;
  const totalWarnings = a.total_warnings || 0;
  const filesWithErrors = (a.files || []).filter(f => f.errors > 0).length;
  const filesWithWarnings = (a.files || []).filter(f => f.warnings > 0).length;
  const integrityIssues = (a.integrity || []).filter(i => i.severity === 'error').length;
  const integrityWarnings = (a.integrity || []).filter(i => i.severity === 'warning').length;
  const orphanedCount = (a.orphaned_files || []).length;
  const totalPartials = totalFiles > 0 ? totalFiles : 1;

  // Error free (0-30): ratio of clean files
  const errorFreeRate = totalFiles > 0 ? (totalFiles - filesWithErrors) / totalFiles : 1;
  const errorFreeScore = Math.round(30 * errorFreeRate);

  // Warning free (0-15)
  const warningFreeRate = totalFiles > 0 ? (totalFiles - filesWithWarnings) / totalFiles : 1;
  const warningFreeScore = Math.round(15 * warningFreeRate);

  // Integrity (0-20): penalize broken references proportionally
  // 0 issues = 20, 5+ issues = 0
  const integrityTotal = integrityIssues + integrityWarnings;
  const integrityScore = Math.max(0, Math.round(20 * (1 - Math.min(integrityTotal / 5, 1))));

  // Orphaned files (0-10): penalize orphaned partials
  // 0 orphans = 10, 10+ orphans = 0
  const orphanedScore = Math.max(0, Math.round(10 * (1 - Math.min(orphanedCount / 10, 1))));

  // Schema health (0-10): schema files with issues
  const schemaFiles = (a.files || []).filter(f => f.path.startsWith('app/schema/'));
  const schemaErrors = schemaFiles.filter(f => f.errors > 0).length;
  const totalSchemas = schemaFiles.length;
  const schemaScore = totalSchemas > 0
    ? Math.round(10 * (totalSchemas - schemaErrors) / totalSchemas)
    : 10;

  const score = Math.min(100, errorFreeScore + warningFreeScore + integrityScore + orphanedScore + schemaScore + infraScore);

  const dirtyRate = totalFiles > 0 ? filesWithErrors / totalFiles : 0;

  const checks = [
    { label: 'error-free files',   weight: 30, partial: errorFreeScore, pass: errorFreeScore === 30, detail: filesWithErrors > 0 ? filesWithErrors + ' file(s) with errors' : null },
    { label: 'warning-free files', weight: 15, partial: warningFreeScore, pass: warningFreeScore === 15, detail: filesWithWarnings > 0 ? filesWithWarnings + ' file(s) with warnings' : null },
    { label: 'integrity',          weight: 20, partial: integrityScore, pass: integrityTotal === 0, detail: integrityTotal > 0 ? integrityTotal + ' issue(s)' : null },
    { label: 'orphaned files',     weight: 10, partial: orphanedScore, pass: orphanedCount === 0, detail: orphanedCount > 0 ? orphanedCount + ' orphan(s)' : null },
    { label: 'schema health',      weight: 10, partial: schemaScore, pass: schemaErrors === 0, detail: schemaErrors > 0 ? schemaErrors + ' schema(s) with errors' : null },
    ...infraChecks,
  ];

  return {
    score,
    mode: 'project',
    checks,
    totalFiles,
    totalErrors,
    totalWarnings,
    dirtyFiles: filesWithErrors,
    dirtyRate,
    integrityIssues: integrityTotal,
    orphanedCount,
  };
}

function renderHealthRing(d) {
  const fg = document.getElementById('health-ring-fg');
  const label = document.getElementById('health-ring-label');
  if (!fg || !label) return;

  const h = computeHealthScore(d);
  lastHealth = h;

  const circumference = 2 * Math.PI * 14; // ≈ 88
  const offset = circumference * (1 - h.score / 100);
  fg.setAttribute('stroke-dasharray', circumference.toFixed(2));
  fg.setAttribute('stroke-dashoffset', offset.toFixed(2));
  fg.classList.remove('good', 'ok', 'poor');
  fg.classList.add(h.score >= 80 ? 'good' : h.score >= 50 ? 'ok' : 'poor');
  label.textContent = h.score;
}

function showHealthTip(e) {
  if (!lastHealth) return;
  const h = lastHealth;
  const title = h.mode === 'project' ? 'PROJECT HEALTH' : 'INFRASTRUCTURE (run analysis for full score)';
  const rows = h.checks.map(c => {
    const hasPartial = typeof c.partial === 'number';
    const scored = hasPartial ? c.partial : (c.pass ? c.weight : 0);
    const icon = hasPartial ? (c.pass ? '[X]' : '[-]') : (c.pass ? '[X]' : '[ ]');
    const cls = c.pass ? 'pass' : (hasPartial && scored > 0 ? 'warn' : 'fail');
    const detail = c.detail ? ' <span style="opacity:.6">' + escHtml(c.detail) + '</span>' : '';
    return '<div class="row"><span class="' + cls + '">' + icon + ' ' + escHtml(c.label) + detail + '</span>'
      + '<span>+' + scored + '/' + c.weight + '</span></div>';
  }).join('');
  const summaryLine = h.mode === 'project'
    ? '<div class="row"><span>scanned ' + h.totalFiles + ' files: ' + h.totalErrors + ' errors, ' + h.totalWarnings + ' warnings</span></div>'
    : '';
  const total = '<div class="row" style="border-top:1px dashed var(--border); padding-top:4px; margin-top:4px; font-weight:bold">'
    + '<span>TOTAL</span><span>' + h.score + '/100</span></div>';
  showTip(e, '<div class="health-ring-tip"><div style="color:var(--blue); font-weight:bold; margin-bottom:6px">' + title + '</div>'
    + rows + summaryLine + total + '</div>');
}

// ── Session Export ──────────────────────────────────────────────────────
function exportSession() {
  const d = lastStatus;
  if (!d) return;
  const h = lastHealth || computeHealthScore(d);
  const stats = d.stats || {};
  const fh = d.fileHistory || [];
  const now = new Date().toISOString();

  const lines = [];
  lines.push('# pos-supervisor session report');
  lines.push('');
  lines.push('- Generated: ' + now);
  lines.push('- Project: ' + (d.projectDir || '—'));
  lines.push('- Server version: ' + (d.version || '—'));
  lines.push('- Uptime: ' + fmtDuration(d.uptimeMs || 0));
  lines.push('- Session started: ' + (d.startedAt ? new Date(d.startedAt).toISOString() : '—'));
  lines.push('');
  lines.push('## Health: ' + h.score + '/100' + (h.mode === 'infrastructure' ? ' (infrastructure only — run analyze_project for full score)' : ''));
  lines.push('');
  lines.push('| Check | Weight | Score | Status |');
  lines.push('|---|---:|---:|---|');
  for (const c of h.checks) {
    const scored = typeof c.partial === 'number' ? c.partial : (c.pass ? c.weight : 0);
    const status = (c.pass ? 'PASS' : (scored > 0 ? 'PARTIAL' : 'FAIL')) + (c.detail ? ' (' + c.detail + ')' : '');
    lines.push('| ' + c.label + ' | ' + c.weight + ' | ' + scored + ' | ' + status + ' |');
  }
  if (h.mode === 'project') {
    lines.push('');
    lines.push('Files scanned: ' + h.totalFiles + ', Errors: ' + h.totalErrors + ', Warnings: ' + h.totalWarnings);
  }
  lines.push('');
  lines.push('## Tool usage');
  lines.push('');
  lines.push('| Tool | Calls | Errors | Avg ms | Last |');
  lines.push('|---|---:|---:|---:|---|');
  const toolKeys = Object.keys(stats).sort((a, b) => (stats[b].calls || 0) - (stats[a].calls || 0));
  for (const k of toolKeys) {
    const s = stats[k];
    const avg = s.calls ? Math.round((s.totalMs || 0) / s.calls) : 0;
    const last = s.lastCalledAt ? new Date(s.lastCalledAt).toISOString() : '—';
    lines.push('| ' + k + ' | ' + (s.calls || 0) + ' | ' + (s.errors || 0) + ' | ' + avg + ' | ' + last + ' |');
  }
  lines.push('');
  lines.push('## Files validated (' + fh.length + ')');
  lines.push('');
  if (fh.length) {
    lines.push('| File | Calls | Last errors | Last warnings | Streak |');
    lines.push('|---|---:|---:|---:|---:|');
    const fhSorted = [...fh].sort((a, b) =>
      (b.lastErrorCount || 0) - (a.lastErrorCount || 0) ||
      (b.consecutiveNonDecreasing || 0) - (a.consecutiveNonDecreasing || 0) ||
      (b.calls || 0) - (a.calls || 0)
    );
    for (const f of fhSorted) {
      lines.push('| ' + f.path + ' | ' + (f.calls || 0) + ' | ' + (f.lastErrorCount || 0)
        + ' | ' + (f.lastWarningCount || 0) + ' | ' + (f.consecutiveNonDecreasing || 0) + ' |');
    }
  } else {
    lines.push('_No files validated in this session._');
  }
  lines.push('');
  lines.push('## Check frequency');
  lines.push('');
  const freq = d.checkFrequency || {};
  const freqKeys = Object.keys(freq).sort((a, b) => (freq[b] || 0) - (freq[a] || 0));
  if (freqKeys.length) {
    lines.push('| Check | Occurrences |');
    lines.push('|---|---:|');
    for (const k of freqKeys) lines.push('| ' + k + ' | ' + freq[k] + ' |');
  } else {
    lines.push('_No diagnostic checks recorded._');
  }
  lines.push('');
  if (d.plan) {
    lines.push('## Plan (' + (d.plan.source || 'unknown') + ')');
    lines.push('');
    lines.push('- Pending files: ' + (d.plan.pendingFiles?.length || 0));
    lines.push('- Validated files: ' + (d.plan.validatedFiles?.length || 0));
    lines.push('- Pending translations: ' + (d.plan.pendingTranslations?.length || 0));
    lines.push('');
  }

  const md = lines.join('\\n');
  const stamp = now.replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pos-supervisor-session-' + stamp + '.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Sparkline helper (shared by file-map inline + flyout) ────────────────
// Classifies trend from first → last value: down = converging (good),
// flat = stuck, up = diverging. Returns SVG markup, empty when <2 points.
function sparklineSvg(values, { width = 32, height = 10, dot = true } = {}) {
  if (!values || values.length < 2) return '';
  const maxV = Math.max(...values, 1);
  const n = values.length;
  const stepX = n > 1 ? width / (n - 1) : 0;
  const y = v => height - 1 - (height - 2) * (v / maxV);
  const pts = values.map((v, i) => (i * stepX).toFixed(1) + ',' + y(v).toFixed(1));
  const first = values[0], last = values[values.length - 1];
  const trend = last < first ? 'trend-down' : last > first ? 'trend-up' : 'trend-flat';
  const lastX = ((n - 1) * stepX).toFixed(1);
  const lastY = y(last).toFixed(1);
  return '<svg class="fm-spark" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">'
    + '<polyline class="spark-line ' + trend + '" points="' + pts.join(' ') + '"/>'
    + (dot ? '<circle class="spark-dot ' + trend + '" cx="' + lastX + '" cy="' + lastY + '" r="1.5"/>' : '')
    + '</svg>';
}

// ── File call history reconstruction (from in-memory log entries) ────────
function fileCallHistory(path) {
  const seen = new Set();
  const merged = [];
  for (const e of [...allLogEntries, ...liveEntries]) {
    if (e.event !== 'tool_call' || e.tool !== 'validate_code' || e.file_path !== path) continue;
    const k = e.ts + ':' + (e.file_path || '');
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(e);
  }
  return merged.sort((a, b) => a.ts - b.ts);
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
    const titleParts = [f.path, 'CALLS: ' + f.calls];
    if (f.lastErrorCount) titleParts.push('ERRORS: ' + f.lastErrorCount);
    if (warns)            titleParts.push('WARNINGS: ' + warns);
    if (!f.lastErrorCount && !warns) titleParts.push('STATUS: CLEAN');
    titleParts.push('CLICK FOR DETAILS');
    const title = titleParts.join('\\n');
    const history = fileCallHistory(f.path);
    const errSeries = history.map(e => e.error_count || 0);
    const spark = errSeries.length >= 2 ? sparklineSvg(errSeries) : '';
    return '<div class="fm-cell ' + cls + '" data-file-path="' + escHtml(f.path) + '" title="' + escHtml(title) + '">'
      + escHtml(label)
      + spark
      + (f.calls > 1 ? '<span class="fm-count">' + f.calls + '</span>' : '')
      + '</div>';
  }).join('');
}

// ── File Detail Flyout ───────────────────────────────────────────────────
function openFileDetail(path) {
  const overlay = document.getElementById('fd-overlay');
  const panel   = document.getElementById('fd-flyout');
  if (!overlay || !panel) return;

  const history = fileCallHistory(path);
  const fh = (lastStatus?.fileHistory || []).find(f => f.path === path);
  const errSeries  = history.map(e => e.error_count   || 0);
  const warnSeries = history.map(e => e.warning_count || 0);

  const total       = history.length;
  const lastErrors  = errSeries[errSeries.length - 1] ?? 0;
  const lastWarns   = warnSeries[warnSeries.length - 1] ?? 0;
  const peakErrors  = errSeries.length ? Math.max(...errSeries) : 0;
  const firstErrors = errSeries[0] ?? 0;
  const trend = errSeries.length < 2 ? '—'
              : lastErrors < firstErrors ? 'CONVERGING'
              : lastErrors > firstErrors ? 'DIVERGING'
              : 'STUCK';

  const sparkBig = errSeries.length >= 2
    ? sparklineSvg(errSeries, { width: 460, height: 64 })
    : '<span class="empty">Only one call — no trend yet.</span>';

  const rowsHtml = history.length
    ? history.map(e => {
        const checks = Array.isArray(e.checks) ? e.checks : [];
        const checksHtml = checks.length
          ? checks.map(c => '<span class="fd-chip">' + escHtml(c) + '</span>').join('')
          : '<span style="color:var(--muted)">—</span>';
        return '<tr>'
          + '<td>' + fmtTime(new Date(e.ts).toISOString()) + '</td>'
          + '<td class="num" style="color:' + ((e.error_count || 0) > 0 ? 'var(--red)' : 'var(--muted)') + '">' + (e.error_count   || 0) + '</td>'
          + '<td class="num" style="color:' + ((e.warning_count || 0) > 0 ? 'var(--orange)' : 'var(--muted)') + '">' + (e.warning_count || 0) + '</td>'
          + '<td class="num">' + (e.durationMs != null ? e.durationMs + 'ms' : '—') + '</td>'
          + '<td>' + checksHtml + '</td>'
          + '</tr>';
      }).join('')
    : '<tr><td colspan="5" style="color:var(--muted)">No validate_code calls recorded for this file.</td></tr>';

  panel.innerHTML = '<div class="fd-head">'
    + '<div class="fd-title">' + escHtml(path) + '</div>'
    + '<button class="fd-close" id="fd-close-btn" aria-label="Close">X</button>'
    + '</div>'
    + '<div class="fd-metrics">'
    + '<div class="fd-metric"><div class="label">CALLS</div><div class="value">' + (fh?.calls ?? total) + '</div></div>'
    + '<div class="fd-metric"><div class="label">LAST ERRORS</div><div class="value" style="color:' + (lastErrors > 0 ? 'var(--red)' : 'var(--green)') + '">' + lastErrors + '</div></div>'
    + '<div class="fd-metric"><div class="label">LAST WARNINGS</div><div class="value" style="color:' + (lastWarns > 0 ? 'var(--orange)' : 'var(--muted)') + '">' + lastWarns + '</div></div>'
    + '<div class="fd-metric"><div class="label">PEAK ERRORS</div><div class="value">' + peakErrors + '</div></div>'
    + '<div class="fd-metric"><div class="label">STREAK</div><div class="value">' + (fh?.consecutiveNonDecreasing ?? 0) + '</div></div>'
    + '<div class="fd-metric"><div class="label">TREND</div><div class="value" style="color:' + (trend === 'CONVERGING' ? 'var(--green)' : trend === 'DIVERGING' ? 'var(--red)' : trend === 'STUCK' ? 'var(--orange)' : 'var(--muted)') + '">' + trend + '</div></div>'
    + '</div>'
    + '<div><h4>Error count over calls</h4><div class="fd-spark-wrap">' + sparkBig + '</div></div>'
    + '<div><h4>Call history (' + history.length + ')</h4>'
    + '<table><thead><tr><th>TIME</th><th class="num">ERR</th><th class="num">WARN</th><th class="num">MS</th><th>CHECKS</th></tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody></table></div>';

  overlay.classList.add('open');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.getElementById('fd-close-btn').addEventListener('click', closeFileDetail);
}

function closeFileDetail() {
  document.getElementById('fd-overlay').classList.remove('open');
  const panel = document.getElementById('fd-flyout');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
}

// ── Dependency Impact Tree ───────────────────────────────────────────────
let depData = null;
let depSelectedFile = null;
let depFilter = '';

function depStateFor(validation) {
  if (!validation) return 'pristine';
  if (validation.errors > 0) return 'dirty';
  if (validation.warnings > 0) return 'warned';
  if (validation.calls > 1) return 'fixed';
  return 'clean';
}

async function fetchDependencyTree() {
  const btn = document.getElementById('dep-refresh-btn');
  const layout = document.getElementById('dep-layout');
  const list = document.getElementById('dep-file-list');
  const tsEl = document.getElementById('dep-last-fetched');
  if (!btn || !layout || !list) return;
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = 'LOADING...';
  layout.style.display = 'grid';
  list.innerHTML = '<span class="empty">LOADING...</span>';
  try {
    const res = await fetch('/api/dependency-tree');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    depData = await res.json();
    if (tsEl) tsEl.textContent = 'Loaded ' + new Date().toLocaleTimeString() + ' — ' + (depData.total || 0) + ' files';
    renderDepSidebar();
  } catch (err) {
    list.innerHTML = '<span class="empty" style="color:var(--red)">FAILED: ' + (err && err.message ? err.message : err) + '</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel || 'Refresh';
  }
}

const DEP_STATE_RANK = { dirty: 0, warned: 1, fixed: 2, clean: 3, pristine: 4 };

function renderDepSidebar() {
  const list = document.getElementById('dep-file-list');
  if (!list || !depData) return;
  const nodes = depData.nodes || {};
  const filter = (depFilter || '').toLowerCase();
  const entries = Object.entries(nodes)
    .filter(([path]) => !filter || path.toLowerCase().includes(filter))
    .map(([path, node]) => ({
      path,
      node,
      refCount: (node.referenced_by || []).length,
      depCount: (node.depends_on || []).length,
      state: depStateFor(node.validation),
    }))
    .sort((a, b) => {
      const sa = DEP_STATE_RANK[a.state] ?? 5;
      const sb = DEP_STATE_RANK[b.state] ?? 5;
      if (sa !== sb) return sa - sb;
      if (b.refCount !== a.refCount) return b.refCount - a.refCount;
      if (b.depCount !== a.depCount) return b.depCount - a.depCount;
      return a.path.localeCompare(b.path);
    });

  if (entries.length === 0) {
    list.innerHTML = '<span class="empty">NO MATCHES</span>';
    return;
  }

  list.innerHTML = entries.map(({ path, state, refCount, depCount }) => {
    const selected = depSelectedFile === path ? ' selected' : '';
    const counts = '&rarr;' + depCount + ' &larr;' + refCount;
    const esc = escHtml(path);
    return '<div class="dep-file-item ' + state + selected + '" data-path="' + esc + '" title="' + esc + '"><span class="path">' + esc + '</span><span class="counts">' + counts + '</span></div>';
  }).join('');
}

function selectDepFile(path) {
  if (!depData) return;
  depSelectedFile = path;
  renderDepSidebar();
  const detail = document.getElementById('dep-detail');
  if (!detail) return;
  const node = depData.nodes && depData.nodes[path];
  if (!node) {
    detail.innerHTML = '<pre style="color:var(--red)">FILE NOT IN GRAPH</pre>';
    return;
  }
  const deps = (node.depends_on || []).slice().sort();
  const refs = (node.referenced_by || []).slice().sort();
  const nodes = depData.nodes;

  const renderList = (paths, emptyText) => {
    if (paths.length === 0) return '<div class="dep-empty">' + emptyText + '</div>';
    return paths.map(p => {
      const other = nodes[p];
      const state = other ? depStateFor(other.validation) : 'pristine';
      const refCount = other ? (other.referenced_by || []).length : 0;
      const depCount = other ? (other.depends_on || []).length : 0;
      const esc = escHtml(p);
      return '<div class="dep-node ' + state + '" data-path="' + esc + '" title="' + esc + '"><span class="path">' + esc + '</span><span class="badge">&rarr;' + depCount + ' &larr;' + refCount + '</span></div>';
    }).join('');
  };

  const v = node.validation;
  const state = depStateFor(v);
  const summary = v
    ? 'calls=' + v.calls + ' err=' + v.errors + ' warn=' + v.warnings + ' streak=' + (v.streak || 0)
    : 'no validation history';

  detail.innerHTML =
    '<h3>Impact · <span style="color:var(--' + (state === 'dirty' ? 'red' : state === 'warned' ? 'orange' : state === 'fixed' ? 'blue' : state === 'clean' ? 'green' : 'muted') + ')">' + state.toUpperCase() + '</span></h3>' +
    '<div class="dep-path">' + escHtml(path) + '<br><span style="color:var(--muted);font-size:10px">' + summary + '</span></div>' +
    '<div class="dep-cols">' +
      '<div><div class="dep-col-title">Depends on (' + deps.length + ')</div>' + renderList(deps, 'No outgoing dependencies.') + '</div>' +
      '<div><div class="dep-col-title">Referenced by (' + refs.length + ')</div>' + renderList(refs, 'No incoming references (possibly orphaned or entry point).') + '</div>' +
    '</div>';
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
  if (tlCount) tlCount.textContent = '— ' + entries.length + ' CALLS';

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
      e.error_count   ? e.error_count   + ' ERR'   : '',
      e.warning_count ? e.warning_count + ' WARN' : '',
      e.model         ? 'MOD: ' + e.model             : '',
      e.file_count    ? e.file_count    + ' FILES'       : '',
      e.success === false ? '[FAIL]' + (e.error ? ': ' + e.error.slice(0,50) : '') : '',
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
  if (count) count.textContent = rows.length + ' ENTRIES';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty" style="padding:12px 8px">NO MATCHING ACTIVITY</td></tr>';
    return;
  }

  tbody.innerHTML = rows.slice(0, 80).map(e => {
    let toolCell = '<span class="badge info">' + escHtml(e.event || '') + '</span>';
    let fileCell = '', issueCell = '', durationCell = '', statusCell = '';
    let rowCls = '';

    if (e.event === 'tool_call') {
      toolCell = '<span style="font-weight:bold">' + escHtml(e.tool || '') + '</span>';
      durationCell = '<span class="duration">' + fmtDuration(e.durationMs) + '</span>';

      if (e.success === false) {
        statusCell = '<span class="badge error">ERR</span>';
        rowCls = 'row-error';
        fileCell = e.error ? '<span class="truncate" style="color:var(--red)">' + escHtml(String(e.error).slice(0,80)) + '</span>' : '';
      } else {
        statusCell = '<span class="badge ok">OK</span>';
      }

      if (e.file_path) {
        fileCell = '<span class="file-col" title="' + escHtml(e.file_path) + '">' + escHtml(shortPath(e.file_path)) + '</span>';
      } else if (e.model) {
        fileCell = '<span style="color:var(--muted);font-size:11px">MOD: ' + escHtml(e.model) + '</span>';
      } else if (e.file_count != null) {
        fileCell = '<span style="color:var(--muted);font-size:11px">' + e.file_count + ' FILES</span>';
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
      statusCell    = '<span class="badge ok">OK</span>';
    } else if (e.event === 'lsp_crash') {
      toolCell    = '<span class="badge error">LSP_CRASH</span>';
      fileCell    = 'RESTART #' + (e.restartCount ?? '');
      statusCell  = '<span class="badge error">FAIL</span>';
      rowCls      = 'row-error';
    } else if (e.event === 'server_start') {
      fileCell = '<span style="color:var(--muted);font-size:11px">' + escHtml(e.projectDir || '') + '</span>';
    } else if (e.event === 'log') {
      toolCell = '<span style="color:var(--muted)">LOG</span>';
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
  if (!plan) { el.innerHTML = '<span class="empty">NO ACTIVE PLAN</span>'; return; }

  const allFiles    = plan.pendingFiles   || [];
  const validated   = plan.validatedFiles || [];
  const validatedSet = new Set(validated);
  // True pending = planned but not yet validated (pendingFiles is the full set, never shrinks)
  const pending     = allFiles.filter(f => !validatedSet.has(f));
  const isScaffold  = plan.source === 'scaffold';

  const pills = isScaffold
    ? allFiles.map(f => '<span class="file-pill done" title="scaffold — valid by construction">[X] ' + escHtml(shortPath(f)) + '</span>').join('')
    : [
        ...pending.map(f   => '<span class="file-pill pending" title="needs validate_code">[ ] ' + escHtml(shortPath(f)) + '</span>'),
        ...validated.map(f => '<span class="file-pill done"    title="validated">[X] ' + escHtml(shortPath(f)) + '</span>'),
      ].join('');

  const sourceLabel = isScaffold ? 'SCAFFOLD' : 'MANUAL';
  const summary     = isScaffold
    ? allFiles.length + ' SCAFFOLD FILES'
    : validated.length + '/' + allFiles.length + ' MANUALLY VALIDATED';

  el.innerHTML = '<div class="plan-box"><div class="plan-id">PLAN ID: '
    + escHtml(plan.planId || '(UNNAMED)') + ' [' + sourceLabel + '] — ' + summary
    + '</div><div class="plan-files">' + pills + '</div></div>';
}

// ── Stats tab ─────────────────────────────────────────────────────────────
function renderStatsTable(stats) {
  const tbody = document.getElementById('stats-body');
  const rows  = Object.entries(stats).sort((a, b) => b[1].calls - a[1].calls);
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty" style="padding:12px 8px">NO CALLS YET</td></tr>'; return; }
  tbody.innerHTML = rows.map(([tool, s]) => {
    const avg      = s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0;
    const errColor = s.errors > 0 ? 'color:var(--red)' : '';
    return '<tr>'
      + '<td style="font-weight:bold">' + escHtml(tool) + '</td>'
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
  if (!entries.length) { el.innerHTML = '<span class="empty">NO VALIDATE_CODE CALLS YET</span>'; return; }
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
  if (!entries.length) { el.innerHTML = '<span class="empty">NO VALIDATE_CODE CALLS YET</span>'; return; }
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
  if (!entries.length) { el.innerHTML = '<span class="empty lsp-entry">NO EVENTS YET</span>'; return; }
  el.innerHTML = entries.map(e => {
    const cls    = (e.event.includes('failed') || e.event.includes('crash')) ? 'err' : 'ok';
    const detail = e.durationMs ? ' (' + fmtDuration(e.durationMs) + ')' : (e.error ? ': ' + e.error : '');
    return '<div class="lsp-entry ' + cls + '">'
      + fmtTime(e.ts) + ' ' + escHtml(e.event).toUpperCase() + escHtml(detail).toUpperCase()
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
      ? '<span class="empty">NONE</span>'
      : toolSchemas.map(t =>
          '<div class="tool-chip" title="' + escHtml(firstDescLine(t.description)) + '" onclick="openToolInLab(' + escHtml(JSON.stringify(t.name)) + ')">' + escHtml(t.name) + '</div>'
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

// ── Tool Lab navigation helper ────────────────────────────────────────────
// Clicking a tool chip anywhere (Overview header) routes to Tool Lab and
// selects it. Kept separate from selectToolLab so the tab switch can settle
// and ensure toolSchemas has been fetched before selection.
function openToolInLab(toolName) {
  const tab = document.querySelector('.tab[data-tab="toollab"]');
  if (tab) tab.click();
  const trySelect = () => {
    if (!toolSchemas.length) { setTimeout(trySelect, 80); return; }
    selectToolLab(JSON.stringify(toolName));
  };
  setTimeout(trySelect, 50);
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
    if (!hints.length) { list.innerHTML = '<span class="empty">NONE</span>'; return; }
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
  body.innerHTML = '<pre style="color:var(--muted)">LOADING…</pre>';
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
  if (btn) { btn.disabled = true; btn.textContent = 'FETCHING…'; }
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
    renderModuleHealth();
    renderSchemaGqlMatrix();
    renderRoutes();
    populateLiveFilePicker();
    const ts = document.getElementById('ex-last-fetched');
    if (ts) ts.textContent = 'FETCHED ' + fmtTime(new Date().toISOString());
  } catch (e) {
    document.getElementById('ex-resources').innerHTML = '<span class="explorer-error">FAILED TO LOAD: ' + escHtml(e.message) + '</span>';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'FETCH DATA'; }
}

async function fetchAnalysisData() {
  const btn = document.getElementById('ht-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'ANALYZING…'; }
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
    if (lastStatus) renderHealthRing(lastStatus);
    const ts = document.getElementById('ht-last-fetched');
    if (ts) ts.textContent = 'FETCHED ' + fmtTime(new Date().toISOString());
  } catch (e) {
    document.getElementById('ht-body').innerHTML = '<span class="explorer-error">FAILED TO LOAD: ' + escHtml(e.message) + '</span>';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'RUN ANALYSIS'; }
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
    el.innerHTML = '<span class="empty">NO RESOURCES DETECTED IN PROJECT.</span>';
    return;
  }
  el.innerHTML = Object.entries(resources).map(([name, data]) => {
    const schema = explorerData.schema?.[name];
    const propsHtml = (schema?.properties || []).map(p =>
      '<div class="ex-prop"><span class="ex-prop-name">' + escHtml(p.name) + '</span><span class="ex-prop-type">' + escHtml(p.type) + '</span></div>'
    ).join('') || '<span class="empty">NO PROPERTIES</span>';

    const gqlHtml = (data.graphql || []).map(g => {
      const op = explorerData.graphql?.[g];
      const opCls = op?.operation === 'query' ? 'ex-op-query' : 'ex-op-mutation';
      const opLabel = op?.operation === 'query' ? 'Q' : 'M';
      return '<div class="ex-layer-item"><span class="ex-op-badge ' + opCls + '">' + opLabel + '</span>' + escHtml(g.split('/').pop()) + '</div>';
    }).join('') || '<span class="empty">NONE</span>';

    const cmdHtml = (data.commands || []).map(c =>
      '<div class="ex-layer-item" style="border-color:var(--orange);color:var(--orange)">' + escHtml(c.split('/').pop()) + '</div>'
    ).join('');
    const qryHtml = (data.queries || []).map(q =>
      '<div class="ex-layer-item" style="border-color:var(--blue);color:var(--blue)">' + escHtml(q.split('/').pop()) + '</div>'
    ).join('');
    const logicHtml = (cmdHtml || qryHtml)
      ? (cmdHtml ? '<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">COMMANDS</div>' + cmdHtml + '</div>' : '')
        + (qryHtml ? '<div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">QUERIES</div>' + qryHtml + '</div>' : '')
      : '<span class="empty">NONE</span>';

    const pagesByPath = {};
    for (const pg of Object.values(explorerData.pages || {})) {
      if (pg?.path) pagesByPath[pg.path] = pg;
    }
    const pagesHtml = (data.pages || []).map(p => {
      const pageInfo = pagesByPath[p];
      if (!pageInfo) return '';
      const m = (pageInfo.method || 'get').toLowerCase();
      return '<div class="ex-layer-item" style="display:flex;align-items:center;gap:4px">'
        + '<span class="ex-method-badge ex-method-' + m + '">' + escHtml(m) + '</span>'
        + '<span style="font-size:10px;color:var(--text)">/' + escHtml(pageInfo.slug || '') + '</span>'
        + '</div>';
    }).join('') || '<span class="empty">NONE</span>';

    const missingHtml = (data.missing || []).length > 0
      ? '<div style="margin-top:8px;padding:6px 10px;background:#3c1f1e;border:1px dashed var(--red);font-size:10px;color:var(--red)">'
        + 'MISSING: ' + data.missing.join(', ')
        + '</div>'
      : '';

    return '<div class="ex-resource">'
      + '<div class="ex-resource-header">'
      + '<span class="ex-resource-name">' + escHtml(name) + '</span>'
      + '<span class="ex-resource-badge">VERTICAL SLICE</span>'
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
    el.innerHTML = '<span class="empty">NO ROUTES FOUND.</span>';
    return;
  }
  el.innerHTML = '<div class="ex-resource" style="overflow:hidden">'
    + '<div class="ex-resource-header"><span class="ex-resource-name">ROUTE &amp; LIFECYCLE FLOW</span></div>'
    + entries.map(([key, page]) => {
        const m = (page.method || 'get').toLowerCase();
        const calls = page.function_calls || [];
        const callsHtml = calls.length > 0
          ? '<div class="ex-route-calls">'
            + calls.map(c => '<div class="ex-route-call">CALLS: <span class="ex-route-call-path">' + escHtml(c.path) + '</span></div>').join('')
            + '</div>'
          : '<div class="ex-static">STATIC RENDER (NO LOGIC)</div>';
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
    ? '<div class="ex-next-step"><div class="ex-next-step-title">RECOMMENDED NEXT STEP</div><div class="ex-next-step-text">' + escHtml(a.next_step) + '</div></div>'
    : '';

  const fixOrder = a.fix_order || [];
  const fixHtml = '<div class="ex-fix-list"><div class="ex-fix-header">FIX ORDER PRIORITY</div>'
    + (fixOrder.length === 0
      ? '<div style="padding:12px 14px" class="empty">NO FILES WITH ISSUES.</div>'
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

  const orphanedFiles = a.orphaned_files || [];
  const orphanedHtml = '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">ORPHANED FILES</div><div class="ex-sidebar-body">'
    + (orphanedFiles.length === 0
      ? '<span class="empty">NO ORPHANED FILES DETECTED.</span>'
      : orphanedFiles.map(p => '<div class="ex-orphan-item">' + escHtml(p) + '</div>').join(''))
    + '</div></div>';

  const integrity = a.integrity || [];
  const integrityHtml = '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">INTEGRITY ISSUES</div><div class="ex-sidebar-body">'
    + (integrity.length === 0
      ? '<span class="empty">NO INTEGRITY ISSUES.</span>'
      : integrity.map(issue =>
          '<div class="ex-integrity-item"><div class="ex-integrity-type">' + escHtml(issue.severity || 'warning') + ' / ' + escHtml(issue.type || '') + '</div>'
          + '<div class="ex-integrity-msg">' + escHtml(issue.message || '') + '</div></div>'
        ).join(''))
    + '</div></div>';

  const blockingFiles = a.blocking_files || [];
  const blockingHtml = blockingFiles.length > 0
    ? '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">BLOCKING FILES (' + blockingFiles.length + ')</div><div class="ex-sidebar-body">'
      + blockingFiles.map(f =>
          '<div class="ex-orphan-item" style="border-color:var(--red);color:var(--red)">' + escHtml(f.path) + ' <span style="font-size:9px;opacity:.7">' + f.total + ' ERRORS</span></div>'
        ).join('')
      + '</div></div>'
    : '';

  const diffHtml = a.diff_from_last_run
    ? '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">DIFF FROM LAST RUN</div><div class="ex-sidebar-body">'
      + '<div style="font-size:11px;color:var(--text);line-height:1.8;text-transform:uppercase;">'
      + 'ERR DELTA: <span style="color:' + (a.diff_from_last_run.error_delta > 0 ? 'var(--red)' : a.diff_from_last_run.error_delta < 0 ? 'var(--green)' : 'var(--muted)') + '">'
      + (a.diff_from_last_run.error_delta > 0 ? '+' : '') + a.diff_from_last_run.error_delta + '</span><br>'
      + 'WARN DELTA: <span style="color:' + (a.diff_from_last_run.warning_delta > 0 ? 'var(--red)' : a.diff_from_last_run.warning_delta < 0 ? 'var(--green)' : 'var(--muted)') + '">'
      + (a.diff_from_last_run.warning_delta > 0 ? '+' : '') + a.diff_from_last_run.warning_delta + '</span>'
      + '</div></div></div>'
    : '';

  // Also show modules/config if explorer data is loaded
  let modulesHtml = '';
  if (explorerData) {
    const modules = explorerData.project?.modules || [];
    const assets = explorerData.assets || [];
    if (modules.length || assets.length) {
      modulesHtml = '<div class="ex-sidebar-panel"><div class="ex-sidebar-title">MODULES &amp; ASSETS</div><div class="ex-sidebar-body">'
        + '<div class="ex-module-grid" style="margin-bottom:8px">'
        + modules.map(m => '<div class="ex-module-item"><span class="ex-module-dot"></span>' + escHtml(m) + '</div>').join('')
        + '</div>'
        + (assets.length > 0
          ? '<div style="font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">ASSETS</div>'
            + assets.map(a => '<div class="ex-asset-item">' + escHtml(a) + '</div>').join('')
          : '')
        + '</div></div>';
    }
  }

  el.innerHTML = statsHtml + nextStepHtml
    + '<div class="ex-health-grid">'
    + '<div>' + fixHtml + '</div>'
    + '<div>' + orphanedHtml + integrityHtml + blockingHtml + diffHtml + modulesHtml + '</div>'
    + '</div>';
}

// ── Tool Insights tab ───────────────────────────────────────────────────
let insightsLoaded = false;
let hintsList = null;
let knowledgeData = null;

async function fetchInsightsData() {
  const tsEl = document.getElementById('ti-last-fetched');
  tsEl.textContent = 'refreshing…';

  // Fetch hints and knowledge in parallel (cached after first load)
  if (!hintsList) {
    try {
      const r = await fetch(BASE + '/api/hints');
      const d = await r.json();
      hintsList = d.hints || [];
    } catch { hintsList = []; }
  }
  if (!knowledgeData) {
    try {
      const r = await fetch(BASE + '/api/knowledge');
      const d = await r.json();
      knowledgeData = d.knowledge || {};
    } catch { knowledgeData = {}; }
  }

  renderInsights();
  insightsLoaded = true;
  tsEl.textContent = fmtTime(Date.now());
}

function renderInsights() {
  if (!lastStatus) return;
  renderStuckAlert(lastStatus);
  renderEffectiveness(lastStatus);
  renderHintEffectiveness(lastStatus);
  renderDiagDiff(lastStatus);
  renderKnowledgeGaps(lastStatus);
  renderWorkflowPatterns();
  renderScaffoldQuality(lastStatus);
  renderPipelineInspector(lastStatus);
}

function renderStuckAlert(d) {
  const el = document.getElementById('ti-stuck-alert');
  const stuck = (d.fileHistory || []).filter(f => (f.consecutiveNonDecreasing ?? 0) >= 3 && f.lastErrorCount > 0);
  if (!stuck.length) { el.innerHTML = ''; return; }

  el.innerHTML = '<div class="ti-alert">'
    + '<div class="ti-alert-header">Stuck Files — persistent errors across 3+ validation calls</div>'
    + stuck.map(f =>
      '<div class="ti-alert-item">'
      + '<span class="ti-alert-count">' + f.lastErrorCount + ' error' + (f.lastErrorCount > 1 ? 's' : '') + '</span>'
      + '<span>' + escHtml(shortPath(f.path)) + '</span>'
      + '<span class="ti-alert-file">' + f.calls + ' calls, non-decreasing ' + (f.consecutiveNonDecreasing ?? 0) + 'x</span>'
      + '</div>'
    ).join('')
    + '</div>';
}

function renderEffectiveness(d) {
  const el = document.getElementById('ti-effectiveness');
  const freq = d.checkFrequency || {};
  const eff = d.checkEffectiveness || {};
  const checks = Object.keys(freq);
  if (!checks.length) {
    el.innerHTML = '<span class="ti-empty">No validate_code calls yet — effectiveness data appears after files are validated multiple times.</span>';
    return;
  }

  const rows = checks.map(check => {
    const fired = freq[check] || 0;
    const fixed = eff[check]?.fixed || 0;
    const stuck = eff[check]?.stuck || 0;
    const transitions = fixed + stuck;
    const pct = transitions > 0 ? Math.round((fixed / transitions) * 100) : -1;
    return { check, fired, fixed, stuck, transitions, pct };
  }).sort((a, b) => b.fired - a.fired);

  el.innerHTML = '<table class="ti-eff-table">'
    + '<thead><tr><th>Check</th><th>Fired</th><th>Fixed</th><th>Stuck</th><th style="min-width:80px">Effectiveness</th><th></th></tr></thead>'
    + '<tbody>'
    + rows.map(r => {
      const pctCls = r.pct < 0 ? 'na' : r.pct >= 60 ? 'good' : r.pct >= 30 ? 'mid' : 'bad';
      const pctText = r.pct < 0 ? '—' : r.pct + '%';
      const barCell = r.transitions > 0
        ? '<td><div class="ti-eff-bar"><div class="fixed" style="width:' + (r.fixed / r.transitions * 100).toFixed(1) + '%"></div><div class="stuck" style="width:' + (r.stuck / r.transitions * 100).toFixed(1) + '%"></div></div></td>'
        : '<td><span style="color:var(--muted);font-size:10px;font-style:italic">awaiting retries</span></td>';
      return '<tr>'
        + '<td>' + escHtml(r.check) + '</td>'
        + '<td style="color:var(--muted)">' + r.fired + '</td>'
        + '<td style="color:var(--green)">' + r.fixed + '</td>'
        + '<td style="color:var(--red)">' + r.stuck + '</td>'
        + barCell
        + '<td><span class="ti-eff-pct ' + pctCls + '">' + pctText + '</span></td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

function renderKnowledgeGaps(d) {
  const el = document.getElementById('ti-gaps');
  const freq = d.checkFrequency || {};
  const checks = Object.keys(freq).filter(c => freq[c] >= 1);
  if (!checks.length) { el.innerHTML = '<span class="ti-empty">No checks fired yet.</span>'; return; }

  const hints = new Set(hintsList || []);
  const knowledgeChecks = new Set();
  if (knowledgeData?.checks) {
    for (const entry of Object.values(knowledgeData.checks)) {
      if (entry?.check) knowledgeChecks.add(entry.check);
    }
  }
  if (Array.isArray(knowledgeData)) {
    for (const entry of knowledgeData) {
      if (entry?.check) knowledgeChecks.add(entry.check);
    }
  }

  const rows = checks.map(check => {
    const hasHint = hints.has(check) || hints.has(check.replace('pos-supervisor:', ''));
    const hasKnowledge = knowledgeChecks.has(check);
    const gapCount = (hasHint ? 0 : 1) + (hasKnowledge ? 0 : 1);
    return { check, fired: freq[check], hasHint, hasKnowledge, gapCount };
  }).filter(r => r.gapCount > 0).sort((a, b) => b.fired - a.fired);

  if (!rows.length) {
    el.innerHTML = '<span class="ti-empty" style="color:var(--green)">All fired checks have hint files and knowledge entries.</span>';
    return;
  }

  el.innerHTML = rows.map(r =>
    '<div class="ti-gap-item">'
    + '<span class="ti-gap-check">' + escHtml(r.check) + '</span>'
    + '<span class="ti-gap-tags">'
    + '<span class="ti-gap-tag ' + (r.hasHint ? 'has' : 'miss') + '">hint: ' + (r.hasHint ? 'yes' : 'no') + '</span>'
    + '<span class="ti-gap-tag ' + (r.hasKnowledge ? 'has' : 'miss') + '">knowledge: ' + (r.hasKnowledge ? 'yes' : 'no') + '</span>'
    + '</span>'
    + '<span class="ti-gap-count">' + r.fired + 'x</span>'
    + '</div>'
  ).join('');
}

const EXPECTED_TRANSITIONS = new Set([
  'scaffold > validate_intent',
  'validate_intent > validate_code',
  'validate_intent > scaffold',
  'scaffold > validate_code',
  'enrich_error > validate_code',
  'validate_code > enrich_error',
  'domain_guide > validate_code',
  'project_map > scaffold',
  'project_map > analyze_project',
]);

const RETRY_TRANSITIONS = new Set([
  'validate_code > validate_code',
]);

function renderWorkflowPatterns() {
  const el = document.getElementById('ti-workflow');
  const seen = new Set();
  const entries = [...allLogEntries, ...liveEntries]
    .filter(e => {
      if (e.event !== 'tool_call' || !e.tool) return false;
      const key = e.ts + '|' + e.tool;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.ts > b.ts ? 1 : -1));
  if (entries.length < 2) { el.innerHTML = '<span class="ti-empty">Need at least 2 tool calls to show patterns.</span>'; return; }

  const transitions = {};
  for (let i = 1; i < entries.length; i++) {
    const key = entries[i - 1].tool + ' > ' + entries[i].tool;
    transitions[key] = (transitions[key] || 0) + 1;
  }

  const rows = Object.entries(transitions).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;

  el.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;overflow:hidden">'
    + rows.map(([label, count]) => {
      const cls = RETRY_TRANSITIONS.has(label) ? 'retry'
        : EXPECTED_TRANSITIONS.has(label) ? 'expected'
        : 'skip';
      return '<div class="ti-wf-row">'
        + '<span class="ti-wf-label">' + escHtml(label) + '</span>'
        + '<span class="ti-wf-bar-track"><span class="ti-wf-bar-fill ' + cls + '" style="width:' + (count / max * 100).toFixed(1) + '%"></span></span>'
        + '<span class="ti-wf-count">' + count + '</span>'
        + '</div>';
    }).join('')
    + '</div>';
}

function renderScaffoldQuality(d) {
  const el = document.getElementById('ti-scaffolds');
  const runs = d.scaffoldRuns || [];
  if (!runs.length) { el.innerHTML = '<span class="ti-empty">No scaffold calls in this session.</span>'; return; }

  const fileHistory = d.fileHistory || [];
  const fhMap = {};
  for (const f of fileHistory) fhMap[f.path] = f;

  el.innerHTML = runs.map((run, idx) => {
    const files = run.written?.length ? run.written : run.files || [];
    let clean = 0, errors = 0, unvalidated = 0;
    const fileRows = files.map(fp => {
      const fh = fhMap[fp];
      let badge, cls;
      if (!fh) {
        unvalidated++;
        badge = 'not validated';
        cls = 'badge info';
      } else if (fh.lastErrorCount > 0) {
        errors++;
        badge = fh.lastErrorCount + ' error' + (fh.lastErrorCount > 1 ? 's' : '');
        cls = 'badge error';
      } else {
        clean++;
        badge = 'clean';
        cls = 'badge ok';
      }
      return '<div class="ti-scaffold-file">'
        + '<span class="' + cls + '">' + badge + '</span>'
        + '<span class="path">' + escHtml(fp) + '</span>'
        + '</div>';
    });

    const total = files.length;
    const validated = clean + errors;
    const pct = validated > 0 ? Math.round(clean / validated * 100) : null;
    const pctColor = pct === null ? 'var(--muted)' : pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
    const pctLabel = pct === null ? 'PENDING' : pct + '%';

    return '<div class="ti-scaffold-card">'
      + '<div class="ti-scaffold-header">'
      + '<span class="ti-scaffold-title">' + escHtml(run.model || 'unknown') + ' (' + escHtml(run.type || '?') + ')</span>'
      + '<span class="ti-scaffold-meta">' + total + ' files &middot; ' + fmtTime(run.ts) + '</span>'
      + '</div>'
      + '<div class="ti-scaffold-files">' + fileRows.join('') + '</div>'
      + '<div class="ti-scaffold-quality">'
      + '<span>First-pass quality: <b style="color:' + pctColor + '">' + pctLabel + '</b></span>'
      + '<span>Clean: ' + clean + '</span>'
      + '<span style="color:var(--red)">Errors: ' + errors + '</span>'
      + '<span style="color:var(--muted)">Unvalidated: ' + unvalidated + '</span>'
      + '</div>'
      + '</div>';
  }).join('');
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
        : '<option value="">NO ENVS FOUND</option>';
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
  const label = command === 'data-clean' ? 'Exec Data Clean' : 'Exec Deploy';
  const cmdStr = command === 'data-clean'
    ? 'pos-cli data clean --auto-confirm --include-schema ' + env
    : 'pos-cli deploy ' + env;

  btn.disabled = true;
  btn.textContent = 'RUNNING…';
  resultEl.style.display = 'block';
  bannerEl.className = 'cli-result-banner running';
  statusEl.textContent = 'RUNNING: ' + cmdStr;
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
      statusEl.textContent = 'COMPLETED SUCCESSFULLY';
      const parts = [];
      if (d.output && d.output.trim()) parts.push(d.output.trim());
      if (d.stderr && d.stderr.trim()) parts.push(d.stderr.trim());
      preEl.textContent = parts.length ? parts.join('\\n') : 'COMMAND FINISHED WITH NO OUTPUT.';
    } else {
      bannerEl.className = 'cli-result-banner fail';
      statusEl.textContent = 'FAILED';
      const parts = [d.error || 'UNKNOWN ERROR'];
      if (d.output && d.output.trim()) parts.push('STDOUT:\\n' + d.output.trim());
      if (d.stderr && d.stderr.trim()) parts.push('STDERR:\\n' + d.stderr.trim());
      preEl.textContent = parts.join('\\n\\n');
    }
  } catch (e) {
    const dur = fmtDuration(Date.now() - t0);
    tsEl.textContent = fmtTime(Date.now()) + ' (' + dur + ')';
    bannerEl.className = 'cli-result-banner fail';
    statusEl.textContent = 'REQUEST FAILED';
    preEl.textContent = e.message;
  }
  btn.disabled = false;
  btn.textContent = label;
}

// ── A2: Hint Effectiveness ───────────────────────────────────────────────
function renderHintEffectiveness(d) {
  const el = document.getElementById('ti-hint-eff');
  if (!el) return;
  const he = d.hintEffectiveness || {};
  const rows = Object.entries(he)
    .filter(([, v]) => (v.hinted || 0) >= 1)
    .map(([check, v]) => {
      const hinted = v.hinted || 0;
      const fixed = v.fixedAfterHint || 0;
      const pct = hinted > 0 ? Math.round((fixed / hinted) * 100) : 0;
      return { check, hinted, fixed, pct };
    })
    .sort((a, b) => b.hinted - a.hinted);

  if (!rows.length) {
    el.innerHTML = '<span class="ti-empty">NO CHECKS HAVE BEEN HINTED YET.</span>';
    return;
  }

  el.innerHTML = '<table class="he-table">'
    + '<thead><tr><th>CHECK</th><th>TIMES HINTED</th><th>FIXED AFTER HINT</th><th>EFFECTIVENESS</th></tr></thead>'
    + '<tbody>'
    + rows.map(r => {
      const pctCls = r.pct >= 60 ? 'good' : r.pct >= 30 ? 'mid' : 'bad';
      return '<tr>'
        + '<td style="font-weight:bold">' + escHtml(r.check) + '</td>'
        + '<td style="color:var(--muted)">' + r.hinted + '</td>'
        + '<td style="color:var(--green)">' + r.fixed + '</td>'
        + '<td><span class="he-pct ' + pctCls + '">' + r.pct + '%</span></td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

// ── B3: Diagnostic Diff ─────────────────────────────────────────────────
function renderDiagDiff(d) {
  const el = document.getElementById('ti-diag-diff');
  if (!el) return;
  const fh = (d.fileHistory || []).filter(f => f.calls > 1 && (f.prevChecks || f.lastChecks));

  if (!fh.length) {
    el.innerHTML = '<span class="ti-empty">NO FILES WITH MULTIPLE VALIDATIONS YET.</span>';
    return;
  }

  el.innerHTML = fh.map(f => {
    const prev = new Set(f.prevChecks || []);
    const curr = new Set(f.lastChecks || []);
    const allChecks = new Set([...prev, ...curr]);
    const checks = [...allChecks].sort().map(c => {
      if (prev.has(c) && !curr.has(c)) return '<span class="dd-check fixed">[FIXED] ' + escHtml(c) + '</span>';
      if (!prev.has(c) && curr.has(c)) return '<span class="dd-check new">[NEW] ' + escHtml(c) + '</span>';
      return '<span class="dd-check unchanged">[=] ' + escHtml(c) + '</span>';
    });
    return '<div class="dd-file">'
      + '<div class="dd-file-header">' + escHtml(shortPath(f.path)) + ' <span style="color:var(--muted);font-weight:normal">(' + f.calls + ' CALLS)</span></div>'
      + '<div class="dd-file-body">' + checks.join('') + '</div>'
      + '</div>';
  }).join('');
}

// ── A3: False Positive Manager ──────────────────────────────────────────
let suppressionsLoaded = false;

async function fetchSuppressions() {
  try {
    const r = await fetch(BASE + '/api/suppressions');
    const d = await r.json();
    renderSuppressions(d.suppressions || []);
    suppressionsLoaded = true;
  } catch (e) {
    document.getElementById('fp-list').innerHTML = '<span class="empty">FAILED TO LOAD: ' + escHtml(e.message) + '</span>';
  }
}

function renderSuppressions(suppressions) {
  const el = document.getElementById('fp-list');
  if (!el) return;
  if (!suppressions.length) {
    el.innerHTML = '<span class="empty">NO SUPPRESSIONS CONFIGURED.</span>';
    return;
  }
  el.innerHTML = '<div class="fp-list">'
    + suppressions.map((s, i) =>
      '<div class="fp-item">'
      + '<span class="fp-item-check">' + escHtml(s.check) + '</span>'
      + (s.file_pattern ? '<span class="fp-item-pattern">' + escHtml(s.file_pattern) + '</span>' : '')
      + (s.reason ? '<span class="fp-item-reason">' + escHtml(s.reason) + '</span>' : '')
      + '<button class="danger" onclick="removeSuppression(' + i + ', ' + escHtml(JSON.stringify(JSON.stringify(s.check))) + ')">REMOVE</button>'
      + '</div>'
    ).join('')
    + '</div>';
}

async function addSuppression() {
  const selected = document.getElementById('fp-check').value.trim();
  const custom = document.getElementById('fp-check-custom').value.trim();
  const check = custom || selected;
  if (!check) return;
  const pattern = document.getElementById('fp-pattern').value.trim() || undefined;
  const reason = document.getElementById('fp-reason').value.trim() || undefined;
  try {
    await fetch(BASE + '/api/suppressions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check, file_pattern: pattern, reason }),
    });
    document.getElementById('fp-check').value = '';
    document.getElementById('fp-check-custom').value = '';
    document.getElementById('fp-pattern').value = '';
    document.getElementById('fp-reason').value = '';
    fetchSuppressions();
  } catch {}
}

let allCheckNames = null;
async function ensureAllCheckNames() {
  if (allCheckNames) return allCheckNames;
  try {
    const r = await fetch(BASE + '/api/hints');
    const d = await r.json();
    allCheckNames = Array.isArray(d.hints) ? d.hints.slice().sort() : [];
  } catch { allCheckNames = []; }
  return allCheckNames;
}

async function populateSuppressionChecks() {
  const sel = document.getElementById('fp-check');
  if (!sel) return;
  const freq = (lastStatus && lastStatus.checkFrequency) || {};
  const seen = Object.keys(freq);
  const all = await ensureAllCheckNames();
  const current = sel.value;

  const seenSet = new Set(seen);
  const seenSorted = seen.slice().sort((a, b) => (freq[b] || 0) - (freq[a] || 0));
  const rest = all.filter(n => !seenSet.has(n));

  let html = '<option value="">— SELECT A CHECK —</option>';
  if (seenSorted.length) {
    html += '<optgroup label="SEEN THIS SESSION">'
      + seenSorted.map(n => '<option value="' + escHtml(n) + '">' + escHtml(n) + ' (' + (freq[n] || 0) + ')</option>').join('')
      + '</optgroup>';
  }
  if (rest.length) {
    html += '<optgroup label="' + (seenSorted.length ? 'ALL OTHER CHECKS' : 'ALL CHECKS') + '">'
      + rest.map(n => '<option value="' + escHtml(n) + '">' + escHtml(n) + '</option>').join('')
      + '</optgroup>';
  }
  sel.innerHTML = html;
  if (current) sel.value = current;
}

async function removeSuppression(idx, check) {
  try {
    await fetch(BASE + '/api/suppressions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: JSON.parse(check), action: 'remove' }),
    });
    fetchSuppressions();
  } catch {}
}

// ── C1: Module Integration Health ───────────────────────────────────────
const moduleInfoCache = new Map();

async function fetchModuleInfo(name) {
  if (moduleInfoCache.has(name)) return moduleInfoCache.get(name);
  try {
    const r = await fetch(BASE + '/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'module_info', params: { module_name: name } }),
    });
    const d = await r.json();
    const info = d.result || {};
    moduleInfoCache.set(name, info);
    return info;
  } catch {
    return {};
  }
}

async function renderModuleHealth() {
  const section = document.getElementById('ex-module-health-section');
  const el = document.getElementById('ex-module-health');
  if (!section || !el || !explorerData) return;

  section.style.display = '';
  const modules = explorerData.project?.modules || [];
  if (!modules.length) {
    el.innerHTML = '<span class="empty">NO MODULES IN PROJECT. PLACE MODULES UNDER <code>modules/&lt;name&gt;/</code>.</span>';
    return;
  }

  el.innerHTML = '<span class="empty">LOADING MODULE DETAILS…</span>';
  const infos = await Promise.all(modules.map(fetchModuleInfo));
  const partials = explorerData.partials || {};

  el.innerHTML = '<div class="mih-grid">'
    + modules.map((mod, i) => {
      const info = infos[i] || {};
      const partialList   = info.partials   || [];
      const commandList   = info.commands   || [];
      const queryList     = info.queries    || [];
      const schemaList    = info.schemas    || [];
      const graphqlList   = info.graphql    || [];
      const pagesList     = info.pages      || [];

      const modPrefix = 'modules/' + mod + '/';
      const modRenderedBy = Object.entries(partials)
        .filter(([p]) => p.startsWith(modPrefix))
        .map(([p, v]) => ({ path: p, callers: (v.rendered_by || []) }))
        .filter(x => x.callers.length > 0);

      const callersHtml = modRenderedBy.length > 0
        ? '<div class="mih-callers"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">USED BY:</div>'
          + modRenderedBy.slice(0, 6).map(c =>
            '<div class="mih-caller">' + escHtml(shortPath(c.path)) + ' <span style="color:var(--blue)">(' + c.callers.length + ')</span></div>'
          ).join('')
          + (modRenderedBy.length > 6 ? '<div class="mih-caller" style="color:var(--muted)">…AND ' + (modRenderedBy.length - 6) + ' MORE</div>' : '')
          + '</div>'
        : '<div class="mih-callers"><div style="font-size:10px;color:var(--muted)">NO EXTERNAL CALLERS DETECTED</div></div>';

      const version = info.version || '—';
      const displayName = info.display_name && info.display_name !== mod ? ' · ' + info.display_name : '';

      return '<div class="mih-card">'
        + '<div class="mih-card-header">' + escHtml(mod) + '<span style="font-size:10px;color:var(--muted);margin-left:8px;font-weight:normal">V ' + escHtml(version) + escHtml(displayName) + '</span></div>'
        + '<div class="mih-card-body">'
        + '<div class="mih-stat">PARTIALS: <span class="value">'  + partialList.length + '</span></div>'
        + '<div class="mih-stat">COMMANDS: <span class="value">'  + commandList.length + '</span></div>'
        + '<div class="mih-stat">QUERIES: <span class="value">'   + queryList.length   + '</span></div>'
        + '<div class="mih-stat">SCHEMAS: <span class="value">'   + schemaList.length  + '</span></div>'
        + '<div class="mih-stat">GRAPHQL: <span class="value">'   + graphqlList.length + '</span></div>'
        + '<div class="mih-stat">PAGES: <span class="value">'     + pagesList.length   + '</span></div>'
        + callersHtml
        + '</div></div>';
    }).join('')
    + '</div>';
}

// ── C2: Schema-GraphQL Consistency Matrix ───────────────────────────────
function renderSchemaGqlMatrix() {
  const section = document.getElementById('ex-schema-gql-section');
  const el = document.getElementById('ex-schema-gql');
  if (!section || !el || !explorerData) return;

  section.style.display = '';
  const schemas = explorerData.schema || {};
  const schemaNames = Object.keys(schemas);
  if (!schemaNames.length) {
    el.innerHTML = '<span class="empty">NO SCHEMAS IN PROJECT. PLACE SCHEMAS UNDER <code>app/schema/*.yml</code>.</span>';
    return;
  }

  const graphql = explorerData.graphql || {};
  const gqlEntries = Object.entries(graphql);

  el.innerHTML = '<table class="sgm-table">'
    + '<thead><tr><th>SCHEMA</th><th>PROPERTIES</th><th>QUERIES</th><th>MUTATIONS</th></tr></thead>'
    + '<tbody>'
    + schemaNames.map(name => {
      const schema = schemas[name];
      const props = (schema.properties || []).map(p => p.name).join(', ') || '—';

      // Find graphql ops referencing this schema
      const queries = gqlEntries
        .filter(([, g]) => g.operation === 'query' && (g.table === name || (g.path || '').includes(name)))
        .map(([k]) => k.split('/').pop());
      const mutations = gqlEntries
        .filter(([, g]) => g.operation === 'mutation' && (g.table === name || (g.path || '').includes(name)))
        .map(([k]) => k.split('/').pop());

      const qHtml = queries.length
        ? '<div class="sgm-ops">' + queries.map(q => '<span class="sgm-op query">' + escHtml(q) + '</span>').join('') + '</div>'
        : '<span class="sgm-none">NONE</span>';
      const mHtml = mutations.length
        ? '<div class="sgm-ops">' + mutations.map(m => '<span class="sgm-op mutation">' + escHtml(m) + '</span>').join('') + '</div>'
        : '<span class="sgm-none">NONE</span>';

      return '<tr>'
        + '<td style="font-weight:bold">' + escHtml(name) + '</td>'
        + '<td style="color:var(--muted);font-size:10px">' + escHtml(props) + '</td>'
        + '<td>' + qHtml + '</td>'
        + '<td>' + mHtml + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

// ── Analytics tab ────────────────────────────────────────────────────────
let analyticsData = null;

async function fetchAnalytics() {
  const tsEl = document.getElementById('an-last-fetched');
  tsEl.textContent = 'refreshing...';

  try {
    const [statsR, scorecardsR, sessionsR, recsR, bigramsR, ruleScoresR, suggestedR] = await Promise.all([
      fetch(BASE + '/api/analytics/stats').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(BASE + '/api/analytics/scorecards?min_cohort=1').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(BASE + '/api/analytics/sessions').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(BASE + '/api/analytics/recommendations').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(BASE + '/api/analytics/bigrams').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(BASE + '/api/analytics/rule-scores?min_emitted=1').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(BASE + '/api/analytics/suggested-rules').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    analyticsData = {
      stats: statsR,
      scorecards: scorecardsR?.scorecards || [],
      sessions: sessionsR?.sessions || [],
      recommendations: recsR?.recommendations || [],
      bigrams: bigramsR?.bigrams || [],
      ruleScores: ruleScoresR?.scores || [],
      suggestedRules: suggestedR?.suggestions || [],
    };

    renderAnalyticsStats();
    renderAnalyticsScorecards();
    renderAnalyticsRecommendations();
    renderAnalyticsSessions();
    renderAnalyticsBigrams();
    renderRuleScores();
    renderSuggestedRules();
    tsEl.textContent = fmtTime(Date.now());
  } catch (e) {
    tsEl.textContent = 'error: ' + e.message;
    document.getElementById('an-stats').innerHTML = '<span class="an-empty">Analytics store not available (requires Bun runtime).</span>';
  }
}

async function rebuildAnalytics() {
  const btn = document.getElementById('an-rebuild-btn');
  btn.disabled = true;
  btn.textContent = 'REBUILDING...';
  try {
    const r = await fetch(BASE + '/api/analytics/rebuild', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      btn.textContent = 'REBUILT (' + d.sessions + ' sessions, ' + d.events + ' events)';
      setTimeout(() => { btn.textContent = 'REBUILD DB'; btn.disabled = false; }, 3000);
      await fetchAnalytics();
    } else {
      btn.textContent = 'FAILED: ' + (d.error || 'unknown');
      setTimeout(() => { btn.textContent = 'REBUILD DB'; btn.disabled = false; }, 5000);
    }
  } catch (e) {
    btn.textContent = 'FAILED';
    setTimeout(() => { btn.textContent = 'REBUILD DB'; btn.disabled = false; }, 3000);
  }
}

function renderAnalyticsStats() {
  const el = document.getElementById('an-stats');
  const s = analyticsData?.stats;
  if (!s) {
    el.innerHTML = '<span class="an-empty">Analytics store not available.</span>';
    return;
  }
  el.innerHTML = [
    { label: 'Events', value: s.events ?? 0 },
    { label: 'Diagnostics', value: s.diagnostics ?? 0 },
    { label: 'Sessions', value: s.sessions ?? 0 },
    { label: 'Windows', value: s.windows ?? 0 },
    { label: 'Outcomes', value: s.outcomes ?? 0 },
  ].map(d => '<div class="an-stat"><div class="label">' + d.label + '</div><div class="value">' + d.value + '</div></div>').join('');
}

function ciBar(rate, cssClass) {
  if (!rate || rate.mean === 0 && rate.lower95 === 0 && rate.upper95 === 0) {
    return '<span style="color:var(--muted);font-size:10px">--</span>';
  }
  const pct = (rate.mean * 100).toFixed(0);
  const lo = (rate.lower95 * 100).toFixed(1);
  const hi = (rate.upper95 * 100).toFixed(1);
  const meanPx = (rate.mean * 100).toFixed(1);
  const cls = cssClass === 'auto'
    ? (rate.mean >= 0.6 ? 'good' : rate.mean >= 0.3 ? 'mid' : 'bad')
    : cssClass;
  const invCls = cssClass === 'auto-inv'
    ? (rate.mean <= 0.1 ? 'good' : rate.mean <= 0.3 ? 'mid' : 'bad')
    : cls;
  const actualCls = cssClass === 'auto-inv' ? invCls : cls;
  return '<div class="an-ci-bar" title="' + lo + '% – ' + hi + '%">'
    + '<div class="an-ci-track">'
    + '<div class="an-ci-fill ' + actualCls + '" style="left:' + lo + '%;width:' + ((rate.upper95 - rate.lower95) * 100).toFixed(1) + '%"></div>'
    + '<div class="an-ci-marker" style="left:' + meanPx + '%"></div>'
    + '</div>'
    + '<span class="an-ci-val ' + actualCls + '">' + pct + '%</span>'
    + '</div>';
}

function renderAnalyticsScorecards() {
  const el = document.getElementById('an-scorecards');
  const cards = analyticsData?.scorecards || [];
  if (!cards.length) {
    el.innerHTML = '<span class="an-empty">No scorecard data yet. Rebuild the database after sessions accumulate.</span>';
    return;
  }

  el.innerHTML = '<table class="an-sc-table">'
    + '<thead><tr>'
    + '<th>Check</th><th>Emitted</th><th>Sample</th>'
    + '<th style="min-width:180px">Resolution Rate</th>'
    + '<th style="min-width:180px">Mislead Rate</th>'
    + '<th style="min-width:180px">Adoption Rate</th>'
    + '<th>Collateral</th>'
    + '</tr></thead><tbody>'
    + cards.map(c => {
      const resCls = c.resolution_rate.mean >= 0.6 ? 'good' : c.resolution_rate.mean >= 0.3 ? 'mid' : 'bad';
      const misCls = c.mislead_rate.mean <= 0.1 ? 'good' : c.mislead_rate.mean <= 0.3 ? 'mid' : 'bad';
      const adoptCls = c.adoption_rate.mean >= 0.6 ? 'good' : c.adoption_rate.mean >= 0.3 ? 'mid' : 'neutral';
      return '<tr>'
        + '<td style="color:var(--text);font-weight:bold;text-transform:uppercase">' + escHtml(c.check) + '</td>'
        + '<td style="color:var(--muted)">' + c.emitted + '</td>'
        + '<td style="color:var(--muted)">' + c.sample_size + '</td>'
        + '<td>' + ciBar(c.resolution_rate, resCls) + '</td>'
        + '<td>' + ciBar(c.mislead_rate, misCls) + '</td>'
        + '<td>' + ciBar(c.adoption_rate, adoptCls) + '</td>'
        + '<td style="color:' + (c.avg_collateral > 1 ? 'var(--red)' : 'var(--muted)') + '">'
        + (c.avg_collateral > 0 ? c.avg_collateral.toFixed(1) : '--') + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

function renderAnalyticsRecommendations() {
  const el = document.getElementById('an-recommendations');
  const recs = analyticsData?.recommendations || [];
  if (!recs.length) {
    el.innerHTML = '<span class="an-empty">No checks above the mislead threshold. All hints are performing within acceptable bounds.</span>';
    return;
  }

  el.innerHTML = recs.map(r =>
    '<div class="an-rec-item">'
    + '<span class="an-rec-icon">[!]</span>'
    + '<div class="an-rec-body">'
    + '<div class="an-rec-check">' + escHtml(r.check) + '</div>'
    + '<div class="an-rec-text">' + escHtml(r.recommendation) + '</div>'
    + '</div>'
    + '<span class="an-rec-rate">' + (r.mislead_rate * 100).toFixed(0) + '% MISLEAD</span>'
    + '</div>'
  ).join('');
}

function renderAnalyticsSessions() {
  const el = document.getElementById('an-sessions');
  const sessions = analyticsData?.sessions || [];
  if (!sessions.length) {
    el.innerHTML = '<span class="an-empty">No sessions recorded yet.</span>';
    return;
  }

  el.innerHTML = '<table class="an-sess-table">'
    + '<thead><tr>'
    + '<th>Session</th><th>Start</th><th>Events</th><th>Tools</th>'
    + '<th>VC Calls</th><th>Intent</th><th>Diagnostics</th>'
    + '<th>Resolved</th><th>Regressed</th><th>Net</th>'
    + '</tr></thead><tbody>'
    + sessions.map(s => {
      const net = (s.outcomes_resolved ?? 0) - (s.outcomes_regressed ?? 0);
      const netCls = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--muted)';
      const netSign = net > 0 ? '+' : '';
      return '<tr>'
        + '<td><span class="an-sess-id">' + escHtml((s.session_id || '').slice(0, 8)) + '</span></td>'
        + '<td class="ts">' + fmtTime(s.first_event) + '</td>'
        + '<td style="color:var(--muted)">' + (s.event_count ?? 0) + '</td>'
        + '<td style="color:var(--muted)">' + (s.tool_calls ?? 0) + '</td>'
        + '<td style="color:var(--blue)">' + (s.validate_code_calls ?? 0) + '</td>'
        + '<td>' + (s.used_validate_intent ? dot('green') : dot('red')) + '</td>'
        + '<td style="color:var(--muted)">' + (s.diagnostics_emitted ?? 0) + '</td>'
        + '<td style="color:var(--green)">' + (s.outcomes_resolved ?? 0) + '</td>'
        + '<td style="color:var(--red)">' + (s.outcomes_regressed ?? 0) + '</td>'
        + '<td style="color:' + netCls + ';font-weight:bold">' + netSign + net + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

function renderAnalyticsBigrams() {
  const el = document.getElementById('an-bigrams');
  const bigrams = analyticsData?.bigrams || [];
  if (!bigrams.length) {
    el.innerHTML = '<span class="an-empty">No tool sequence data yet.</span>';
    return;
  }

  const top = bigrams.slice(0, 20);
  el.innerHTML = top.map(b =>
    '<div class="an-bigram-row">'
    + '<span class="an-bigram-seq">' + escHtml(b.bigram[0]) + ' <span class="an-bigram-arrow">-></span> ' + escHtml(b.bigram[1]) + '</span>'
    + '<span class="an-bigram-metric"><b>' + b.count + '</b>x</span>'
    + '<span class="an-bigram-metric">lift <b>' + b.lift.toFixed(1) + '</b></span>'
    + '<span class="an-bigram-metric">conf <b>' + (b.confidence * 100).toFixed(0) + '%</b></span>'
    + '</div>'
  ).join('');
}

function renderRuleScores() {
  const el = document.getElementById('an-rule-scores');
  const scores = analyticsData?.ruleScores || [];
  if (!scores.length) {
    el.innerHTML = '<span class="an-empty">No rule performance data yet. Rebuild the analytics database after sessions with rule-matched diagnostics accumulate.</span>';
    return;
  }

  el.innerHTML = '<table class="an-sc-table">'
    + '<thead><tr>'
    + '<th>Rule</th><th>Check</th><th>Emitted</th><th>Outcomes</th>'
    + '<th>Resolved</th><th>Regressed</th><th>Adopted</th>'
    + '<th>Effectiveness</th><th>Status</th>'
    + '</tr></thead><tbody>'
    + scores.map(s => {
      const effPct = (s.effectiveness * 100).toFixed(0);
      const effCls = s.effectiveness >= 0.5 ? 'good' : s.effectiveness >= 0.15 ? 'mid' : 'bad';
      return '<tr>'
        + '<td style="color:var(--text);font-weight:bold;font-size:10px;text-transform:uppercase">' + escHtml(s.rule_id) + '</td>'
        + '<td style="color:var(--muted)">' + escHtml(s.check) + '</td>'
        + '<td style="color:var(--muted)">' + s.emitted + '</td>'
        + '<td style="color:var(--muted)">' + s.total_outcomes + '</td>'
        + '<td style="color:var(--green)">' + s.resolved + '</td>'
        + '<td style="color:var(--red)">' + s.regressed + '</td>'
        + '<td style="color:var(--blue)">' + s.adopted + '</td>'
        + '<td><span class="an-ci-val ' + effCls + '">' + effPct + '%</span></td>'
        + '<td>' + (s.disabled
          ? '<span class="badge error">DISABLE</span>'
          : '<span class="badge ok">ACTIVE</span>') + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

function renderSuggestedRules() {
  const el = document.getElementById('an-suggested-rules');
  const suggestions = analyticsData?.suggestedRules || [];
  if (!suggestions.length) {
    el.innerHTML = '<span class="an-empty">No rule suggestions. Either all diagnostics have matching rules, or there is not enough case-base data yet.</span>';
    return;
  }

  el.innerHTML = suggestions.map(s =>
    '<div class="an-rec-item" style="cursor:pointer" onclick="this.querySelector(\\'.an-rule-tpl\\').style.display=this.querySelector(\\'.an-rule-tpl\\').style.display===\\'none\\'?\\'block\\':\\'none\\'">'
    + '<span class="an-rec-icon">[+]</span>'
    + '<div class="an-rec-body">'
    + '<div class="an-rec-check">' + escHtml(s.check) + ' <span style="color:var(--muted);font-weight:normal;font-size:10px">(' + s.template_fp.slice(0, 8) + ')</span></div>'
    + '<div class="an-rec-text">' + escHtml(s.suggestion) + '</div>'
    + '<pre class="an-rule-tpl" style="display:none;margin-top:8px;padding:10px;background:#1d2021;border:1px solid var(--border);font-size:10px;color:var(--text);white-space:pre-wrap">'
    + escHtml(s.template || '')
    + '</pre>'
    + '</div>'
    + '<span class="an-rec-rate" style="color:var(--green)">' + (s.resolution_rate * 100).toFixed(0) + '% RESOLVED</span>'
    + '</div>'
  ).join('');
}

// ── A5: Tool Lab ────────────────────────────────────────────────────────
let toolLabLoaded = false;

async function fetchToolLab() {
  if (toolLabLoaded) return;
  try {
    if (!toolSchemas.length) {
      const r = await fetch(BASE + '/tools');
      const d = await r.json();
      toolSchemas = d.tools || [];
    }
    renderToolLabList();
    toolLabLoaded = true;
  } catch {}
}

function renderToolLabList() {
  const el = document.getElementById('tl-tool-list');
  if (!el) return;
  if (!toolSchemas.length) {
    el.innerHTML = '<span class="empty">NO TOOLS FOUND.</span>';
    return;
  }
  el.innerHTML = toolSchemas.map(t =>
    '<div class="tl-tool-item" id="tl-item-' + escHtml(t.name) + '" onclick="selectToolLab(' + escHtml(JSON.stringify(JSON.stringify(t.name))) + ')">' + escHtml(t.name) + '</div>'
  ).join('');
}

let tlSelectedTool = null;

function selectToolLab(nameJson) {
  const name = JSON.parse(nameJson);
  tlSelectedTool = name;

  document.querySelectorAll('.tl-tool-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById('tl-item-' + name);
  if (item) item.classList.add('active');

  const tool = toolSchemas.find(t => t.name === name);
  if (!tool) return;

  const el = document.getElementById('tl-detail');
  const desc = tool.description || 'NO DESCRIPTION';
  const props = tool.inputSchema?.properties || {};
  const required = new Set(tool.inputSchema?.required || []);
  const propEntries = Object.entries(props);

  const stat = lastStatus?.stats?.[name] || {};
  const calls  = stat.calls  || 0;
  const errors = stat.errors || 0;
  const avgMs  = calls ? Math.round((stat.totalMs || 0) / calls) : 0;
  const lastAt = stat.lastCalledAt || null;
  const errRate = calls ? Math.round((errors / calls) * 100) : 0;

  const metricsHtml = '<div class="tl-metrics">'
    + '<div class="tl-metric"><div class="label">CALLS</div><div class="value">' + calls + '</div></div>'
    + '<div class="tl-metric"><div class="label">ERRORS</div><div class="value" style="color:' + (errors ? 'var(--red)' : 'var(--text)') + '">' + errors + ' (' + errRate + '%)</div></div>'
    + '<div class="tl-metric"><div class="label">AVG DURATION</div><div class="value">' + (avgMs ? avgMs + ' MS' : '—') + '</div></div>'
    + '<div class="tl-metric"><div class="label">LAST CALLED</div><div class="value">' + (lastAt ? fmtTime(new Date(lastAt).toISOString()) : '—') + '</div></div>'
    + '<div class="tl-metric"><div class="label">PARAMETERS</div><div class="value">' + propEntries.length + '</div></div>'
    + '</div>';

  const descHtml = '<div class="tl-desc">' + escHtml(desc) + '</div>';

  let schemaHtml = '';
  if (propEntries.length) {
    schemaHtml = '<table class="tl-schema-table">'
      + '<thead><tr><th>NAME</th><th>TYPE</th><th>REQUIRED</th><th>DESCRIPTION</th></tr></thead>'
      + '<tbody>'
      + propEntries.map(([k, v]) =>
        '<tr>'
        + '<td style="font-weight:bold;color:var(--text)">' + escHtml(k) + '</td>'
        + '<td style="color:var(--purple)">' + escHtml(v.type || '—') + '</td>'
        + '<td>' + (required.has(k) ? '<span style="color:var(--green)">YES</span>' : '<span style="color:var(--muted)">NO</span>') + '</td>'
        + '<td style="color:var(--muted);font-size:10px">' + escHtml(v.description || '—') + '</td>'
        + '</tr>'
      ).join('')
      + '</tbody></table>';
  } else {
    schemaHtml = '<span class="empty">NO INPUT PARAMETERS.</span>';
  }

  el.innerHTML = '<h3 style="font-size:13px;font-weight:bold;color:var(--blue);text-transform:uppercase;margin-bottom:16px;border-bottom:1px dashed var(--border);padding-bottom:8px">' + escHtml(name) + '</h3>'
    + metricsHtml + descHtml + schemaHtml;

  // Populate stable executor shell — don't rebuild it (listeners wired in DOMContentLoaded)
  const template = {};
  if (propEntries.length) {
    for (const [k, v] of propEntries) {
      if (required.has(k) || propEntries.length <= 4) {
        template[k] = v.type === 'string' ? '' : v.type === 'number' ? 0 : v.type === 'boolean' ? false : v.type === 'array' ? [] : {};
      }
    }
  }
  document.getElementById('tl-params').value = Object.keys(template).length ? JSON.stringify(template, null, 2) : '{}';
  document.getElementById('tl-run-btn').disabled    = false;
  document.getElementById('tl-format-btn').disabled = false;
  document.getElementById('tl-result').style.display = 'none';
  document.getElementById('tl-status').textContent = '';
  document.getElementById('tl-exec').style.display = '';
}

// ── D1: Live Diagnostic Console ─────────────────────────────────────────
let currentLiveFilePath = null;

let livePickerFiles = [];

function populateLiveFilePicker() {
  const sel = document.getElementById('lc-file-picker');
  if (!sel || !explorerData) return;

  const files = [];
  for (const k of Object.keys(explorerData.pages    || {})) files.push(explorerData.pages[k].path || k);
  for (const k of Object.keys(explorerData.partials || {})) files.push(explorerData.partials[k].path || k);
  for (const k of Object.keys(explorerData.layouts  || {})) files.push(explorerData.layouts[k].path || k);
  for (const k of Object.keys(explorerData.commands || {})) files.push(k);
  for (const k of Object.keys(explorerData.queries  || {})) files.push(k);
  for (const k of Object.keys(explorerData.graphql  || {})) files.push('app/graphql/' + k + '.graphql');
  for (const k of Object.keys(explorerData.schema   || {})) {
    const p = explorerData.schema[k]?.path;
    if (p) files.push(p);
  }

  livePickerFiles = [...new Set(files)].filter(f => f && f.startsWith('app/')).sort();
  renderLivePickerOptions();
}

function renderLivePickerOptions() {
  const sel = document.getElementById('lc-file-picker');
  const input = document.getElementById('lc-file-filter');
  if (!sel) return;
  const q = (input?.value || '').toLowerCase().trim();
  const filtered = q ? livePickerFiles.filter(f => f.toLowerCase().includes(q)) : livePickerFiles;
  const current = sel.value;
  sel.innerHTML = '<option value="">— LOAD FILE FROM PROJECT (' + filtered.length + '/' + livePickerFiles.length + ') —</option>'
    + filtered.map(f => '<option value="' + escHtml(f) + '">' + escHtml(f) + '</option>').join('');
  if (current && filtered.includes(current)) sel.value = current;
}

async function loadLiveFile() {
  const picker = document.getElementById('lc-file-picker');
  const path = picker.value;
  if (!path) return;
  const statusEl = document.getElementById('lc-status');
  const btn = document.getElementById('lc-load-btn');
  btn.disabled = true;
  btn.textContent = 'LOADING...';
  try {
    const r = await fetch(BASE + '/api/file?path=' + encodeURIComponent(path));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed to load file');
    document.getElementById('lc-content').value = d.content || '';
    currentLiveFilePath = path;
    const ext = (d.ext || '').toLowerCase();
    const ftype = document.getElementById('lc-filetype');
    if (ext === '.graphql') ftype.value = '.graphql';
    else if (ext === '.yml' || ext === '.yaml') ftype.value = '.yml';
    else ftype.value = '.liquid';
    statusEl.textContent = 'LOADED ' + path;
  } catch (e) {
    statusEl.textContent = 'ERROR: ' + e.message;
  }
  btn.disabled = false;
  btn.textContent = 'LOAD';
}

async function runLiveConsole() {
  const content = document.getElementById('lc-content').value;
  if (!content.trim()) return;
  const ext = document.getElementById('lc-filetype').value;
  const statusEl = document.getElementById('lc-status');
  const resultEl = document.getElementById('lc-result');
  const btn = document.getElementById('lc-validate-btn');

  btn.disabled = true;
  btn.textContent = 'VALIDATING...';
  statusEl.textContent = '';
  resultEl.style.display = 'none';

  const filePath = currentLiveFilePath || ('<synthetic>' + ext);

  const t0 = Date.now();
  try {
    const r = await fetch(BASE + '/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'validate_code', params: { file_path: filePath, content } }),
    });
    const d = await r.json();
    const dur = fmtDuration(Date.now() - t0);
    statusEl.textContent = dur;
    resultEl.style.display = '';

    const result = d.result || d;
    const diagnostics = result.diagnostics || result.errors || [];

    if (Array.isArray(diagnostics) && diagnostics.length > 0) {
      resultEl.innerHTML = diagnostics.map(diag => {
        const sev = (diag.severity || diag.type || 'info').toLowerCase();
        const cls = sev === 'error' ? 'error' : sev === 'warning' ? 'warning' : 'info';
        const line = diag.line ? 'L' + diag.line + ': ' : '';
        const check = diag.check ? '[' + diag.check + '] ' : '';
        return '<div class="lc-diag ' + cls + '">' + escHtml(line + check + (diag.message || '')) + '</div>';
      }).join('');
    } else {
      resultEl.innerHTML = '<pre style="color:var(--green)">NO DIAGNOSTICS — CONTENT IS CLEAN.</pre>';
    }
  } catch (e) {
    statusEl.textContent = fmtDuration(Date.now() - t0);
    resultEl.style.display = '';
    resultEl.innerHTML = '<pre style="color:var(--red)">' + escHtml(e.message) + '</pre>';
  }
  btn.disabled = false;
  btn.textContent = 'VALIDATE';
}

// ── D2: Pipeline Inspector ──────────────────────────────────────────────
function renderPipelineInspector(d) {
  const el = document.getElementById('ti-pipeline');
  if (!el) return;
  const traces = d.pipelineTraces || [];

  if (!traces.length) {
    el.innerHTML = '<span class="ti-empty">NO PIPELINE TRACE DATA YET.</span>';
    return;
  }

  el.innerHTML = traces.map((t, idx) => {
    const steps = t.trace || [];
    const stepsHtml = steps.map(s => {
      const eRem = s.errorsRemoved || 0;
      const wRem = s.warningsRemoved || 0;
      const isActive = (eRem + wRem) > 0;
      const cls = isActive ? 'pi-step active' : 'pi-step noop';
      const ea = typeof s.errorsAfter === 'number' ? s.errorsAfter + 'E' : '—E';
      const wa = typeof s.warningsAfter === 'number' ? s.warningsAfter + 'W' : '—W';
      return '<div class="' + cls + '">'
        + '<span class="pi-step-name">' + escHtml(s.step) + '</span>'
        + '<span class="pi-step-stat removed">-' + eRem + 'E -' + wRem + 'W</span>'
        + '<span class="pi-step-stat remaining">' + ea + ' ' + wa + '</span>'
        + '</div>';
    }).join('');

    return '<div class="pi-file">'
      + '<div class="pi-file-header" data-toggle-next="1">'
      + '<span>' + escHtml(shortPath(t.path)) + '</span>'
      + '<span style="color:var(--muted);font-weight:normal">' + steps.length + ' STEPS</span>'
      + '</div>'
      + '<div class="pi-file-body">' + stepsHtml + '</div>'
      + '</div>';
  }).join('');
}

// ── D3: Sessions ────────────────────────────────────────────────────────
let sessionsData = [];
let selectedSessions = [];

async function fetchSessions() {
  const statusEl = document.getElementById('sess-status');
  statusEl.textContent = 'LOADING...';
  try {
    const r = await fetch(BASE + '/api/sessions');
    const d = await r.json();
    sessionsData = d.sessions || [];
    selectedSessions = [];
    renderSessionsTable();
    statusEl.textContent = sessionsData.length + ' SESSIONS LOADED';
  } catch (e) {
    statusEl.textContent = 'FAILED: ' + e.message;
  }
}

async function saveCurrentSession() {
  const statusEl = document.getElementById('sess-status');
  statusEl.textContent = 'SAVING...';
  try {
    const r = await fetch(BASE + '/api/sessions/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json();
    statusEl.textContent = d.ok ? 'SESSION SAVED' : 'SAVE FAILED';
  } catch (e) {
    statusEl.textContent = 'FAILED: ' + e.message;
  }
}

function renderSessionsTable() {
  const el = document.getElementById('sess-table-wrap');
  if (!el) return;
  if (!sessionsData.length) {
    el.innerHTML = '<span class="empty">NO SESSIONS FOUND.</span>';
    return;
  }

  el.innerHTML = '<table class="sess-table">'
    + '<thead><tr><th>SESSION ID</th><th>STARTED</th><th>ENDED</th><th>TOOL CALLS</th><th>ERRORS</th><th>FILES VALIDATED</th></tr></thead>'
    + '<tbody>'
    + sessionsData.map((s, i) => {
      const sel = selectedSessions.includes(i) ? ' selected' : '';
      return '<tr class="' + sel + '" onclick="toggleSession(' + i + ')">'
        + '<td style="font-weight:bold;color:var(--blue)">' + escHtml(s.id || '#' + (i + 1)) + '</td>'
        + '<td class="ts">' + fmtTime(s.startedAt) + '</td>'
        + '<td class="ts">' + (s.endedAt ? fmtTime(s.endedAt) : '<span style="color:var(--green)">ACTIVE</span>') + '</td>'
        + '<td>' + (s.toolCalls ?? 0) + '</td>'
        + '<td style="color:' + ((s.toolErrors || 0) > 0 ? 'var(--red)' : 'var(--muted)') + '">' + (s.toolErrors ?? 0) + '</td>'
        + '<td>' + (s.filesValidated ?? 0) + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';

  renderSessionComparison();
}

function toggleSession(idx) {
  const pos = selectedSessions.indexOf(idx);
  if (pos >= 0) {
    selectedSessions.splice(pos, 1);
  } else {
    if (selectedSessions.length >= 2) selectedSessions.shift();
    selectedSessions.push(idx);
  }
  renderSessionsTable();
}

function renderSessionComparison() {
  const el = document.getElementById('sess-compare-wrap');
  if (!el) return;
  if (selectedSessions.length < 2) {
    el.innerHTML = selectedSessions.length === 1
      ? '<div style="color:var(--muted);font-size:11px;margin-top:12px;text-transform:uppercase">SELECT ONE MORE SESSION TO COMPARE.</div>'
      : '';
    return;
  }

  const a = sessionsData[selectedSessions[0]];
  const b = sessionsData[selectedSessions[1]];

  // Compare check frequencies
  const aFreq = a.checkFrequency || {};
  const bFreq = b.checkFrequency || {};
  const allChecks = new Set([...Object.keys(aFreq), ...Object.keys(bFreq)]);

  const diffRows = [...allChecks].sort().map(check => {
    const av = aFreq[check] || 0;
    const bv = bFreq[check] || 0;
    const delta = bv - av;
    const cls = delta > 0 ? 'sess-diff-up' : delta < 0 ? 'sess-diff-down' : 'sess-diff-same';
    const sign = delta > 0 ? '+' : '';
    return '<div class="sess-diff-row">'
      + '<span>' + escHtml(check) + '</span>'
      + '<span class="' + cls + '">' + sign + delta + ' (' + av + ' → ' + bv + ')</span>'
      + '</div>';
  }).join('');

  // Compare tool usage
  const aStats = a.stats || {};
  const bStats = b.stats || {};
  const allTools = new Set([...Object.keys(aStats), ...Object.keys(bStats)]);

  const toolRows = [...allTools].sort().map(tool => {
    const ac = aStats[tool]?.calls || 0;
    const bc = bStats[tool]?.calls || 0;
    const delta = bc - ac;
    const cls = delta > 0 ? 'sess-diff-up' : delta < 0 ? 'sess-diff-down' : 'sess-diff-same';
    const sign = delta > 0 ? '+' : '';
    return '<div class="sess-diff-row">'
      + '<span>' + escHtml(tool) + '</span>'
      + '<span class="' + cls + '">' + sign + delta + ' (' + ac + ' → ' + bc + ')</span>'
      + '</div>';
  }).join('');

  el.innerHTML = '<div class="sess-compare">'
    + '<div class="sess-compare-panel">'
    + '<div class="sess-compare-header">CHECK FREQUENCY DIFF</div>'
    + '<div class="sess-compare-body">' + (diffRows || '<span class="empty">NO CHECKS TO COMPARE.</span>') + '</div>'
    + '</div>'
    + '<div class="sess-compare-panel">'
    + '<div class="sess-compare-header">TOOL USAGE DIFF</div>'
    + '<div class="sess-compare-body">' + (toolRows || '<span class="empty">NO TOOL USAGE TO COMPARE.</span>') + '</div>'
    + '</div>'
    + '</div>';
}

// ── DOMContentLoaded wiring ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tool Lab: execute selected tool
  document.getElementById('tl-run-btn').addEventListener('click', async () => {
    if (!tlSelectedTool) return;
    const btn = document.getElementById('tl-run-btn');
    btn.disabled = true; btn.textContent = 'EXECUTING…';

    let params = {};
    try { params = JSON.parse(document.getElementById('tl-params').value || '{}'); }
    catch (e) {
      const resultEl = document.getElementById('tl-result');
      resultEl.className = 'playground-result result-error';
      resultEl.style.display = '';
      document.getElementById('tl-result-pre').textContent = 'INVALID JSON: ' + e.message;
      btn.disabled = false; btn.textContent = 'EXECUTE';
      return;
    }

    const t0 = Date.now();
    try {
      const r = await fetch(BASE + '/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: tlSelectedTool, params }),
      });
      const d = await r.json();
      const resultEl = document.getElementById('tl-result');
      resultEl.className   = 'playground-result ' + (r.ok ? 'result-ok' : 'result-error');
      resultEl.style.display = '';
      document.getElementById('tl-result-label').textContent    = r.ok ? 'RESULT' : 'ERROR';
      document.getElementById('tl-result-duration').textContent = fmtDuration(Date.now() - t0);
      document.getElementById('tl-result-pre').textContent      = JSON.stringify(d.result ?? d, null, 2);
    } catch (e) {
      const resultEl = document.getElementById('tl-result');
      resultEl.className = 'playground-result result-error';
      resultEl.style.display = '';
      document.getElementById('tl-result-label').textContent = 'ERROR';
      document.getElementById('tl-result-pre').textContent   = e.message;
    }
    btn.disabled = false; btn.textContent = 'EXECUTE';
    fetchStatus();
  });

  // Tool Lab: format params JSON
  document.getElementById('tl-format-btn').addEventListener('click', () => {
    try {
      const val = document.getElementById('tl-params').value;
      document.getElementById('tl-params').value = JSON.stringify(JSON.parse(val), null, 2);
    } catch {}
  });

  // Session export
  document.getElementById('export-btn').addEventListener('click', exportSession);

  // File Detail Flyout: delegated click on file map cells + overlay/Escape dismiss
  document.getElementById('file-map').addEventListener('click', (e) => {
    const cell = e.target.closest('.fm-cell[data-file-path]');
    if (!cell) return;
    openFileDetail(cell.dataset.filePath);
  });
  document.getElementById('fd-overlay').addEventListener('click', closeFileDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('fd-flyout').classList.contains('open')) closeFileDetail();
  });

  // Dependency Impact Tree
  const depRefreshBtn = document.getElementById('dep-refresh-btn');
  if (depRefreshBtn) depRefreshBtn.addEventListener('click', fetchDependencyTree);
  const depFilterInput = document.getElementById('dep-filter');
  if (depFilterInput) depFilterInput.addEventListener('input', (e) => {
    depFilter = e.target.value || '';
    renderDepSidebar();
  });
  const depFileList = document.getElementById('dep-file-list');
  if (depFileList) depFileList.addEventListener('click', (e) => {
    const item = e.target.closest('.dep-file-item[data-path]');
    if (!item) return;
    selectDepFile(item.dataset.path);
  });
  const depDetailEl = document.getElementById('dep-detail');
  if (depDetailEl) depDetailEl.addEventListener('click', (e) => {
    const node = e.target.closest('.dep-node[data-path]');
    if (!node) return;
    selectDepFile(node.dataset.path);
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
    status.textContent  = 'RESTARTING…';
    try {
      const r = await fetch(BASE + '/api/lsp/restart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const d = await r.json();
      if (r.ok) {
        status.style.color = 'var(--green)';
        status.textContent = 'RESTARTED SUCCESSFULLY';
        sessionStart = null;
      } else {
        status.style.color = 'var(--red)';
        status.textContent = d.error || 'RESTART FAILED';
      }
    } catch (e) {
      status.style.color = 'var(--red)';
      status.textContent = e.message;
    }
    btn.disabled = false;
    setTimeout(() => { status.textContent = ''; }, 4000);
    fetchStatus();
  });

  // Pipeline inspector: toggle trace body on header click
  document.addEventListener('click', (e) => {
    const header = e.target.closest('[data-toggle-next]');
    if (header && header.nextElementSibling) {
      header.nextElementSibling.classList.toggle('open');
    }
  });

  // Health tab refresh buttons
  document.getElementById('ex-refresh-btn').addEventListener('click', fetchExplorerData);
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

  // Tool Insights refresh
  document.getElementById('ti-refresh-btn').addEventListener('click', fetchInsightsData);

  // Analytics tab
  document.getElementById('an-refresh-btn').addEventListener('click', fetchAnalytics);
  document.getElementById('an-rebuild-btn').addEventListener('click', rebuildAnalytics);

  // False Positive Manager
  document.getElementById('fp-add-btn').addEventListener('click', addSuppression);

  // Live Console: when toggled ON, swap tool-browser for live console
  document.getElementById('lc-mode-toggle').addEventListener('change', async (e) => {
    document.getElementById('lc-panel').style.display = e.target.checked ? '' : 'none';
    document.getElementById('tl-browser-wrap').style.display = e.target.checked ? 'none' : '';
    if (e.target.checked) {
      if (!explorerData) { try { await fetchExplorerData(); } catch {} }
      populateLiveFilePicker();
    }
  });
  document.getElementById('lc-validate-btn').addEventListener('click', runLiveConsole);
  document.getElementById('lc-load-btn').addEventListener('click', loadLiveFile);
  document.getElementById('lc-file-picker').addEventListener('change', () => { currentLiveFilePath = null; });
  document.getElementById('lc-file-filter').addEventListener('input', renderLivePickerOptions);

  // Sessions
  document.getElementById('sess-load-btn').addEventListener('click', fetchSessions);
  document.getElementById('sess-save-btn').addEventListener('click', saveCurrentSession);
});

// ── Uptime counter ─────────────────────────────────────────────────────────
setInterval(() => {
  if (startTime) document.getElementById('uptime').textContent = 'UP ' + fmtUptime(Date.now() - startTime);
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
