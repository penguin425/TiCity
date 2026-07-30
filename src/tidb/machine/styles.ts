// SPDX-License-Identifier: Apache-2.0

import { installStyle } from '../ui/dom'

export const MACHINE_CSS = `
.tidb-machine {
  min-height: 100%;
  padding: 22px;
  background:
    radial-gradient(circle at 84% 4%, color-mix(in srgb, var(--tc-cyan) 9%, transparent), transparent 26rem),
    var(--tc-bg);
  color: var(--tc-text);
}
.tidb-machine__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
}
.tidb-machine__head h1 {
  margin: 0;
  font: 750 clamp(20px, 2.1vw, 28px)/1.15 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: -.035em;
}
.tidb-machine__head p {
  max-width: 68ch;
  margin: 7px 0 0;
  color: var(--tc-muted);
  line-height: 1.55;
}
.tidb-machine__overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  margin: 18px 0 10px;
  border: 1px solid var(--tc-border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--tc-panel) 86%, transparent);
}
.tidb-machine__metric {
  min-width: 0;
  padding: 11px 14px 12px;
  border-left: 1px solid var(--tc-border);
}
.tidb-machine__metric:first-child { border-left: 0; }
.tidb-machine__metric-label {
  display: block;
  margin-bottom: 5px;
  color: var(--tc-muted);
  font: 700 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .11em;
  text-transform: uppercase;
}
.tidb-machine__metric-value {
  display: block;
  overflow: hidden;
  color: var(--tc-text);
  font: 700 13px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tidb-machine__metric:first-child .tidb-machine__metric-value,
.tidb-machine__metric:nth-child(2) .tidb-machine__metric-value {
  color: var(--tc-cyan);
}
.tidb-machine__transport {
  display: grid;
  grid-template-columns: auto minmax(220px, 1fr);
  align-items: center;
  gap: 16px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid var(--tc-border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--tc-panel-2) 72%, transparent);
}
.tidb-machine__controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.tidb-machine__controls .tidb-button { min-width: 74px; }
.tidb-machine__controls .tidb-button:disabled {
  cursor: not-allowed;
  opacity: .45;
}
.tidb-machine__progress-wrap { min-width: 0; }
.tidb-machine__progress-label {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 6px;
  color: var(--tc-muted);
  font: 700 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.tidb-machine__progress-text { color: var(--tc-cyan); }
.tidb-machine__progress {
  display: block;
  width: 100%;
  height: 6px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tc-border) 72%, transparent);
  accent-color: var(--tc-cyan);
}
.tidb-machine__progress::-webkit-progress-bar {
  border-radius: 999px;
  background: color-mix(in srgb, var(--tc-border) 72%, transparent);
}
.tidb-machine__progress::-webkit-progress-value {
  border-radius: 999px;
  background: linear-gradient(90deg, var(--tc-cyan), var(--city-blue, #6c8cff));
}
.tidb-machine__progress::-moz-progress-bar {
  border-radius: 999px;
  background: linear-gradient(90deg, var(--tc-cyan), var(--city-blue, #6c8cff));
}
.tidb-machine__frame {
  overflow-x: auto;
  border: 1px solid var(--tc-border);
  border-radius: 14px;
  background: var(--tc-panel);
  box-shadow: 0 16px 38px color-mix(in srgb, var(--tc-bg) 62%, transparent);
  scrollbar-color: var(--tc-border) transparent;
}
.tidb-machine__frame:focus-within {
  border-color: color-mix(in srgb, var(--tc-cyan) 72%, var(--tc-border));
}
.tidb-machine__svg {
  display: block;
  width: 100%;
  min-width: 900px;
  height: auto;
}
.tidb-machine__backdrop { fill: var(--tc-panel); }
.tidb-machine__plot-eyebrow,
.tidb-machine__time-title,
.tidb-machine__tick-label,
.tidb-machine__lane-code,
.tidb-machine__lane-label,
.tidb-machine__lane-count,
.tidb-machine__event-label,
.tidb-machine__event-glyph,
.tidb-machine__cursor-label {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__plot-eyebrow {
  fill: var(--tc-cyan);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .14em;
}
.tidb-machine__time-title {
  fill: var(--tc-muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .1em;
}
.tidb-machine__tick-label {
  fill: var(--tc-muted);
  font-size: 9px;
}
.tidb-machine__gridline {
  stroke: var(--tc-border);
  stroke-width: 1;
  stroke-dasharray: 2 5;
  opacity: .58;
}
.tidb-machine__lane[data-lane="sql"] { --lane-color: var(--domain-sql, #20d9c2); }
.tidb-machine__lane[data-lane="tso"] { --lane-color: var(--domain-tso, #ffd166); }
.tidb-machine__lane[data-lane="txn2pc"] { --lane-color: var(--domain-txn2pc, #e28cff); }
.tidb-machine__lane[data-lane="raft"] { --lane-color: var(--domain-raft, #ff7a59); }
.tidb-machine__lane[data-lane="kv"] { --lane-color: var(--domain-kv, #64e572); }
.tidb-machine__lane[data-lane="tiflash"] { --lane-color: var(--domain-tiflash, #49a7ff); }
.tidb-machine__lane-bg {
  fill: color-mix(in srgb, var(--tc-text) 2.5%, transparent);
  stroke: color-mix(in srgb, var(--tc-border) 70%, transparent);
  stroke-width: 1;
}
.tidb-machine__lane:nth-child(even) .tidb-machine__lane-bg {
  fill: color-mix(in srgb, var(--tc-cyan) 4%, transparent);
}
.tidb-machine__lane-accent { fill: var(--lane-color); }
.tidb-machine__lane-code {
  fill: var(--lane-color);
  font-size: 11px;
  font-weight: 850;
  letter-spacing: .08em;
}
.tidb-machine__lane-label {
  fill: var(--tc-muted);
  font-size: 10px;
}
.tidb-machine__lane-count {
  fill: var(--tc-muted);
  font-size: 10px;
  font-weight: 700;
}
.tidb-machine__axis {
  stroke: color-mix(in srgb, var(--tc-border) 82%, transparent);
  stroke-width: 1;
}
.tidb-machine__event[data-event-domain="sql"],
.tidb-machine__duration[data-duration-domain="sql"],
.tidb-machine__causal[data-causal-domain="sql"] { --event-color: var(--domain-sql, #20d9c2); }
.tidb-machine__event[data-event-domain="tso"],
.tidb-machine__duration[data-duration-domain="tso"],
.tidb-machine__causal[data-causal-domain="tso"] { --event-color: var(--domain-tso, #ffd166); }
.tidb-machine__event[data-event-domain="txn2pc"],
.tidb-machine__duration[data-duration-domain="txn2pc"],
.tidb-machine__causal[data-causal-domain="txn2pc"] { --event-color: var(--domain-txn2pc, #e28cff); }
.tidb-machine__event[data-event-domain="raft"],
.tidb-machine__duration[data-duration-domain="raft"],
.tidb-machine__causal[data-causal-domain="raft"] { --event-color: var(--domain-raft, #ff7a59); }
.tidb-machine__event[data-event-domain="kv"],
.tidb-machine__duration[data-duration-domain="kv"],
.tidb-machine__causal[data-causal-domain="kv"] { --event-color: var(--domain-kv, #64e572); }
.tidb-machine__event[data-event-domain="tiflash"],
.tidb-machine__duration[data-duration-domain="tiflash"],
.tidb-machine__causal[data-causal-domain="tiflash"] { --event-color: var(--domain-tiflash, #49a7ff); }
.tidb-machine__duration {
  fill: var(--event-color);
  opacity: .34;
}
.tidb-machine__duration.is-complete { opacity: .52; }
.tidb-machine__duration.is-current {
  opacity: .88;
  stroke: var(--tc-text);
  stroke-width: 1;
}
.tidb-machine__duration.is-future { opacity: .14; }
.tidb-machine__duration.is-failed { fill: var(--tc-red); }
.tidb-machine__duration.is-warning {
  stroke: var(--tc-yellow);
  stroke-width: 2;
  stroke-dasharray: 4 2;
}
.tidb-machine__causal {
  fill: none;
  stroke: var(--event-color);
  stroke-width: 1.35;
  stroke-linecap: round;
  opacity: .24;
  vector-effect: non-scaling-stroke;
}
.tidb-machine__causal.is-complete { opacity: .58; }
.tidb-machine__causal.is-current {
  stroke-width: 2.4;
  opacity: .92;
}
.tidb-machine__causal.is-future {
  stroke-dasharray: 3 6;
  opacity: .18;
}
.tidb-machine__causal[data-causal-path="background"] {
  stroke-dasharray: 5 5;
  opacity: .48;
}
.tidb-machine__arrow { fill: var(--tc-muted); }
.tidb-machine__cursor {
  stroke: var(--tc-text);
  stroke-width: 1.25;
  stroke-dasharray: 3 5;
  opacity: .74;
  vector-effect: non-scaling-stroke;
}
.tidb-machine__cursor-badge {
  fill: var(--tc-text);
  stroke: var(--tc-panel);
  stroke-width: 1;
}
.tidb-machine__cursor-label {
  fill: var(--tc-bg);
  font-size: 9px;
  font-weight: 800;
}
.tidb-machine__event {
  --event-color: var(--tc-cyan);
  cursor: pointer;
  outline: none;
}
.tidb-machine__event-hit {
  fill: transparent;
  stroke: transparent;
  stroke-width: 2;
  pointer-events: all;
}
.tidb-machine__event-halo {
  fill: color-mix(in srgb, var(--event-color) 13%, transparent);
  stroke: var(--event-color);
  stroke-width: 1;
  opacity: .68;
}
.tidb-machine__event-core {
  fill: var(--event-color);
  stroke: var(--tc-panel);
  stroke-width: 2.5;
}
.tidb-machine__event-glyph {
  fill: var(--tc-bg);
  font-size: 7px;
  font-weight: 900;
  pointer-events: none;
}
.tidb-machine__event.is-complete .tidb-machine__event-halo { opacity: .45; }
.tidb-machine__event.is-future { opacity: .3; }
.tidb-machine__event.is-current .tidb-machine__event-halo {
  stroke: var(--tc-text);
  stroke-width: 2.4;
  opacity: 1;
}
.tidb-machine__event.is-current .tidb-machine__event-core {
  stroke: var(--tc-text);
  stroke-width: 2;
}
.tidb-machine__event.is-warning .tidb-machine__event-halo {
  stroke: var(--tc-yellow);
  stroke-width: 2.5;
  stroke-dasharray: 4 2;
}
.tidb-machine__event.is-warning .tidb-machine__event-glyph {
  font-size: 10px;
}
.tidb-machine__event.is-failed { --event-color: var(--tc-red); }
.tidb-machine__event.is-failed .tidb-machine__event-halo {
  stroke: var(--tc-text);
  stroke-width: 2.5;
  stroke-dasharray: 1 2;
}
.tidb-machine__event.is-failed .tidb-machine__event-core {
  stroke: var(--tc-text);
  stroke-width: 3;
}
.tidb-machine__event.is-failed .tidb-machine__event-glyph {
  font-size: 11px;
}
.tidb-machine__event:focus-visible .tidb-machine__event-hit {
  stroke: var(--tc-yellow);
  stroke-width: 3;
  stroke-dasharray: 3 2;
}
.tidb-machine__callout-leader {
  stroke: var(--tc-text);
  stroke-width: 1;
  opacity: .8;
}
.tidb-machine__callout {
  fill: color-mix(in srgb, var(--tc-panel-2) 94%, var(--tc-bg));
  stroke: var(--tc-text);
  stroke-width: 1;
}
.tidb-machine__event-label {
  fill: var(--tc-text);
  font-size: 9.5px;
  font-weight: 750;
  pointer-events: none;
}
.tidb-machine__lock-slot {
  margin-top: 10px;
}
.tidb-machine__lock-state {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--tc-yellow) 42%, var(--tc-border));
  border-radius: 14px;
  padding: 16px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--tc-yellow) 5%, transparent), transparent 46%),
    color-mix(in srgb, var(--tc-panel) 91%, transparent);
}
.tidb-machine__lock-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.tidb-machine__lock-head h2 {
  margin: 3px 0 0;
  font: 760 clamp(16px, 1.8vw, 22px)/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__lock-eyebrow {
  margin: 0;
  color: var(--tc-yellow);
  font: 800 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .13em;
}
.tidb-machine__lock-snapshot {
  max-width: 46%;
  overflow: hidden;
  border: 1px solid var(--tc-border);
  border-radius: 999px;
  padding: 4px 9px;
  color: var(--tc-muted);
  font: 700 9px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tidb-machine__wait-graph {
  overflow-x: auto;
  border: 1px solid var(--tc-border);
  border-radius: 11px;
  padding: 12px;
  background: color-mix(in srgb, var(--tc-panel-2) 72%, transparent);
}
.tidb-machine__wait-graph:focus-visible {
  outline: 3px solid var(--tc-cyan);
  outline-offset: 2px;
}
.tidb-machine__lock-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tidb-machine__lock-card-head h3,
.tidb-machine__lock-card h3 {
  margin: 0;
  color: var(--tc-text);
  font: 780 12px/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .03em;
}
.tidb-machine__graph-contract {
  border: 1px solid color-mix(in srgb, var(--tc-yellow) 58%, var(--tc-border));
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--tc-yellow);
  font: 800 9px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .08em;
}
.tidb-machine__graph-direction {
  margin: 6px 0 3px;
  color: var(--tc-muted);
  font-size: 12px;
  line-height: 1.5;
}
.tidb-machine__wait-svg {
  display: block;
  width: 100%;
  min-width: 560px;
  height: auto;
}
.tidb-machine__wait-edge {
  fill: none;
  stroke: var(--tc-yellow);
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-dasharray: 5 3;
  vector-effect: non-scaling-stroke;
}
.tidb-machine__wait-arrow {
  fill: var(--tc-yellow);
}
.tidb-machine__wait-resource {
  fill: var(--tc-yellow);
  font: 750 9px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__wait-node-box {
  fill: color-mix(in srgb, var(--tc-panel) 90%, var(--tc-bg));
  stroke: var(--tc-cyan);
  stroke-width: 1.5;
}
.tidb-machine__wait-node.is-waiting .tidb-machine__wait-node-box {
  stroke: var(--tc-yellow);
  stroke-dasharray: 4 2;
}
.tidb-machine__wait-node.is-victim .tidb-machine__wait-node-box,
.tidb-machine__wait-node.is-rolled_back .tidb-machine__wait-node-box {
  stroke: var(--tc-red);
  stroke-width: 2.5;
}
.tidb-machine__wait-node.is-completed .tidb-machine__wait-node-box {
  stroke: var(--domain-kv, #64e572);
}
.tidb-machine__wait-node-client,
.tidb-machine__wait-node-id {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  text-anchor: middle;
}
.tidb-machine__wait-node-client {
  fill: var(--tc-text);
  font-size: 10px;
  font-weight: 800;
}
.tidb-machine__wait-node-id {
  fill: var(--tc-muted);
  font-size: 8px;
}
.tidb-machine__wait-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tidb-machine__wait-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--tc-yellow) 28%, var(--tc-border));
  border-radius: 7px;
  padding: 7px 9px;
  color: var(--tc-text);
  font: 700 10px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__wait-list li > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tidb-machine__wait-list li > strong {
  color: var(--tc-yellow);
  font-size: 15px;
}
.tidb-machine__wait-list li > small {
  color: var(--tc-muted);
  font: inherit;
}
.tidb-machine__lock-transactions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 7px;
  margin: 10px 0;
  padding: 0;
  list-style: none;
}
.tidb-machine__lock-transactions li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 9px;
  border-left: 3px solid var(--tc-cyan);
  border-radius: 6px;
  padding: 7px 9px;
  background: color-mix(in srgb, var(--tc-panel-2) 74%, transparent);
}
.tidb-machine__lock-transactions li[data-lock-status="waiting"] {
  border-left-color: var(--tc-yellow);
}
.tidb-machine__lock-transactions li[data-lock-status="victim"],
.tidb-machine__lock-transactions li[data-lock-status="rolled_back"] {
  border-left-color: var(--tc-red);
}
.tidb-machine__lock-transactions span,
.tidb-machine__lock-transactions code,
.tidb-machine__lock-transactions strong {
  overflow: hidden;
  font: 700 10px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tidb-machine__lock-transactions span { color: var(--tc-muted); }
.tidb-machine__lock-transactions code { color: var(--tc-text); }
.tidb-machine__lock-transactions strong {
  grid-column: 1 / -1;
  color: var(--tc-cyan);
}
.tidb-machine__lock-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}
.tidb-machine__lock-card {
  min-width: 0;
  border: 1px solid var(--tc-border);
  border-radius: 9px;
  padding: 11px;
  background: color-mix(in srgb, var(--tc-panel-2) 64%, transparent);
}
.tidb-machine__lock-card > strong {
  display: block;
  margin-top: 8px;
  color: var(--tc-cyan);
  font: 800 11px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__lock-card p {
  overflow-wrap: anywhere;
  margin: 7px 0 0;
  color: var(--tc-muted);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__lock-card[data-deadlock-state="detected"],
.tidb-machine__lock-card[data-deadlock-state="rolling_back"] {
  border-color: color-mix(in srgb, var(--tc-red) 70%, var(--tc-border));
}
.tidb-machine__lock-card .tidb-machine__deadlock-cycle {
  color: var(--tc-text);
}
.tidb-machine__lock-card .tidb-machine__model-policy {
  border-left: 3px solid var(--tc-yellow);
  padding-left: 7px;
  color: var(--tc-yellow);
  font-weight: 750;
}
.tidb-machine__lock-card .tidb-machine__retryable-false {
  color: var(--tc-red);
  font-weight: 800;
}
.tidb-machine__lock-empty {
  color: var(--tc-muted);
  font-style: italic;
}
.tidb-machine__raft-slot {
  margin-top: 10px;
}
.tidb-machine__raft-state {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--domain-raft, #ff7a59) 48%, var(--tc-border));
  border-radius: 14px;
  padding: 16px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--domain-raft, #ff7a59) 6%, transparent), transparent 46%),
    color-mix(in srgb, var(--tc-panel) 91%, transparent);
}
.tidb-machine__raft-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.tidb-machine__raft-head h2 {
  margin: 3px 0 0;
  font: 760 clamp(16px, 1.8vw, 22px)/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__raft-eyebrow {
  margin: 0;
  color: var(--domain-raft, #ff7a59);
  font: 800 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .13em;
}
.tidb-machine__raft-head-meta {
  display: flex;
  max-width: 50%;
  align-items: flex-end;
  flex-direction: column;
  gap: 6px;
}
.tidb-machine__raft-phase,
.tidb-machine__raft-snapshot,
.tidb-machine__raft-role {
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--tc-border);
  border-radius: 999px;
  padding: 4px 9px;
  font: 700 9px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tidb-machine__raft-phase {
  border-color: color-mix(in srgb, var(--domain-raft, #ff7a59) 60%, var(--tc-border));
  color: var(--domain-raft, #ff7a59);
}
.tidb-machine__raft-phase:is(
  [data-phase-state="leader_lost"],
  [data-phase-state="backoff"],
  [data-phase-state="timeout"]
) {
  border-style: dashed;
  color: var(--tc-yellow);
}
.tidb-machine__raft-snapshot {
  color: var(--tc-muted);
}
.tidb-machine__raft-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 7px;
  margin: 0 0 10px;
}
.tidb-machine__raft-summary > div,
.tidb-machine__raft-facts > div {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--tc-border) 78%, transparent);
  border-radius: 7px;
  padding: 8px 9px;
  background: color-mix(in srgb, var(--tc-panel-2) 68%, transparent);
}
.tidb-machine__raft-summary dt,
.tidb-machine__raft-summary dd,
.tidb-machine__raft-facts dt,
.tidb-machine__raft-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.tidb-machine__raft-summary dt,
.tidb-machine__raft-facts dt {
  color: var(--tc-muted);
  font: 700 9px/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.tidb-machine__raft-summary dd,
.tidb-machine__raft-facts dd {
  margin-top: 4px;
  color: var(--tc-text);
  font: 720 11px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__raft-election-graph {
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  border: 1px solid var(--tc-border);
  border-radius: 11px;
  padding: 12px;
  background: color-mix(in srgb, var(--tc-panel-2) 72%, transparent);
  scrollbar-color: var(--tc-border) transparent;
}
.tidb-machine__raft-election-graph:focus-visible {
  outline: 3px solid var(--tc-cyan);
  outline-offset: 2px;
}
.tidb-machine__raft-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tidb-machine__raft-card-head h3,
.tidb-machine__raft-peers > h3,
.tidb-machine__raft-card h3 {
  margin: 0;
  color: var(--tc-text);
  font: 780 12px/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .03em;
}
.tidb-machine__raft-graph-contract {
  border: 1px solid color-mix(in srgb, var(--domain-raft, #ff7a59) 62%, var(--tc-border));
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--domain-raft, #ff7a59);
  font: 800 9px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .08em;
}
.tidb-machine__raft-direction {
  margin: 6px 0 3px;
  color: var(--tc-muted);
  font-size: 12px;
  line-height: 1.5;
}
.tidb-machine__raft-election-svg {
  display: block;
  width: 100%;
  min-width: 620px;
  height: auto;
}
.tidb-machine__raft-grant {
  fill: none;
  stroke: var(--domain-raft, #ff7a59);
  stroke-width: 2.3;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.tidb-machine__raft-grant.is-pre_vote {
  stroke: var(--tc-yellow);
  stroke-dasharray: 5 4;
}
.tidb-machine__raft-grant.is-vote {
  stroke-width: 2.8;
}
.tidb-machine__raft-prevote-arrow {
  fill: none;
  stroke: var(--tc-yellow);
  stroke-width: 1.8;
}
.tidb-machine__raft-vote-arrow {
  fill: var(--domain-raft, #ff7a59);
}
.tidb-machine__raft-grant-label,
.tidb-machine__raft-node-store,
.tidb-machine__raft-node-role,
.tidb-machine__raft-candidate-label,
.tidb-machine__raft-candidate-quorum {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__raft-grant-label {
  fill: var(--domain-raft, #ff7a59);
  font-size: 8px;
  font-weight: 850;
}
.tidb-machine__raft-grant-label.is-pre_vote {
  fill: var(--tc-yellow);
}
.tidb-machine__raft-node-box {
  fill: color-mix(in srgb, var(--tc-panel) 90%, var(--tc-bg));
  stroke: var(--tc-cyan);
  stroke-width: 1.5;
}
.tidb-machine__raft-node.is-leader .tidb-machine__raft-node-box {
  stroke: var(--domain-raft, #ff7a59);
  stroke-width: 4;
}
.tidb-machine__raft-node.is-candidate .tidb-machine__raft-node-box,
.tidb-machine__raft-node.is-pre_candidate .tidb-machine__raft-node-box {
  stroke: var(--tc-yellow);
  stroke-width: 2.4;
}
.tidb-machine__raft-node.is-down .tidb-machine__raft-node-box {
  stroke: var(--tc-red);
  stroke-width: 2.5;
  stroke-dasharray: 5 3;
}
.tidb-machine__raft-node-store {
  fill: var(--tc-text);
  font-size: 11px;
  font-weight: 850;
}
.tidb-machine__raft-node-role {
  fill: var(--tc-muted);
  font-size: 9px;
  font-weight: 700;
}
.tidb-machine__raft-candidate-box {
  fill: color-mix(in srgb, var(--domain-raft, #ff7a59) 9%, var(--tc-panel));
  stroke: var(--domain-raft, #ff7a59);
  stroke-width: 2.2;
  stroke-dasharray: 10 2 2 2;
}
.tidb-machine__raft-candidate-label {
  fill: var(--tc-text);
  font-size: 10px;
  font-weight: 850;
}
.tidb-machine__raft-candidate-quorum {
  fill: var(--tc-muted);
  font-size: 8.5px;
  font-weight: 700;
}
.tidb-machine__raft-grant-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tidb-machine__raft-grant-list li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--domain-raft, #ff7a59) 30%, var(--tc-border));
  border-radius: 7px;
  padding: 7px 9px;
  color: var(--tc-text);
  font: 700 10px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__raft-grant-list li[data-raft-grant="pre_vote"] {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--tc-yellow) 54%, var(--tc-border));
}
.tidb-machine__raft-grant-list li > strong {
  color: var(--domain-raft, #ff7a59);
}
.tidb-machine__raft-grant-list li[data-raft-grant="pre_vote"] > strong {
  color: var(--tc-yellow);
}
.tidb-machine__raft-grant-list li > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tidb-machine__raft-grant-list li > small {
  color: var(--tc-muted);
  font: inherit;
}
.tidb-machine__raft-empty {
  grid-column: 1 / -1;
  color: var(--tc-muted);
  font-style: italic;
}
.tidb-machine__raft-peers {
  margin-top: 10px;
}
.tidb-machine__raft-peer-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 7px 0 10px;
  padding: 0;
  list-style: none;
}
.tidb-machine__raft-peer {
  min-width: 0;
  border: 1px solid var(--tc-border);
  border-top: 3px solid var(--tc-cyan);
  border-radius: 9px;
  padding: 10px;
  background: color-mix(in srgb, var(--tc-panel-2) 68%, transparent);
}
.tidb-machine__raft-peer[data-peer-role="leader"] {
  border-top: 5px double var(--domain-raft, #ff7a59);
}
.tidb-machine__raft-peer:is(
  [data-peer-role="candidate"],
  [data-peer-role="pre_candidate"]
) {
  border-top-style: solid;
  border-top-color: var(--tc-yellow);
  border-radius: 3px;
}
.tidb-machine__raft-peer[data-peer-health="down"] {
  border-style: dashed;
  border-color: var(--tc-red);
}
.tidb-machine__raft-peer-head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
}
.tidb-machine__raft-peer-head > strong {
  overflow: hidden;
  color: var(--tc-text);
  font: 820 11px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tidb-machine__raft-role {
  color: var(--domain-raft, #ff7a59);
}
.tidb-machine__raft-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin: 8px 0 0;
}
.tidb-machine__raft-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.tidb-machine__raft-card {
  min-width: 0;
  border: 1px solid var(--tc-border);
  border-radius: 9px;
  padding: 11px;
  background: color-mix(in srgb, var(--tc-panel-2) 64%, transparent);
}
.tidb-machine__raft-card.is-pd-boundary {
  border-left: 4px solid var(--domain-tso, #ffd166);
}
.tidb-machine__raft-card.is-retry-boundary {
  border-left: 4px solid var(--tc-cyan);
}
.tidb-machine__raft-card[data-client-result="success"] {
  border-left-style: double;
  border-left-width: 6px;
}
.tidb-machine__raft-policy-note,
.tidb-machine__raft-boundary-note {
  margin: 8px 0 0;
  padding-left: 8px;
  border-left: 3px solid var(--tc-muted);
  color: var(--tc-muted);
  font: 11px/1.48 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__raft-policy-note {
  border-left-color: var(--tc-yellow);
  color: var(--tc-yellow);
  font-weight: 750;
}
.tidb-machine__protocol-slot {
  margin-top: 10px;
}
.tidb-machine__protocol-state {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--domain-txn2pc, #e28cff) 52%, var(--tc-border));
  border-radius: 14px;
  padding: 16px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--domain-txn2pc, #e28cff) 7%, transparent), transparent 42%),
    color-mix(in srgb, var(--tc-panel) 92%, transparent);
}
.tidb-machine__protocol-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.tidb-machine__protocol-head h2 {
  margin: 3px 0 0;
  font: 760 clamp(16px, 1.8vw, 22px)/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__protocol-eyebrow {
  margin: 0;
  color: var(--domain-txn2pc, #e28cff);
  font: 800 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .13em;
}
.tidb-machine__protocol-head-meta {
  display: flex;
  max-width: 52%;
  align-items: flex-end;
  flex-direction: column;
  gap: 6px;
}
.tidb-machine__protocol-phase,
.tidb-machine__protocol-snapshot,
.tidb-machine__protocol-stage {
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--tc-border);
  border-radius: 999px;
  padding: 4px 9px;
  font: 700 9px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tidb-machine__protocol-phase {
  border-color: color-mix(in srgb, var(--domain-txn2pc, #e28cff) 62%, var(--tc-border));
  color: var(--domain-txn2pc, #e28cff);
}
.tidb-machine__protocol-phase.is-complete {
  border-style: double;
  border-width: 3px;
  color: var(--tc-cyan);
}
.tidb-machine__protocol-snapshot { color: var(--tc-muted); }
.tidb-machine__protocol-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
  margin: 0 0 10px;
}
.tidb-machine__protocol-summary > div,
.tidb-machine__protocol-facts > div,
.tidb-machine__protocol-lane-identity > div {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--tc-border) 78%, transparent);
  border-radius: 7px;
  padding: 8px 9px;
  background: color-mix(in srgb, var(--tc-panel-2) 68%, transparent);
}
.tidb-machine__protocol-summary dt,
.tidb-machine__protocol-summary dd,
.tidb-machine__protocol-facts dt,
.tidb-machine__protocol-facts dd,
.tidb-machine__protocol-lane-identity dt,
.tidb-machine__protocol-lane-identity dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.tidb-machine__protocol-summary dt,
.tidb-machine__protocol-facts dt,
.tidb-machine__protocol-lane-identity dt {
  color: var(--tc-muted);
  font: 700 9px/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.tidb-machine__protocol-summary dd,
.tidb-machine__protocol-facts dd,
.tidb-machine__protocol-lane-identity dd {
  margin-top: 4px;
  color: var(--tc-text);
  font: 720 11px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__protocol-graph {
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  border: 1px solid var(--tc-border);
  border-radius: 11px;
  padding: 12px;
  background: color-mix(in srgb, var(--tc-panel-2) 72%, transparent);
  scrollbar-color: var(--tc-border) transparent;
}
.tidb-machine__protocol-graph:focus-visible {
  outline: 3px solid var(--tc-cyan);
  outline-offset: 2px;
}
.tidb-machine__protocol-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tidb-machine__protocol-card-head h3,
.tidb-machine__protocol-lane-head h3,
.tidb-machine__protocol-card h4 {
  margin: 0;
  color: var(--tc-text);
  font: 780 12px/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .03em;
}
.tidb-machine__protocol-graph-contract {
  border: 1px solid color-mix(in srgb, var(--domain-txn2pc, #e28cff) 62%, var(--tc-border));
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--domain-txn2pc, #e28cff);
  font: 800 9px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .05em;
}
.tidb-machine__protocol-direction {
  margin: 7px 0 11px;
  color: var(--tc-muted);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__protocol-visual {
  min-width: 1080px;
}
.tidb-machine__protocol-lane {
  --protocol-color: var(--domain-txn2pc, #e28cff);
  min-width: 0;
  margin-top: 10px;
  border: 1px solid color-mix(in srgb, var(--protocol-color) 38%, var(--tc-border));
  border-left: 5px solid var(--protocol-color);
  border-radius: 10px;
  padding: 11px;
  background: color-mix(in srgb, var(--tc-panel) 75%, transparent);
}
.tidb-machine__protocol-lane.is-one_pc {
  --protocol-color: var(--tc-cyan);
}
.tidb-machine__protocol-lane.is-async_commit {
  --protocol-color: var(--domain-tso, #ffd166);
}
.tidb-machine__protocol-lane.is-two_pc {
  --protocol-color: var(--domain-txn2pc, #e28cff);
}
.tidb-machine__protocol-lane.is-focused {
  border-top-style: double;
  border-top-width: 4px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--protocol-color) 24%, transparent);
}
.tidb-machine__protocol-lane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tidb-machine__protocol-lane-head > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tidb-machine__protocol-lane-code {
  border: 1px solid var(--protocol-color);
  border-radius: 4px;
  padding: 3px 6px;
  color: var(--protocol-color);
  font: 850 9px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .08em;
}
.tidb-machine__protocol-stage {
  border-color: color-mix(in srgb, var(--protocol-color) 58%, var(--tc-border));
  color: var(--protocol-color);
}
.tidb-machine__protocol-stage.is-idle {
  border-style: dashed;
  color: var(--tc-muted);
}
.tidb-machine__protocol-stage.is-complete {
  border-style: double;
  border-width: 3px;
}
.tidb-machine__protocol-lane-identity {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin: 8px 0 0;
}
.tidb-machine__protocol-flow {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  margin-top: 9px;
  border-block: 1px solid color-mix(in srgb, var(--tc-border) 70%, transparent);
  padding: 8px 2px;
  scrollbar-color: var(--tc-border) transparent;
}
.tidb-machine__protocol-node {
  display: inline-flex;
  min-width: 105px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid currentColor;
  border-radius: 7px;
  padding: 6px 8px;
  color: var(--tc-muted);
  font: 720 9px/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: center;
}
.tidb-machine__protocol-node::before { content: "○"; }
.tidb-machine__protocol-node.is-current {
  border-width: 2px;
  color: var(--protocol-color);
}
.tidb-machine__protocol-node.is-current::before { content: "◆"; }
.tidb-machine__protocol-node.is-complete {
  border-style: double;
  border-width: 3px;
  color: var(--protocol-color);
}
.tidb-machine__protocol-node.is-complete::before { content: "✓"; }
.tidb-machine__protocol-node.is-background {
  border-style: dashed;
}
.tidb-machine__protocol-edge {
  flex: 0 0 auto;
  min-width: 18px;
  color: var(--tc-muted);
  font: 900 15px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: center;
}
.tidb-machine__protocol-edge.is-current,
.tidb-machine__protocol-edge.is-complete {
  color: var(--protocol-color);
}
.tidb-machine__protocol-edge.is-background {
  text-decoration: underline dashed;
  text-underline-offset: 3px;
}
.tidb-machine__protocol-details {
  display: grid;
  grid-template-columns: 1.15fr 1fr 1.45fr .7fr;
  gap: 8px;
  margin-top: 9px;
}
.tidb-machine__protocol-card {
  min-width: 0;
  border: 1px solid var(--tc-border);
  border-radius: 9px;
  padding: 10px;
  background: color-mix(in srgb, var(--tc-panel-2) 64%, transparent);
}
.tidb-machine__protocol-card h4 {
  margin-bottom: 8px;
}
.tidb-machine__protocol-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
}
.tidb-machine__protocol-eligibility {
  border-top: 3px solid var(--domain-txn2pc, #e28cff);
}
.tidb-machine__protocol-timestamps {
  display: grid;
  gap: 6px;
  margin: 0;
}
.tidb-machine__protocol-timestamp {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--tc-border) 78%, transparent);
  border-left: 3px solid var(--domain-tso, #ffd166);
  border-radius: 7px;
  padding: 7px 8px;
  background: color-mix(in srgb, var(--tc-panel) 62%, transparent);
}
.tidb-machine__protocol-timestamp.is-pending {
  border-left-style: dashed;
  opacity: .72;
}
.tidb-machine__protocol-timestamp.is-not-applicable {
  border-left-color: var(--tc-muted);
  border-left-style: dotted;
  opacity: .72;
}
.tidb-machine__protocol-timestamp dt,
.tidb-machine__protocol-timestamp dd {
  margin: 0;
}
.tidb-machine__protocol-timestamp dt {
  color: var(--tc-muted);
  font: 700 9px/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__protocol-timestamp dd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-top: 3px;
  color: var(--tc-text);
  font: 720 10px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__protocol-timestamp small {
  max-width: 68%;
  color: var(--tc-muted);
  font-weight: 500;
  text-align: right;
}
.tidb-machine__protocol-region-list {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tidb-machine__protocol-region {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--domain-raft, #ff7a59) 40%, var(--tc-border));
  border-left: 4px solid var(--domain-raft, #ff7a59);
  border-radius: 8px;
  padding: 8px;
  background: color-mix(in srgb, var(--tc-panel) 62%, transparent);
}
.tidb-machine__protocol-region.is-idle {
  border-left-style: dashed;
}
.tidb-machine__protocol-region.is-applied {
  border-left-style: double;
  border-left-width: 6px;
}
.tidb-machine__protocol-region-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.tidb-machine__protocol-region-head strong {
  color: var(--domain-raft, #ff7a59);
  font: 800 11px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__protocol-region-head span {
  color: var(--tc-muted);
  font: 800 8px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .08em;
}
.tidb-machine__protocol-boundary {
  border-top: 3px solid var(--tc-cyan);
}
.tidb-machine__protocol-boundary > strong {
  display: block;
  margin-bottom: 6px;
  color: var(--tc-text);
  font: 750 11px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__protocol-boundary h4:not(:first-child) {
  margin-top: 14px;
}
.tidb-machine__protocol-path-label {
  margin: 5px 0 0;
  color: var(--tc-muted);
  font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__protocol-path-label.is-critical {
  color: var(--tc-cyan);
}
.tidb-machine__protocol-path-label.is-background {
  border-top: 1px dashed var(--tc-muted);
  padding-top: 5px;
}
.tidb-machine__protocol-mirror {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  overflow: hidden !important;
  clip: rect(0 0 0 0) !important;
  clip-path: inset(50%) !important;
  white-space: nowrap !important;
}
.tidb-machine__protocol-notes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}
.tidb-machine__protocol-boundary-note,
.tidb-machine__protocol-model-note {
  margin: 0;
  border-left: 3px solid var(--tc-muted);
  padding: 8px 10px;
  color: var(--tc-muted);
  background: color-mix(in srgb, var(--tc-panel-2) 62%, transparent);
  font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__protocol-model-note {
  border-left-color: var(--tc-yellow);
  color: var(--tc-yellow);
  font-weight: 740;
}
.tidb-machine__detail {
  position: relative;
  min-height: 8em;
  margin-top: 10px;
  padding: 15px 16px 16px;
  overflow: hidden;
  border: 1px solid var(--tc-border);
  border-left: 4px solid var(--detail-color, var(--tc-cyan));
  border-radius: 10px;
  background: color-mix(in srgb, var(--tc-panel-2) 78%, transparent);
}
.tidb-machine__detail[data-current-domain="sql"] { --detail-color: var(--domain-sql, #20d9c2); }
.tidb-machine__detail[data-current-domain="tso"] { --detail-color: var(--domain-tso, #ffd166); }
.tidb-machine__detail[data-current-domain="txn2pc"] { --detail-color: var(--domain-txn2pc, #e28cff); }
.tidb-machine__detail[data-current-domain="raft"] { --detail-color: var(--domain-raft, #ff7a59); }
.tidb-machine__detail[data-current-domain="kv"] { --detail-color: var(--domain-kv, #64e572); }
.tidb-machine__detail[data-current-domain="tiflash"] { --detail-color: var(--domain-tiflash, #49a7ff); }
.tidb-machine__detail::after {
  position: absolute;
  top: 0;
  right: 0;
  width: 30%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--detail-color, var(--tc-cyan)));
  content: "";
}
.tidb-machine__detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tidb-machine__detail-eyebrow {
  margin: 0;
  color: var(--detail-color, var(--tc-cyan));
  font: 800 10px/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .11em;
  text-transform: uppercase;
}
.tidb-machine__detail h2 {
  margin: 9px 0 12px;
  color: var(--tc-text);
  font: 750 clamp(16px, 1.7vw, 21px)/1.25 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__detail-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(138px, 1fr));
  gap: 8px;
  margin: 0;
}
.tidb-machine__detail-meta > div {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--tc-border) 75%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--tc-panel) 54%, transparent);
}
.tidb-machine__detail-meta dt {
  color: var(--tc-muted);
  font: 700 9px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.tidb-machine__detail-meta dd {
  overflow: hidden;
  margin: 4px 0 0;
  color: var(--tc-text);
  font: 700 12px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tidb-machine__detail-copy {
  margin: 12px 0 0;
  color: var(--tc-text);
  line-height: 1.55;
}
.tidb-machine__route {
  margin: 10px 0 0;
  color: var(--tc-muted);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tidb-machine__route strong { color: var(--detail-color, var(--tc-cyan)); }
.tidb-machine__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin: 0;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--tc-cyan);
  font: 750 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .04em;
}
.tidb-machine__status::before { content: "✓"; }
.tidb-machine__status.is-queued {
  color: var(--tc-muted);
  border-style: dashed;
}
.tidb-machine__status.is-queued::before { content: "○"; }
.tidb-machine__status.is-active { color: var(--tc-cyan); }
.tidb-machine__status.is-active::before { content: "◆"; }
.tidb-machine__status.is-warning {
  color: var(--tc-yellow);
  border-style: dashed;
}
.tidb-machine__status.is-warning::before { content: "!"; }
.tidb-machine__status.is-failed {
  color: var(--tc-red);
  border-style: double;
  border-width: 3px;
}
.tidb-machine__status.is-failed::before { content: "×"; }
.tidb-machine__empty {
  padding: 28px;
  color: var(--tc-muted);
  text-align: center;
}
.tidb-machine__note {
  margin: 10px 2px 0;
  color: var(--tc-muted);
  font-size: 12px;
}
@media (max-width: 760px) {
  .tidb-machine { padding: 14px; }
  .tidb-machine__overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tidb-machine__metric:nth-child(3) { border-left: 0; }
  .tidb-machine__metric:nth-child(n + 3) { border-top: 1px solid var(--tc-border); }
  .tidb-machine__transport { grid-template-columns: 1fr; gap: 10px; }
  .tidb-machine__controls .tidb-button { flex: 1 1 72px; }
  .tidb-machine__svg { min-width: 920px; }
  .tidb-machine__lock-grid { grid-template-columns: 1fr; }
  .tidb-machine__raft-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tidb-machine__raft-peer-list,
  .tidb-machine__raft-grid { grid-template-columns: 1fr; }
  .tidb-machine__raft-grant-list { grid-template-columns: 1fr; }
  .tidb-machine__protocol-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .tidb-machine__protocol-notes { grid-template-columns: 1fr; }
  .tidb-machine__wait-list li {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  }
  .tidb-machine__wait-list li > small { grid-column: 1 / -1; }
}
@media (max-width: 520px) {
  .tidb-machine__detail-head { align-items: flex-start; }
  .tidb-machine__detail-meta { grid-template-columns: 1fr; }
  .tidb-machine__detail-meta dd { white-space: normal; }
  .tidb-machine__raft-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .tidb-machine__raft-head-meta {
    width: 100%;
    max-width: none;
    align-items: flex-start;
  }
  .tidb-machine__protocol-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .tidb-machine__protocol-head-meta {
    width: 100%;
    max-width: none;
    align-items: flex-start;
  }
  .tidb-machine__protocol-summary { grid-template-columns: 1fr; }
  .tidb-machine__protocol-card-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .tidb-machine__raft-summary,
  .tidb-machine__raft-facts { grid-template-columns: 1fr; }
  .tidb-machine__raft-card-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .tidb-machine__raft-grant-list li {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .tidb-machine__raft-grant-list li > strong {
    grid-column: 1 / -1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tidb-machine *,
  .tidb-machine *::before,
  .tidb-machine *::after {
    scroll-behavior: auto !important;
    transition-duration: .001ms !important;
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
  }
}
`

export function installMachineStyles(doc: Document = document): void {
  installStyle('tidb-machine-styles', MACHINE_CSS, doc)
}
