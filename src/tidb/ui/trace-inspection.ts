// SPDX-License-Identifier: Apache-2.0

import type { TraceStateSnapshot } from '../model/types'
import type { TraceEventCopyInput } from './event-copy'

/** Structural input shared by canonical receipts and the Machine adapter. */
export interface TraceInspectionEvent extends TraceEventCopyInput {
  readonly id: string
  readonly dependsOn?: readonly string[]
  readonly presentationAfter?: string
  readonly path?: 'critical' | 'background'
  readonly criticalPath?: boolean
  readonly snapshot?: TraceStateSnapshot
}

export interface TraceInspectionReceipt {
  readonly events: readonly TraceInspectionEvent[]
}

export type TraceSourceGroup =
  | 'overview'
  | 'transaction'
  | 'lock'
  | 'raft'
  | 'protocol'
  | 'gc'
  | 'tiflash'

export interface TraceInspectionIndex {
  readonly eventsById: ReadonlyMap<string, TraceInspectionEvent>
  readonly parentsById: ReadonlyMap<string, readonly TraceInspectionEvent[]>
  readonly childrenById: ReadonlyMap<string, readonly TraceInspectionEvent[]>
}

export interface TraceInspection {
  readonly event: TraceInspectionEvent
  readonly parents: readonly TraceInspectionEvent[]
  readonly children: readonly TraceInspectionEvent[]
  /** A serialization fence is deliberately absent from both adjacency maps. */
  readonly presentationFence: TraceInspectionEvent | null
  readonly presentationFenceId: string | null
  readonly path: 'critical' | 'background' | 'unspecified'
  readonly sourceGroup: TraceSourceGroup
}

/** Build once per immutable receipt. Receipt order never implies causality. */
export function buildTraceInspectionIndex(
  events: readonly TraceInspectionEvent[],
): TraceInspectionIndex {
  const eventsById = new Map(events.map((event) => [event.id, event]))
  const parentsById = new Map<string, readonly TraceInspectionEvent[]>()
  const children = new Map<string, TraceInspectionEvent[]>(
    events.map((event) => [event.id, []]),
  )
  for (const event of events) {
    const parents: TraceInspectionEvent[] = []
    for (const id of new Set(event.dependsOn ?? [])) {
      const parent = eventsById.get(id)
      if (!parent || parent === event) continue
      parents.push(parent)
      children.get(id)?.push(event)
    }
    parentsById.set(event.id, Object.freeze(parents))
  }
  const childrenById = new Map<string, readonly TraceInspectionEvent[]>()
  for (const [id, entries] of children) {
    childrenById.set(id, Object.freeze(entries))
  }
  return { eventsById, parentsById, childrenById }
}

/** Detailed lab snapshots select mechanism references, never exact event lines. */
export function traceSourceGroup(event: TraceInspectionEvent): TraceSourceGroup {
  const snapshot = event.snapshot
  if (snapshot?.tiflashMppLab) return 'tiflash'
  if (snapshot?.gcLab) return 'gc'
  if (snapshot?.protocolLab) return 'protocol'
  if (snapshot?.raftLab) return 'raft'
  if (snapshot?.lockLab) return 'lock'
  if (snapshot?.transaction) return 'transaction'
  return 'overview'
}

export function projectTraceInspection(
  index: TraceInspectionIndex,
  event: TraceInspectionEvent,
): TraceInspection {
  return {
    event,
    parents: index.parentsById.get(event.id) ?? [],
    children: index.childrenById.get(event.id) ?? [],
    presentationFence: event.presentationAfter === undefined
      ? null
      : index.eventsById.get(event.presentationAfter) ?? null,
    presentationFenceId: event.presentationAfter ?? null,
    path: event.path ?? (event.criticalPath === undefined
      ? 'unspecified'
      : event.criticalPath ? 'critical' : 'background'),
    sourceGroup: traceSourceGroup(event),
  }
}
