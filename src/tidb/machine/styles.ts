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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
}
@media (max-width: 520px) {
  .tidb-machine__detail-head { align-items: flex-start; }
  .tidb-machine__detail-meta { grid-template-columns: 1fr; }
  .tidb-machine__detail-meta dd { white-space: normal; }
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
