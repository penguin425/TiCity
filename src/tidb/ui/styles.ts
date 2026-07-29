// SPDX-License-Identifier: Apache-2.0

import { installStyle } from './dom'

export const CITY_UI_CSS = `
.tidb-surface {
  --tc-bg: #071318;
  --tc-panel: rgba(10, 30, 37, .94);
  --tc-panel-2: #102b34;
  --tc-border: rgba(111, 225, 214, .28);
  --tc-text: #e8fbf8;
  --tc-muted: #9dbab7;
  --tc-cyan: #62eadb;
  --tc-yellow: #ffd866;
  --tc-red: #ff7883;
  color: var(--tc-text);
  background: var(--tc-bg);
  font: 14px/1.5 ui-monospace, "SFMono-Regular", Consolas, monospace;
}
.tidb-surface *, .tidb-surface *::before, .tidb-surface *::after { box-sizing: border-box; }
.ticity-ui { padding: 18px; border: 1px solid var(--tc-border); border-radius: 16px; }
.ticity-head, .tidb-section-heading, .tidb-language, .tidb-actions, .tidb-tour-nav {
  display: flex; align-items: center; gap: 10px;
}
.ticity-head { justify-content: space-between; flex-wrap: wrap; margin-bottom: 16px; }
.ticity-title h1, .tidb-section-heading h2 { margin: 0; font: inherit; font-size: 1.15rem; letter-spacing: .02em; }
.ticity-title p, .tidb-sql-help, .tidb-legal p { color: var(--tc-muted); margin: 4px 0 0; }
.tidb-language { border: 0; padding: 0; margin: 0; }
.tidb-language legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.tidb-button {
  appearance: none; border: 1px solid var(--tc-border); border-radius: 999px;
  padding: 7px 12px; background: var(--tc-panel-2); color: var(--tc-text); cursor: pointer;
}
.tidb-button:hover, .tidb-button:focus-visible, .tidb-button[aria-pressed="true"] {
  border-color: var(--tc-cyan); outline: none; color: var(--tc-cyan);
}
.tidb-button--primary { background: var(--tc-cyan); border-color: var(--tc-cyan); color: #05211f; font-weight: 700; }
.tidb-navigation { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
.tidb-nav-link {
  color: var(--tc-muted); text-decoration: none; border-bottom: 1px solid var(--tc-border); padding: 4px 2px;
}
.tidb-nav-link:hover, .tidb-nav-link:focus-visible { color: var(--tc-cyan); border-color: var(--tc-cyan); outline: none; }
.tidb-card { background: var(--tc-panel); border: 1px solid var(--tc-border); border-radius: 12px; padding: 16px; margin-top: 12px; }
.tidb-model-badge {
  display: inline-flex; align-items: center; border: 1px solid var(--tc-yellow); border-radius: 999px;
  padding: 3px 8px; color: var(--tc-yellow); font-size: 11px; letter-spacing: .08em; white-space: nowrap;
}
.tidb-sql-textarea {
  display: block; width: 100%; min-height: 118px; resize: vertical; margin: 12px 0 9px;
  padding: 12px; border: 1px solid var(--tc-border); border-radius: 8px;
  color: var(--tc-text); background: #041014; font: inherit;
}
.tidb-sql-textarea:focus { outline: 2px solid var(--tc-cyan); outline-offset: 1px; }
.tidb-sql-meta { display: flex; justify-content: space-between; gap: 10px; color: var(--tc-muted); font-size: 12px; }
.tidb-sql-output { margin-top: 14px; border-top: 1px solid var(--tc-border); padding-top: 12px; }
.tidb-status { color: var(--tc-cyan); text-transform: uppercase; letter-spacing: .08em; }
.tidb-status--unsupported, .tidb-status--invalid { color: var(--tc-yellow); }
.tidb-route { display: flex; flex-wrap: wrap; gap: 7px; padding: 0; list-style: none; }
.tidb-route li { display: flex; align-items: center; gap: 7px; }
.tidb-route li:not(:last-child)::after { content: "→"; color: var(--tc-cyan); }
.tidb-plan { margin: 6px 0 0; padding-left: 24px; color: #c9f6ef; }
.tidb-warning { color: var(--tc-yellow); }
.tidb-no-results { color: var(--tc-muted); border-left: 2px solid var(--tc-border); padding-left: 10px; }
.tidb-tour-progress { color: var(--tc-cyan); margin: 12px 0 4px; }
.tidb-tour-body { min-height: 5em; }
.tidb-tour-nav { justify-content: space-between; margin-top: 14px; }
.tidb-controls h3 { margin: 15px 0 8px; color: var(--tc-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .07em; }
.tidb-scenario-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 7px; }
.tidb-scenario {
  min-height: 38px; border: 1px solid var(--tc-border); border-radius: 8px; padding: 7px 9px;
  background: #091d23; color: var(--tc-text); font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.tidb-scenario:hover, .tidb-scenario:focus-visible, .tidb-scenario[aria-pressed="true"] {
  outline: none; border-color: var(--tc-yellow); color: var(--tc-yellow);
}
.tidb-control-status { min-height: 1.5em; color: var(--tc-yellow); font-size: 12px; }
.tidb-control-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 9px 14px; }
.tidb-control { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 5px 9px; color: var(--tc-muted); font-size: 12px; }
.tidb-control-input { grid-column: 1 / -1; width: 100%; accent-color: var(--tc-cyan); }
.tidb-control output { color: var(--tc-cyan); }
.tidb-control-select {
  min-width: 112px; border: 1px solid var(--tc-border); border-radius: 7px; padding: 6px;
  color: var(--tc-text); background: #041014; font: inherit;
}
.tidb-control-toggle[aria-pressed="true"] { color: var(--tc-yellow); border-color: var(--tc-yellow); }
.tidb-legal { margin-top: 12px; }
@media (max-width: 640px) {
  .ticity-ui { padding: 12px; border-radius: 0; }
  .tidb-actions { align-items: stretch; flex-direction: column; }
  .tidb-button { min-height: 42px; }
}
@media (prefers-reduced-motion: reduce) {
  .tidb-surface * { scroll-behavior: auto !important; transition: none !important; }
}
`

export function installCityUiStyles(doc: Document = document): void {
  installStyle('ticity-ui-styles', CITY_UI_CSS, doc)
}
