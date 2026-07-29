// SPDX-License-Identifier: Apache-2.0

import { installStyle } from '../ui/dom'

export const DIAGNOSE_CSS = `
.tidb-diagnose { min-height: 100%; padding: 20px; background: var(--tc-bg); color: var(--tc-text); }
.tidb-diagnose__head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.tidb-diagnose__head h1 { margin: 0; font: 700 20px/1.2 ui-monospace, monospace; }
.tidb-diagnose__head p { color: var(--tc-muted); margin: 5px 0 0; }
.tidb-diagnose__grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  align-items: start; gap: 14px; margin-top: 16px;
}
.tidb-diagnose__panel {
  min-width: 0; border: 1px solid var(--tc-border); border-radius: 12px;
  background: var(--tc-panel); padding: 13px;
}
.tidb-diagnose__panel[data-diagnose-section="regions"] { grid-column: 1 / -1; order: 1; }
.tidb-diagnose__panel-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.tidb-diagnose__panel h2, .tidb-diagnose__guides > h2 { margin: 0; font: 700 14px/1.3 ui-monospace, monospace; }
.tidb-diagnose__scroll {
  overflow-x: auto; margin-top: 10px; overscroll-behavior: contain;
  scrollbar-color: var(--tc-border) transparent;
}
.tidb-diagnose__panel[data-diagnose-section="regions"] .tidb-diagnose__scroll {
  max-height: min(58dvh, 38rem); overflow: auto; scrollbar-gutter: stable;
}
.tidb-diagnose__table { width: 100%; border-collapse: collapse; font: 12px/1.4 ui-monospace, monospace; }
.tidb-diagnose__table th {
  position: sticky; z-index: 1; top: 0; color: var(--tc-muted); background: var(--tc-panel);
  font-weight: 500; text-align: left; border-bottom: 1px solid var(--tc-border);
  padding: 6px 8px; white-space: nowrap;
}
.tidb-diagnose__table td {
  padding: 7px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--tc-border) 45%, transparent);
  white-space: nowrap;
}
.tidb-diagnose__table tbody tr:last-child td { border-bottom: 0; }
.tidb-diagnose__empty { color: var(--tc-muted); }
.tidb-diagnose__guides { margin-top: 20px; }
.tidb-diagnose__guide-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 12px; margin-top: 12px; }
.tidb-diagnose__guide {
  min-width: 0; padding: 13px; border-left: 3px solid var(--tc-yellow); background: var(--tc-panel-2);
}
.tidb-diagnose__guide h3 { margin: 0 0 5px; font: 700 13px/1.3 ui-monospace, monospace; color: var(--tc-yellow); }
.tidb-diagnose__guide p { color: var(--tc-text); }
.tidb-diagnose__guide pre {
  max-width: 100%; margin: 9px 0 0; padding: 10px; overflow-x: auto;
  border: 1px solid var(--tc-border); border-radius: 7px;
  color: var(--tc-cyan); background: var(--tc-bg);
  white-space: pre; overflow-wrap: normal; word-break: normal;
}
`

export function installDiagnoseStyles(doc: Document = document): void {
  installStyle('tidb-diagnose-styles', DIAGNOSE_CSS, doc)
}
