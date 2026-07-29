// SPDX-License-Identifier: Apache-2.0

import { installStyle } from '../ui/dom'

export const MACHINE_CSS = `
.tidb-machine { min-height: 100%; padding: 20px; background: var(--tc-bg); color: var(--tc-text); }
.tidb-machine__head, .tidb-machine__controls {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
}
.tidb-machine__head h1 { margin: 0; font: 700 20px/1.2 ui-monospace, monospace; }
.tidb-machine__head p { color: var(--tc-muted); margin: 5px 0 0; }
.tidb-machine__controls { justify-content: flex-start; margin: 16px 0 10px; }
.tidb-machine__frame {
  overflow-x: auto; border: 1px solid var(--tc-border); border-radius: 13px;
  background: var(--tc-panel);
  scrollbar-color: var(--tc-border) transparent;
}
.tidb-machine__svg { display: block; width: 100%; min-width: 720px; height: auto; }
.tidb-machine__lane:nth-child(odd) .tidb-machine__lane-bg {
  fill: color-mix(in srgb, var(--tc-text) 3%, transparent);
}
.tidb-machine__lane:nth-child(even) .tidb-machine__lane-bg {
  fill: color-mix(in srgb, var(--tc-cyan) 5%, transparent);
}
.tidb-machine__lane-label { fill: var(--tc-text); font: 12px ui-monospace, monospace; }
.tidb-machine__axis { stroke: var(--tc-border); stroke-width: 1; }
.tidb-machine__event { stroke: var(--tc-bg); stroke-width: 2; }
.tidb-machine__event[data-event-domain="sql"] { fill: var(--city-blue); }
.tidb-machine__event[data-event-domain="tso"] { fill: var(--city-yellow); }
.tidb-machine__event[data-event-domain="txn2pc"] { fill: var(--city-orange); }
.tidb-machine__event[data-event-domain="raft"] { fill: var(--city-violet); }
.tidb-machine__event[data-event-domain="kv"] { fill: var(--city-green); }
.tidb-machine__event[data-event-domain="tiflash"] { fill: var(--city-magenta); }
.tidb-machine__event.is-future { opacity: .28; }
.tidb-machine__event.is-current { stroke: var(--tc-text); stroke-width: 3; }
.tidb-machine__event.is-failed {
  fill: var(--tc-red); stroke: var(--tc-text); stroke-width: 4; stroke-dasharray: 1 2;
}
.tidb-machine__event.is-warning {
  stroke: var(--tc-yellow); stroke-width: 4; stroke-dasharray: 5 2;
}
.tidb-machine__event.is-current:is(.is-failed, .is-warning) {
  stroke-width: 5; filter: drop-shadow(0 0 3px var(--tc-text));
}
.tidb-machine__event-label { fill: var(--tc-text); font: 10px ui-monospace, monospace; pointer-events: none; }
.tidb-machine__cursor { stroke: var(--tc-text); stroke-width: 1; stroke-dasharray: 3 4; opacity: .75; }
.tidb-machine__detail {
  min-height: 5.5em; margin-top: 10px; padding: 12px; border-left: 2px solid var(--tc-cyan);
  background: color-mix(in srgb, var(--tc-panel-2) 78%, transparent);
}
.tidb-machine__detail h2 { margin: 0 0 5px; font: inherit; color: var(--tc-cyan); }
.tidb-machine__status {
  display: inline-flex; align-items: center; gap: 6px; margin: 7px 0 0;
  border: 1px solid currentColor; border-radius: 999px; padding: 3px 8px; font-weight: 700;
}
.tidb-machine__status::before { content: "!"; }
.tidb-machine__status.is-failed { color: var(--tc-red); border-style: double; border-width: 3px; }
.tidb-machine__status.is-warning { color: var(--tc-yellow); border-style: dashed; }
.tidb-machine__empty { padding: 24px; color: var(--tc-muted); text-align: center; }
.tidb-machine__note { color: var(--tc-muted); font-size: 12px; }
`

export function installMachineStyles(doc: Document = document): void {
  installStyle('tidb-machine-styles', MACHINE_CSS, doc)
}
