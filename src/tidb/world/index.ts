/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import type { TiCityState, TraceReceipt } from '../model/types'
import { createCityShell } from '../engine/shell'
import type { CityShell } from '../engine/shell'
import type { CityViewMode } from '../engine/camera'
import type { CityComponent } from './city'
import type { CityTheme } from './palette'

export interface WorldOptions {
  readonly theme?: CityTheme
  readonly mode?: CityViewMode
  readonly hudExpanded?: boolean
  readonly autoStart?: boolean
  readonly inspectLab?: boolean
  /** @deprecated Use `inspectLab`. */
  readonly inspectTransactionLab?: boolean
  readonly onSelect?: (component: CityComponent | null) => void
}

export interface WorldHandle {
  /** Advanced integration surface; ordinary callers use the methods below. */
  readonly shell: CityShell
  update(state: TiCityState, trace?: TraceReceipt | null): void
  focus(targetId: string): boolean
  setTheme(theme: CityTheme): void
  setMode(mode: CityViewMode): void
  setLabInspect(enabled: boolean): void
  /** @deprecated Use `setLabInspect`. */
  setTransactionLabInspect(enabled: boolean): void
  setHudExpanded(expanded: boolean): void
  resize(): void
  enableAudio(): Promise<boolean>
  dispose(): void
}

/**
 * Mount the standalone TiCity visual runtime.
 *
 * `update` only projects model state and TraceReceipt events. It never mutates
 * the simulation, issues SQL, or constructs a second transaction model.
 */
export function createTiDBWorld(
  container: HTMLElement,
  options: WorldOptions = {},
): WorldHandle {
  const shell = createCityShell(container, options)
  return {
    shell,
    update(state: TiCityState, trace?: TraceReceipt | null): void {
      shell.update(state, trace)
    },
    focus(targetId: string): boolean {
      return shell.focus(targetId)
    },
    setTheme(theme: CityTheme): void {
      shell.setTheme(theme)
    },
    setMode(mode: CityViewMode): void {
      shell.setMode(mode)
    },
    setLabInspect(enabled: boolean): void {
      shell.setLabInspect(enabled)
    },
    setTransactionLabInspect(enabled: boolean): void {
      shell.setTransactionLabInspect(enabled)
    },
    setHudExpanded(expanded: boolean): void {
      shell.setHudExpanded(expanded)
    },
    resize(): void {
      shell.resize()
    },
    enableAudio(): Promise<boolean> {
      return shell.audio.enable()
    },
    dispose(): void {
      shell.dispose()
    },
  }
}

export { createTiDBSceneGraph } from './city'
export type {
  CityCollider,
  CityComponent,
  CityNetwork,
  CityRegistry,
  TiDBSceneGraph,
} from './city'
export {
  COMPONENT_ANCHORS,
  DISTRICT_BOUNDS,
  GC_STORAGE_LAB_ORIGIN,
  RAFT_LAB_ORIGIN,
  PROTOCOL_LAB_ORIGIN,
  TIFLASH_MPP_LAB_ORIGIN,
  TICITY_LAYOUT,
  regionPeerPosition,
} from './layout'
export {
  createTransactionLab,
  EMPTY_TRANSACTION_LAB_PROJECTION,
} from './transaction-lab'
export { projectTransactionLab } from './transaction-lab-projection'
export type {
  TransactionLab,
  TransactionLabProjection,
  TransactionLabRegionProjection,
} from './transaction-lab'
export {
  createLockLab,
  EMPTY_LOCK_LAB_PROJECTION,
} from './lock-lab'
export { projectLockLab } from './lock-lab-projection'
export type {
  LockLab,
  LockLabProjection,
  LockLabResourceProjection,
  LockLabTransactionProjection,
  LockLabWaitForEdgeProjection,
} from './lock-lab'
export {
  createRaftLab,
  EMPTY_RAFT_LAB_PROJECTION,
} from './raft-lab'
export {
  createProtocolLab,
  EMPTY_PROTOCOL_LAB_PROJECTION,
} from './protocol-lab'
export { projectProtocolLab } from './protocol-lab-projection'
export type {
  ProtocolLab,
  ProtocolLabLaneProjection,
  ProtocolLabProjection,
  ProtocolLabRegionProjection,
} from './protocol-lab'
export {
  createGcStorageLab,
  EMPTY_GC_STORAGE_LAB_PROJECTION,
} from './gc-storage-lab'
export { projectGcStorageLab } from './gc-storage-lab-projection'
export type {
  GcStorageLab,
  GcStorageLabProjection,
} from './gc-storage-lab'
export {
  createTiFlashMppLab,
  EMPTY_TIFLASH_MPP_LAB_PROJECTION,
  TIFLASH_MPP_LAB_FRAGMENT_CAPACITY,
  TIFLASH_MPP_LAB_LEARNER_CAPACITY,
  TIFLASH_MPP_LAB_PACKET_CAPACITY,
  TIFLASH_MPP_LAB_STORE_CAPACITY,
  TIFLASH_MPP_LAB_TASK_CAPACITY,
  TIFLASH_MPP_LAB_TUNNEL_CAPACITY,
} from './tiflash-mpp-lab'
export { projectTiFlashMppLab } from './tiflash-mpp-lab-projection'
export type {
  TiFlashMppLab,
  TiFlashMppLabLearnerProjection,
  TiFlashMppLabProjection,
  TiFlashMppLabTaskProjection,
  TiFlashMppLabTunnelProjection,
} from './tiflash-mpp-lab'
export { projectRaftLab } from './raft-lab-projection'
export type {
  RaftLab,
  RaftLabElectionEdgeProjection,
  RaftLabLogCellProjection,
  RaftLabPeerProjection,
  RaftLabProjection,
} from './raft-lab'
export type { CityTheme, SemanticDomain } from './palette'
