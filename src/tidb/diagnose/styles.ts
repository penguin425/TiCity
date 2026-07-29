// SPDX-License-Identifier: Apache-2.0

import { installStyle } from '../ui/dom'

export const DIAGNOSE_CSS = `
.tidb-diagnose {
  --diag-healthy: #52d3a4;
  --diag-attention: #ffd166;
  --diag-critical: #ff6678;
  --diag-neutral: #7895a0;
  --diag-surface: rgba(10, 30, 37, 0.82);
  --diag-surface-raised: rgba(16, 43, 52, 0.88);
  --diag-surface-soft: rgba(98, 234, 219, 0.055);
  --diag-shadow: rgba(0, 0, 0, 0.24);
  position: relative;
  min-height: 100%;
  isolation: isolate;
  overflow: hidden;
  padding: clamp(16px, 2.25vw, 34px);
  background:
    radial-gradient(circle at 9% -8%, color-mix(in srgb, var(--tc-cyan) 16%, transparent), transparent 30rem),
    radial-gradient(circle at 94% 4%, color-mix(in srgb, var(--tc-yellow) 9%, transparent), transparent 25rem),
    linear-gradient(145deg, color-mix(in srgb, var(--tc-bg) 94%, #001018), var(--tc-bg));
  color: var(--tc-text);
}

:root[data-theme="day"] .tidb-diagnose {
  --diag-healthy: #087854;
  --diag-attention: #9a6c00;
  --diag-critical: #bc3044;
  --diag-neutral: #6f8790;
  --diag-surface: rgba(248, 253, 254, 0.86);
  --diag-surface-raised: rgba(255, 255, 255, 0.91);
  --diag-surface-soft: rgba(0, 123, 130, 0.05);
  --diag-shadow: rgba(33, 73, 88, 0.14);
}

.tidb-diagnose::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, var(--tc-border) 19%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--tc-border) 19%, transparent) 1px, transparent 1px);
  background-size: 34px 34px;
  content: "";
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.54), transparent 48rem);
  pointer-events: none;
}

.tidb-diagnose > * {
  position: relative;
  z-index: 1;
}

.tidb-diagnose__head {
  display: grid;
  overflow: hidden;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 24px;
  padding: clamp(20px, 2.7vw, 34px);
  border: 1px solid var(--tc-border);
  border-radius: 18px;
  background:
    linear-gradient(108deg, color-mix(in srgb, var(--tc-cyan) 11%, transparent), transparent 42%),
    var(--diag-surface);
  box-shadow:
    0 22px 52px var(--diag-shadow),
    inset 0 1px 0 color-mix(in srgb, var(--tc-text) 10%, transparent);
}

.tidb-diagnose__head::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  background: linear-gradient(var(--tc-cyan), color-mix(in srgb, var(--tc-cyan) 15%, transparent));
  content: "";
}

.tidb-diagnose__head::after {
  position: absolute;
  right: -4rem;
  bottom: -7rem;
  width: 24rem;
  height: 16rem;
  border: 1px solid color-mix(in srgb, var(--tc-cyan) 16%, transparent);
  border-radius: 50%;
  box-shadow:
    0 0 0 2.8rem color-mix(in srgb, var(--tc-cyan) 2.5%, transparent),
    0 0 0 5.4rem color-mix(in srgb, var(--tc-cyan) 2%, transparent);
  content: "";
  transform: rotate(-12deg);
  pointer-events: none;
}

.tidb-diagnose__head-copy,
.tidb-diagnose__head-meta {
  position: relative;
  z-index: 1;
}

.tidb-diagnose__eyebrow {
  margin: 0 0 10px !important;
  color: var(--tc-cyan) !important;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.tidb-diagnose__eyebrow::before {
  display: inline-block;
  width: 1.9rem;
  height: 1px;
  margin: 0 0.65rem 0.2rem 0;
  background: currentColor;
  content: "";
}

.tidb-diagnose__head h1 {
  margin: 0;
  font: 760 clamp(24px, 3.1vw, 42px)/1 ui-monospace, "SFMono-Regular", Consolas, monospace;
  letter-spacing: -0.055em;
}

.tidb-diagnose__head-copy > p:last-child {
  max-width: 66ch;
  margin: 13px 0 0;
  color: var(--tc-muted);
  font-size: clamp(12px, 1.15vw, 15px);
  line-height: 1.65;
}

.tidb-diagnose__head-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 3px;
}

.tidb-diagnose__head-pulse {
  position: relative;
  width: 10px;
  height: 10px;
  border: 2px solid var(--tc-cyan);
  border-radius: 50%;
  box-shadow: 0 0 13px color-mix(in srgb, var(--tc-cyan) 70%, transparent);
}

.tidb-diagnose__head-pulse::after {
  position: absolute;
  inset: -6px;
  border: 1px solid color-mix(in srgb, var(--tc-cyan) 35%, transparent);
  border-radius: inherit;
  content: "";
}

.tidb-diagnose .tidb-model-badge {
  flex: 0 0 auto;
  background: color-mix(in srgb, var(--diag-surface-raised) 88%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--tc-text) 8%, transparent);
}

.tidb-diagnose__summary {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--tc-border);
  border-radius: 16px;
  background: var(--diag-surface);
  box-shadow: 0 14px 34px color-mix(in srgb, var(--diag-shadow) 80%, transparent);
}

.tidb-diagnose__summary-head,
.tidb-diagnose__summary-state,
.tidb-diagnose__metric-head,
.tidb-diagnose__panel-head,
.tidb-diagnose__panel-title,
.tidb-diagnose__guides-head,
.tidb-diagnose__guide-head {
  display: flex;
  align-items: center;
}

.tidb-diagnose__summary-head,
.tidb-diagnose__panel-head,
.tidb-diagnose__guides-head {
  justify-content: space-between;
}

.tidb-diagnose__summary-head {
  gap: 16px;
  padding: 0 2px 13px;
}

.tidb-diagnose__summary h2,
.tidb-diagnose__panel h2,
.tidb-diagnose__guides h2 {
  margin: 0;
  font: 760 13px/1.3 ui-monospace, "SFMono-Regular", Consolas, monospace;
  letter-spacing: 0.015em;
}

.tidb-diagnose__summary-state {
  gap: 9px;
}

.tidb-diagnose__summary-status,
.tidb-diagnose__metric-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.tidb-diagnose__summary-status {
  padding: 5px 8px;
  border: 1px solid currentColor;
}

.tidb-diagnose__summary[data-tone="healthy"] .tidb-diagnose__summary-status {
  color: var(--diag-healthy);
}

.tidb-diagnose__summary[data-tone="attention"] .tidb-diagnose__summary-status {
  color: var(--diag-attention);
}

.tidb-diagnose__summary[data-tone="critical"] .tidb-diagnose__summary-status {
  color: var(--diag-critical);
}

.tidb-diagnose__summary-status::before,
.tidb-diagnose__metric-state::before {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
  content: "";
}

.tidb-diagnose__metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 9px;
}

.tidb-diagnose__metric {
  position: relative;
  min-width: 0;
  min-height: 146px;
  overflow: hidden;
  padding: 13px 13px 10px;
  border: 1px solid color-mix(in srgb, var(--tc-border) 82%, transparent);
  border-radius: 12px;
  background:
    linear-gradient(145deg, var(--diag-surface-raised), color-mix(in srgb, var(--diag-surface-raised) 70%, transparent));
  transition: border-color 160ms ease, transform 160ms ease;
}

.tidb-diagnose__metric::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 2px;
  background: var(--metric-tone, var(--diag-neutral));
  content: "";
}

.tidb-diagnose__metric[data-tone="healthy"] { --metric-tone: var(--diag-healthy); }
.tidb-diagnose__metric[data-tone="attention"] { --metric-tone: var(--diag-attention); }
.tidb-diagnose__metric[data-tone="critical"] { --metric-tone: var(--diag-critical); }
.tidb-diagnose__metric[data-tone="neutral"] { --metric-tone: var(--diag-neutral); }

.tidb-diagnose__metric:hover {
  border-color: color-mix(in srgb, var(--metric-tone) 52%, var(--tc-border));
  transform: translateY(-2px);
}

.tidb-diagnose__metric-head {
  min-width: 0;
  justify-content: space-between;
  gap: 6px;
}

.tidb-diagnose__metric-label,
.tidb-diagnose__metric-detail {
  margin: 0;
  color: var(--tc-muted);
}

.tidb-diagnose__metric-label {
  min-width: 0;
  font-size: 9px;
  font-weight: 760;
  line-height: 1.25;
  letter-spacing: 0.085em;
  text-transform: uppercase;
}

.tidb-diagnose__metric-state {
  flex: 0 0 auto;
  color: var(--metric-tone);
  font-size: 7px;
}

.tidb-diagnose__metric-value {
  display: block;
  overflow: hidden;
  margin-top: 10px;
  color: var(--tc-text);
  font: 760 clamp(19px, 2vw, 28px)/1 ui-monospace, "SFMono-Regular", Consolas, monospace;
  letter-spacing: -0.055em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tidb-diagnose__metric-detail {
  min-height: 2.6em;
  margin-top: 7px;
  font-size: 9px;
  line-height: 1.3;
}

.tidb-diagnose__spark {
  display: block;
  width: 100%;
  height: 32px;
  margin-top: 6px;
  overflow: visible;
}

.tidb-diagnose__spark-baseline {
  stroke: color-mix(in srgb, var(--tc-border) 70%, transparent);
  stroke-width: 1;
}

.tidb-diagnose__spark-bar,
.tidb-diagnose__spark-fill {
  fill: var(--diag-neutral);
}

.tidb-diagnose__spark-bar--healthy,
.tidb-diagnose__spark-fill--healthy { fill: var(--diag-healthy); }
.tidb-diagnose__spark-bar--attention,
.tidb-diagnose__spark-fill--attention { fill: var(--diag-attention); }
.tidb-diagnose__spark-bar--critical,
.tidb-diagnose__spark-fill--critical { fill: var(--diag-critical); }
.tidb-diagnose__spark-bar--neutral,
.tidb-diagnose__spark-fill--neutral { fill: var(--diag-neutral); }

.tidb-diagnose__spark-track {
  fill: color-mix(in srgb, var(--tc-border) 38%, transparent);
}

.tidb-diagnose__spark-empty {
  stroke: var(--diag-neutral);
  stroke-width: 1;
  stroke-dasharray: 3 4;
}

.tidb-diagnose__grid {
  display: grid;
  grid-template-columns: minmax(22rem, 0.85fr) minmax(0, 1.15fr);
  grid-template-areas:
    "cluster transactions"
    "cluster hot"
    "cluster gc"
    "cluster tiflash"
    "regions regions";
  align-items: stretch;
  gap: 12px;
  margin-top: 16px;
}

.tidb-diagnose__panel {
  --panel-tone: var(--diag-neutral);
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--tc-border);
  border-radius: 14px;
  background: var(--diag-surface-raised);
  box-shadow: 0 12px 28px color-mix(in srgb, var(--diag-shadow) 70%, transparent);
}

.tidb-diagnose__panel[data-tone="healthy"] { --panel-tone: var(--diag-healthy); }
.tidb-diagnose__panel[data-tone="attention"] { --panel-tone: var(--diag-attention); }
.tidb-diagnose__panel[data-tone="critical"] { --panel-tone: var(--diag-critical); }

.tidb-diagnose__panel::before {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  left: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--panel-tone), transparent 74%);
  content: "";
  pointer-events: none;
}

.tidb-diagnose__panel[data-diagnose-section="cluster"] { grid-area: cluster; }
.tidb-diagnose__panel[data-diagnose-section="transactions"] { grid-area: transactions; }
.tidb-diagnose__panel[data-diagnose-section="hot-regions"] { grid-area: hot; }
.tidb-diagnose__panel[data-diagnose-section="regions"] { grid-area: regions; }
.tidb-diagnose__panel[data-diagnose-section="gc"] { grid-area: gc; }
.tidb-diagnose__panel[data-diagnose-section="tiflash"] { grid-area: tiflash; }

.tidb-diagnose__panel-head {
  min-height: 56px;
  gap: 12px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--tc-border) 58%, transparent);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--panel-tone) 5%, transparent), transparent 55%);
}

.tidb-diagnose__panel-title {
  min-width: 0;
  gap: 9px;
}

.tidb-diagnose__panel-title h2 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tidb-diagnose__row-count,
.tidb-diagnose__guide-count {
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--tc-border) 78%, transparent);
  border-radius: 999px;
  color: var(--tc-muted);
  background: var(--diag-surface-soft);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.tidb-diagnose__row-count {
  padding: 3px 6px;
}

.tidb-diagnose__scroll {
  max-width: 100%;
  margin: 0 9px 10px;
  overflow-x: auto;
  border-radius: 8px;
  outline: none;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--panel-tone) 50%, var(--tc-border)) transparent;
  scrollbar-width: thin;
}

.tidb-diagnose__scroll:focus-visible {
  outline: 2px solid var(--tc-cyan);
  outline-offset: 2px;
}

.tidb-diagnose__panel[data-diagnose-section="regions"] .tidb-diagnose__scroll {
  max-height: min(58dvh, 39rem);
  overflow: auto;
  scrollbar-gutter: stable;
}

.tidb-diagnose__table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font: 11px/1.45 ui-monospace, "SFMono-Regular", Consolas, monospace;
}

.tidb-diagnose__table th {
  position: sticky;
  z-index: 2;
  top: 0;
  padding: 8px 9px;
  border-bottom: 1px solid var(--tc-border);
  color: var(--tc-muted);
  background: color-mix(in srgb, var(--diag-surface-raised) 96%, transparent);
  font-size: 8px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
  backdrop-filter: blur(10px);
}

.tidb-diagnose__table td {
  padding: 8px 9px;
  border-bottom: 1px solid color-mix(in srgb, var(--tc-border) 38%, transparent);
  color: color-mix(in srgb, var(--tc-text) 93%, var(--tc-muted));
  white-space: nowrap;
}

.tidb-diagnose__table tbody tr {
  transition: background-color 120ms ease;
}

.tidb-diagnose__table tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--diag-surface-soft) 72%, transparent);
}

.tidb-diagnose__table tbody tr:hover {
  background: color-mix(in srgb, var(--tc-cyan) 7%, var(--diag-surface-soft));
}

.tidb-diagnose__table tbody tr[data-tone="critical"] td:first-child {
  box-shadow: inset 2px 0 var(--diag-critical);
}

.tidb-diagnose__table tbody tr[data-tone="attention"] td:first-child {
  box-shadow: inset 2px 0 var(--diag-attention);
}

.tidb-diagnose__table tbody tr:last-child td {
  border-bottom: 0;
}

.tidb-diagnose__table td[data-column="id"],
.tidb-diagnose__table td[data-column="leader"],
.tidb-diagnose__table td[data-column="role"] {
  color: var(--tc-text);
  font-weight: 650;
}

.tidb-diagnose__table td[data-tone="critical"] {
  color: var(--diag-critical);
}

.tidb-diagnose__table td[data-tone="attention"] {
  color: var(--diag-attention);
}

.tidb-diagnose__state {
  display: inline-flex;
  min-height: 20px;
  align-items: center;
  gap: 6px;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 999px;
  padding: 2px 7px 2px 5px;
  background: color-mix(in srgb, currentColor 7%, transparent);
  color: var(--diag-neutral);
  font-size: 9px;
  font-weight: 720;
  text-transform: lowercase;
}

.tidb-diagnose__state[data-tone="healthy"] { color: var(--diag-healthy); }
.tidb-diagnose__state[data-tone="attention"] { color: var(--diag-attention); }
.tidb-diagnose__state[data-tone="critical"] { color: var(--diag-critical); }

.tidb-diagnose__state-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 7px currentColor;
}

.tidb-diagnose__cell-meter {
  display: grid;
  min-width: 66px;
  grid-template-columns: 2.3em minmax(34px, 1fr);
  align-items: center;
  gap: 7px;
}

.tidb-diagnose__cell-value {
  color: currentColor;
  font-weight: 720;
  font-variant-numeric: tabular-nums;
}

.tidb-diagnose__cell-meter-track {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tc-border) 45%, transparent);
}

.tidb-diagnose__cell-meter-fill {
  display: block;
  width: var(--meter);
  height: 100%;
  border-radius: inherit;
  background: currentColor;
  box-shadow: 0 0 7px currentColor;
}

.tidb-diagnose__empty {
  display: flex;
  min-height: 86px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  color: var(--tc-muted);
  text-align: center;
}

.tidb-diagnose__empty p {
  margin: 0;
}

.tidb-diagnose__empty-mark {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 1px solid var(--tc-border);
  border-radius: 50%;
  color: var(--panel-tone);
  font-weight: 800;
}

.tidb-diagnose__guides {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--tc-border);
}

.tidb-diagnose__guides-head {
  gap: 14px;
  margin-bottom: 13px;
}

.tidb-diagnose__guides h2 {
  font-size: 15px;
}

.tidb-diagnose__guide-count {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
}

.tidb-diagnose__guide-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 11px;
}

.tidb-diagnose__guide {
  --guide-accent: var(--tc-yellow);
  position: relative;
  min-width: 0;
  overflow: hidden;
  padding: 15px;
  border: 1px solid var(--tc-border);
  border-radius: 12px;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--guide-accent) 6%, transparent), transparent 55%),
    var(--diag-surface-raised);
}

.tidb-diagnose__guide[data-guide="slow-query"] { --guide-accent: var(--tc-cyan); }
.tidb-diagnose__guide[data-guide="lock-wait"] { --guide-accent: #ff9f68; }
.tidb-diagnose__guide[data-guide="hot-region"] { --guide-accent: var(--diag-attention); }
.tidb-diagnose__guide[data-guide="region-health"] { --guide-accent: var(--diag-critical); }
.tidb-diagnose__guide[data-guide="gc-backlog"] { --guide-accent: #b994ff; }
.tidb-diagnose__guide[data-guide="tiflash-lag"] { --guide-accent: #49a7ff; }

.tidb-diagnose__guide::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: var(--guide-accent);
  content: "";
}

.tidb-diagnose__guide-head {
  align-items: flex-start;
  gap: 9px;
}

.tidb-diagnose__guide-index {
  flex: 0 0 auto;
  color: var(--guide-accent);
  font: 800 9px/1.5 ui-monospace, monospace;
  letter-spacing: 0.08em;
}

.tidb-diagnose__guide h3 {
  margin: 0;
  color: var(--tc-text);
  font: 760 12px/1.45 ui-monospace, "SFMono-Regular", Consolas, monospace;
}

.tidb-diagnose__guide-copy {
  min-height: 4.2em;
  margin: 11px 0 0;
  color: var(--tc-muted);
  font-size: 11px;
  line-height: 1.55;
}

.tidb-diagnose__real-check {
  margin: 12px 0 0;
  color: var(--guide-accent);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.tidb-diagnose__guide-sql {
  margin-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--tc-border) 56%, transparent);
}

.tidb-diagnose__guide-sql summary {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--tc-muted);
  cursor: pointer;
  font-size: 9px;
  font-weight: 700;
  list-style: none;
}

.tidb-diagnose__guide-sql summary::-webkit-details-marker {
  display: none;
}

.tidb-diagnose__guide-sql summary::after {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--tc-border);
  border-radius: 50%;
  color: var(--guide-accent);
  content: "+";
  font-size: 12px;
  transition: transform 160ms ease;
}

.tidb-diagnose__guide-sql[open] summary::after {
  content: "−";
  transform: rotate(180deg);
}

.tidb-diagnose__guide-sql summary:focus-visible {
  border-radius: 5px;
  outline: 2px solid var(--tc-cyan);
  outline-offset: 2px;
}

.tidb-diagnose__guide pre {
  max-width: 100%;
  max-height: 19rem;
  margin: 3px 0 1px;
  padding: 11px;
  overflow: auto;
  border: 1px solid var(--tc-border);
  border-radius: 8px;
  color: var(--tc-cyan);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--guide-accent) 6%, transparent), transparent 50%),
    var(--tc-bg);
  font-size: 10px;
  line-height: 1.55;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
  scrollbar-color: var(--tc-border) transparent;
}

.tidb-diagnose__guide pre:focus-visible {
  outline: 2px solid var(--guide-accent);
  outline-offset: 2px;
}

@media (max-width: 1180px) {
  .tidb-diagnose__metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .tidb-diagnose__metric {
    min-height: 132px;
  }

  .tidb-diagnose__grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "cluster"
      "transactions"
      "hot"
      "gc"
      "tiflash"
      "regions";
  }
}

@media (max-width: 880px) {
  .tidb-diagnose__guide-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .tidb-diagnose {
    padding: 12px;
  }

  .tidb-diagnose__head {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    padding: 21px 18px;
    border-radius: 14px;
  }

  .tidb-diagnose__head-meta {
    justify-content: space-between;
  }

  .tidb-diagnose__head::after {
    opacity: 0.55;
  }

  .tidb-diagnose__summary {
    padding: 12px;
  }

  .tidb-diagnose__summary-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .tidb-diagnose__summary-state {
    width: 100%;
    justify-content: space-between;
  }

  .tidb-diagnose__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tidb-diagnose__guide-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .tidb-diagnose__metric {
    min-height: 126px;
  }

  .tidb-diagnose__panel-head {
    align-items: flex-start;
  }

  .tidb-diagnose__panel-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .tidb-diagnose__panel .tidb-model-badge {
    max-width: 9.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tidb-diagnose__table {
    font-size: 10px;
  }

  .tidb-diagnose__guide-copy {
    min-height: 0;
  }
}

@media (max-width: 370px) {
  .tidb-diagnose__metrics {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tidb-diagnose__metric,
  .tidb-diagnose__table tbody tr,
  .tidb-diagnose__guide-sql summary::after {
    transition: none;
  }

  .tidb-diagnose__metric:hover {
    transform: none;
  }
}

@media (prefers-contrast: more) {
  .tidb-diagnose__head,
  .tidb-diagnose__summary,
  .tidb-diagnose__panel,
  .tidb-diagnose__guide {
    border-color: currentColor;
  }

  .tidb-diagnose__table td {
    border-bottom-color: var(--tc-border);
  }
}
`

export function installDiagnoseStyles(doc: Document = document): void {
  installStyle('tidb-diagnose-styles', DIAGNOSE_CSS, doc)
}
