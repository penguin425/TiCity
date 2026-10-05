// SPDX-License-Identifier: Apache-2.0

import type { Locale } from './catalog'
import { element, installStyle } from './dom'
import { traceEventCopy } from './event-copy'
import {
  buildTraceInspectionIndex,
  projectTraceInspection,
  type TraceInspectionEvent,
  type TraceInspectionIndex,
  type TraceInspectionReceipt,
} from './trace-inspection'
import { TRACE_INSPECTION_COPY, TRACE_REFERENCE_GROUPS } from './trace-inspection-copy'

export { buildTraceInspectionIndex } from './trace-inspection'
export type { TraceInspectionIndex } from './trace-inspection'

export interface TraceInspectorOptions {
  readonly open?: boolean
  /** Reuse an index while seeking an immutable receipt. */
  readonly index?: TraceInspectionIndex
}

const MAX_LINKED_EVENTS = 8
const CSS = `
.tidb-trace-inspector { box-sizing: border-box; max-width: 100%; min-width: 0; margin: 12px 0; padding: 12px; color: var(--text, #e8edf5); border: 1px solid var(--border, #40526a); border-radius: 8px; background: var(--surface, #17212d); font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.tidb-trace-inspector * { box-sizing: border-box; min-width: 0; }
.tidb-trace-inspector > summary { cursor: pointer; font-weight: 700; }
.tidb-trace-inspector h3 { font-size: 14px; margin: 14px 0 4px; }
.tidb-trace-inspector p { margin: 4px 0; }
.tidb-trace-inspector__note { opacity: .8; font-size: 12px; }
.tidb-trace-inspector__relations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.tidb-trace-inspector ul { list-style: none; padding: 0; margin: 4px 0; }
.tidb-trace-inspector li { margin: 4px 0; }
.tidb-trace-inspector button { display: block; max-width: 100%; padding: 5px 8px; color: inherit; font: inherit; text-align: left; white-space: normal; overflow-wrap: anywhere; background: transparent; border: 1px solid var(--border, #40526a); border-radius: 4px; cursor: pointer; }
.tidb-trace-inspector code { white-space: normal; overflow-wrap: anywhere; font-size: 12px; }
.tidb-trace-inspector a { color: var(--link, #80c8ff); overflow-wrap: anywhere; }
.tidb-trace-inspector :is(button, a, summary):focus-visible { outline: 3px solid #ffd56a; outline-offset: 3px; }
@media (max-width: 600px) { .tidb-trace-inspector__relations { grid-template-columns: minmax(0, 1fr); gap: 0; } }
`

/** Read-only, common projection for City, Machine, and Diagnose. */
export function createTraceInspector(
  receipt: TraceInspectionReceipt,
  event: TraceInspectionEvent | null,
  locale: Locale,
  onSelect?: (eventId: string) => void,
  options: TraceInspectorOptions = {},
): HTMLElement {
  installStyle('tidb-trace-inspector-style', CSS)
  const copy = TRACE_INSPECTION_COPY[locale]
  const root = element('details', {
    className: 'tidb-trace-inspector',
    attrs: {
      'data-trace-inspector': '',
      'data-inspector-event-id': event?.id ?? '',
      ...(options.open === false ? {} : { open: '' }),
    },
  }, element('summary', { text: `${copy.title} · ${copy.model}` }))
  if (!event) {
    root.append(element('p', { text: copy.empty }))
    return root
  }
  const index = options.index ?? buildTraceInspectionIndex(receipt.events)
  const inspection = projectTraceInspection(index, event)
  const reference = TRACE_REFERENCE_GROUPS[inspection.sourceGroup]
  root.setAttribute('data-inspector-source-group', inspection.sourceGroup)

  const eventNode = (entry: TraceInspectionEvent, relation: string): HTMLElement => {
    const label = traceEventCopy(entry, locale).label
    const content = [element('code', { text: entry.id }), ` · ${label}`]
    if (!onSelect) return element('span', {}, ...content)
    const button = element('button', {
      attrs: {
        type: 'button',
        'aria-label': `${copy.select(entry.id)} · ${label}`,
        'data-inspector-select': entry.id,
        'data-inspector-relation': relation,
      },
    }, ...content)
    button.addEventListener('click', () => onSelect(entry.id))
    return button
  }
  const relations = (
    entries: readonly TraceInspectionEvent[],
    title: string,
    empty: string,
    relation: 'parent' | 'child',
  ): HTMLElement => {
    const section = element('section', { attrs: { 'data-inspector-relations': relation } },
      element('h3', { text: `${title} (${entries.length})` }),
    )
    if (entries.length === 0) section.append(element('p', { text: empty }))
    else {
      const list = element('ul')
      for (const entry of entries.slice(0, MAX_LINKED_EVENTS)) {
        list.append(element('li', {}, eventNode(entry, relation)))
      }
      if (entries.length > MAX_LINKED_EVENTS) {
        list.append(element('li', { text: copy.more(entries.length - MAX_LINKED_EVENTS) }))
      }
      section.append(list)
    }
    return section
  }
  const fence = element('section', { attrs: { 'data-inspector-fence': '' } },
    element('h3', { text: copy.fence }),
  )
  if (inspection.presentationFence) fence.append(eventNode(inspection.presentationFence, 'fence'))
  else if (inspection.presentationFenceId) fence.append(element('code', { text: inspection.presentationFenceId }))
  else fence.append(element('p', { text: copy.noFence }))
  fence.append(element('p', { className: 'tidb-trace-inspector__note', text: copy.fenceNote }))
  const sourceList = element('ul')
  for (const source of reference.sources) {
    sourceList.append(element('li', {}, element('a', {
      text: source.title[locale],
      attrs: { href: source.url, target: '_blank', rel: 'noopener noreferrer', 'data-inspector-source': '' },
    })))
  }
  root.append(
    element('h3', { text: copy.selected }),
    element('p', {}, element('code', { text: event.id }), ` · ${traceEventCopy(event, locale).label}`),
    element('div', { className: 'tidb-trace-inspector__relations' },
      relations(inspection.parents, copy.parents, copy.noParents, 'parent'),
      relations(inspection.children, copy.children, copy.noChildren, 'child'),
    ),
    element('p', { className: 'tidb-trace-inspector__note', text: copy.causalNote }),
    fence,
    element('h3', { text: copy.path }),
    element('p', { text: copy[inspection.path], attrs: { 'data-inspector-path': inspection.path } }),
    element('p', { className: 'tidb-trace-inspector__note', text: copy.pathNote }),
    element('h3', { text: copy.sources }),
    element('p', { text: reference.title[locale] }),
    element('p', { className: 'tidb-trace-inspector__note', text: copy.sourceNote }),
    sourceList,
    element('h3', { text: copy.scope }),
    element('p', { text: reference.scope[locale] }),
  )
  return root
}
