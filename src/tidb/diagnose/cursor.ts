// SPDX-License-Identifier: Apache-2.0

import type { TraceEvent, TraceStateSnapshot } from '../model/types'

export type DiagnoseCursorResolution =
  | 'final'
  | 'exact'
  | 'previous'
  | 'scenario-start'

export interface DiagnoseCursor {
  /** The requested event, or null for the final-state view and invalid ids. */
  event: TraceEvent | null
  /**
   * The immutable detailed snapshot used for projection. Snapshotless events
   * reuse the nearest earlier detailed snapshot; null means scenario start.
   */
  snapshot: TraceStateSnapshot | null
  snapshotEvent: TraceEvent | null
  resolution: DiagnoseCursorResolution
}

function previousDetailedEvent(
  events: readonly TraceEvent[],
  fromIndex: number,
): TraceEvent | null {
  for (let index = fromIndex; index >= 0; index--) {
    if (events[index].snapshot) return events[index]
  }
  return null
}

/**
 * Diagnose never invents event-time state. An event with no detailed snapshot
 * reuses the nearest earlier immutable snapshot. If none exists, callers show
 * the scenario-start state. With no event cursor, the final-state view overlays
 * the receipt's last detailed snapshot so composite labs remain inspectable.
 */
export function resolveDiagnoseCursor(
  events: readonly TraceEvent[],
  requestedEventId: string | null,
): DiagnoseCursor {
  if (requestedEventId === null) {
    const snapshotEvent = previousDetailedEvent(events, events.length - 1)
    return {
      event: null,
      snapshot: snapshotEvent?.snapshot ?? null,
      snapshotEvent,
      resolution: 'final',
    }
  }

  const eventIndex = events.findIndex((event) => event.id === requestedEventId)
  if (eventIndex < 0) {
    const snapshotEvent = previousDetailedEvent(events, events.length - 1)
    return {
      event: null,
      snapshot: snapshotEvent?.snapshot ?? null,
      snapshotEvent,
      resolution: 'final',
    }
  }

  const event = events[eventIndex]
  if (event.snapshot) {
    return {
      event,
      snapshot: event.snapshot,
      snapshotEvent: event,
      resolution: 'exact',
    }
  }

  const snapshotEvent = previousDetailedEvent(events, eventIndex - 1)
  return {
    event,
    snapshot: snapshotEvent?.snapshot ?? null,
    snapshotEvent,
    resolution: snapshotEvent ? 'previous' : 'scenario-start',
  }
}
