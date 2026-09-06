/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import type { TraceEvent } from '../model/types'
import { projectTransactionLab } from '../world/transaction-lab-projection'
import { EMPTY_TRANSACTION_LAB_PROJECTION } from '../world/transaction-lab'
import type { TransactionLabProjection } from '../world/transaction-lab'
import { projectLockLab } from '../world/lock-lab-projection'
import { EMPTY_LOCK_LAB_PROJECTION } from '../world/lock-lab'
import type { LockLabProjection } from '../world/lock-lab'
import { projectRaftLab } from '../world/raft-lab-projection'
import { EMPTY_RAFT_LAB_PROJECTION } from '../world/raft-lab'
import type { RaftLabProjection } from '../world/raft-lab'
import { projectProtocolLab } from '../world/protocol-lab-projection'
import { EMPTY_PROTOCOL_LAB_PROJECTION } from '../world/protocol-lab'
import type { ProtocolLabProjection } from '../world/protocol-lab'
import { projectGcStorageLab } from '../world/gc-storage-lab-projection'
import { EMPTY_GC_STORAGE_LAB_PROJECTION } from '../world/gc-storage-lab'
import type { GcStorageLabProjection } from '../world/gc-storage-lab'
import { projectTiFlashMppLab } from '../world/tiflash-mpp-lab-projection'
import { EMPTY_TIFLASH_MPP_LAB_PROJECTION } from '../world/tiflash-mpp-lab'
import type { TiFlashMppLabProjection } from '../world/tiflash-mpp-lab'

export interface CityLabProjections {
  readonly transaction: TransactionLabProjection
  readonly lock: LockLabProjection
  readonly raft: RaftLabProjection
  readonly protocol: ProtocolLabProjection
  readonly gcStorage: GcStorageLabProjection
  readonly tiflashMpp: TiFlashMppLabProjection
}

function hiddenTransactionLab(reducedMotion: boolean): TransactionLabProjection {
  return reducedMotion === EMPTY_TRANSACTION_LAB_PROJECTION.reducedMotion
    ? EMPTY_TRANSACTION_LAB_PROJECTION
    : { ...EMPTY_TRANSACTION_LAB_PROJECTION, reducedMotion }
}

function hiddenLockLab(reducedMotion: boolean): LockLabProjection {
  return reducedMotion === EMPTY_LOCK_LAB_PROJECTION.reducedMotion
    ? EMPTY_LOCK_LAB_PROJECTION
    : { ...EMPTY_LOCK_LAB_PROJECTION, reducedMotion }
}

function hiddenRaftLab(reducedMotion: boolean): RaftLabProjection {
  return reducedMotion === EMPTY_RAFT_LAB_PROJECTION.reducedMotion
    ? EMPTY_RAFT_LAB_PROJECTION
    : { ...EMPTY_RAFT_LAB_PROJECTION, reducedMotion }
}

function hiddenProtocolLab(reducedMotion: boolean): ProtocolLabProjection {
  return reducedMotion === EMPTY_PROTOCOL_LAB_PROJECTION.reducedMotion
    ? EMPTY_PROTOCOL_LAB_PROJECTION
    : { ...EMPTY_PROTOCOL_LAB_PROJECTION, reducedMotion }
}

function hiddenGcStorageLab(
  reducedMotion: boolean,
): GcStorageLabProjection {
  return reducedMotion === EMPTY_GC_STORAGE_LAB_PROJECTION.reducedMotion
    ? EMPTY_GC_STORAGE_LAB_PROJECTION
    : { ...EMPTY_GC_STORAGE_LAB_PROJECTION, reducedMotion }
}

function hiddenTiFlashMppLab(
  reducedMotion: boolean,
): TiFlashMppLabProjection {
  return reducedMotion === EMPTY_TIFLASH_MPP_LAB_PROJECTION.reducedMotion
    ? EMPTY_TIFLASH_MPP_LAB_PROJECTION
    : { ...EMPTY_TIFLASH_MPP_LAB_PROJECTION, reducedMotion }
}

/**
 * Projects exactly one detailed 3D lab from the event-owned discriminator.
 * Lock and Raft snapshots retain shared Region summaries, so their explicit
 * discriminators take precedence over the generic transaction projection.
 */
export function projectCityLabs(
  event: TraceEvent | null,
  inspect: boolean,
  reducedMotion: boolean,
  pulse = 0,
): CityLabProjections {
  const hiddenTransaction = hiddenTransactionLab(reducedMotion)
  const hiddenLock = hiddenLockLab(reducedMotion)
  const hiddenRaft = hiddenRaftLab(reducedMotion)
  const hiddenProtocol = hiddenProtocolLab(reducedMotion)
  const hiddenGcStorage = hiddenGcStorageLab(reducedMotion)
  const hiddenTiFlashMpp = hiddenTiFlashMppLab(reducedMotion)
  if (!inspect || !event?.snapshot) {
    return {
      transaction: hiddenTransaction,
      lock: hiddenLock,
      raft: hiddenRaft,
      protocol: hiddenProtocol,
      gcStorage: hiddenGcStorage,
      tiflashMpp: hiddenTiFlashMpp,
    }
  }
  if (event.snapshot.tiflashMppLab) {
    return {
      transaction: hiddenTransaction,
      lock: hiddenLock,
      raft: hiddenRaft,
      protocol: hiddenProtocol,
      gcStorage: hiddenGcStorage,
      tiflashMpp: projectTiFlashMppLab(event, {
        inspect: true,
        reducedMotion,
        pulse,
      }) ?? hiddenTiFlashMpp,
    }
  }
  if (event.snapshot.gcLab) {
    return {
      transaction: hiddenTransaction,
      lock: hiddenLock,
      raft: hiddenRaft,
      protocol: hiddenProtocol,
      gcStorage: projectGcStorageLab(event, {
        inspect: true,
        reducedMotion,
        pulse,
      }) ?? hiddenGcStorage,
      tiflashMpp: hiddenTiFlashMpp,
    }
  }
  if (event.snapshot.protocolLab) {
    return {
      transaction: hiddenTransaction,
      lock: hiddenLock,
      raft: hiddenRaft,
      protocol: projectProtocolLab(event, {
        inspect: true,
        reducedMotion,
        pulse,
      }) ?? hiddenProtocol,
      gcStorage: hiddenGcStorage,
      tiflashMpp: hiddenTiFlashMpp,
    }
  }
  if (event.snapshot.raftLab) {
    return {
      transaction: hiddenTransaction,
      lock: hiddenLock,
      raft: projectRaftLab(event, {
        inspect: true,
        reducedMotion,
        pulse,
      }) ?? hiddenRaft,
      protocol: hiddenProtocol,
      gcStorage: hiddenGcStorage,
      tiflashMpp: hiddenTiFlashMpp,
    }
  }
  if (event.snapshot.lockLab) {
    return {
      transaction: hiddenTransaction,
      lock: projectLockLab(event, {
        inspect: true,
        reducedMotion,
        pulse,
      }) ?? hiddenLock,
      raft: hiddenRaft,
      protocol: hiddenProtocol,
      gcStorage: hiddenGcStorage,
      tiflashMpp: hiddenTiFlashMpp,
    }
  }
  if (event.snapshot.transaction) {
    return {
      transaction: projectTransactionLab(event, {
        inspect: true,
        reducedMotion,
        pulse,
      }) ?? hiddenTransaction,
      lock: hiddenLock,
      raft: hiddenRaft,
      protocol: hiddenProtocol,
      gcStorage: hiddenGcStorage,
      tiflashMpp: hiddenTiFlashMpp,
    }
  }
  return {
    transaction: hiddenTransaction,
    lock: hiddenLock,
    raft: hiddenRaft,
    protocol: hiddenProtocol,
    gcStorage: hiddenGcStorage,
    tiflashMpp: hiddenTiFlashMpp,
  }
}
