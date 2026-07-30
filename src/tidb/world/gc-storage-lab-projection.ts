/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Pure exact-event model-to-renderer projection for the fixed-capacity
 * GC/Storage Lab. It never infers storage state from human-facing labels.
 */

import type {
  TraceEvent,
  TraceGcKeyChainSnapshot,
  TraceGcLabPhase,
  TraceGcLabSnapshot,
  TraceGcStoreSnapshot,
  TraceGcVersionSnapshot,
} from '../model/types'
import {
  GC_STORAGE_LAB_CHAIN_CAPACITY,
  GC_STORAGE_LAB_DELETE_RANGE_CAPACITY,
  GC_STORAGE_LAB_LOCK_CAPACITY,
  GC_STORAGE_LAB_STORE_CAPACITY,
  GC_STORAGE_LAB_VERSIONS_PER_CHAIN,
} from './gc-storage-lab'
import type {
  GcStorageLabChainProjection,
  GcStorageLabDeleteRangeProjection,
  GcStorageLabFlowStep,
  GcStorageLabGateState,
  GcStorageLabLockProjection,
  GcStorageLabProjection,
  GcStorageLabStoreProjection,
  GcStorageLabVersionProjection,
} from './gc-storage-lab'

export interface GcStorageLabProjectionOptions {
  readonly inspect: boolean
  readonly reducedMotion: boolean
  readonly pulse?: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function hiddenLock(): GcStorageLabLockProjection {
  return {
    visible: false,
    id: '',
    regionId: -1,
    startTs: 0,
    primaryStatus: 'committed',
    status: 'pending',
  }
}

function hiddenDeleteRange(): GcStorageLabDeleteRangeProjection {
  return {
    visible: false,
    id: '',
    dropTs: 0,
    status: 'pending',
  }
}

function hiddenStore(): GcStorageLabStoreProjection {
  return {
    visible: false,
    storeId: '',
    detectedSafePoint: 0,
    detectorCurrent: false,
    compaction: 'idle',
    filterActive: false,
  }
}

function hiddenVersion(): GcStorageLabVersionProjection {
  return {
    visible: false,
    id: '',
    commitTs: 0,
    writeType: 'put',
    valueStorage: 'write_cf_only',
    state: 'present',
  }
}

function hiddenChain(): GcStorageLabChainProjection {
  return {
    visible: false,
    id: '',
    regionId: -1,
    versions: [
      hiddenVersion(),
      hiddenVersion(),
      hiddenVersion(),
      hiddenVersion(),
    ],
    overflowVersions: 0,
  }
}

function gateState(snapshot: TraceGcLabSnapshot): GcStorageLabGateState {
  if (snapshot.safePoint.blocked && snapshot.blocker.status === 'active') {
    return 'blocked'
  }
  if (snapshot.safePoint.published > snapshot.safePoint.previous) {
    return 'published'
  }
  if (snapshot.safePoint.visibilitySaved > snapshot.safePoint.previous) {
    return 'visibility-saved'
  }
  if (snapshot.safePoint.staged > snapshot.safePoint.previous) {
    return 'staged'
  }
  if (snapshot.safePoint.candidate !== null) return 'candidate'
  return 'idle'
}

function flowStep(phase: TraceGcLabPhase): GcStorageLabFlowStep {
  switch (phase) {
    case 'preparing':
    case 'safe_point_bounded':
      return 'candidate'
    case 'resolving_locks':
      return 'resolve-locks'
    case 'deleting_ranges':
      return 'delete-ranges'
    case 'caching_safe_point':
      return 'visibility-save'
    case 'publishing_safe_point':
      return 'publish-pd'
    case 'tikv_observing':
      return 'observe'
    case 'compacting':
      return 'compact'
    case 'between_rounds':
    case 'complete':
      return 'complete'
    case 'idle':
      return 'none'
  }
}

function projectStore(
  store: TraceGcStoreSnapshot,
  publishedSafePoint: number,
): GcStorageLabStoreProjection {
  return {
    visible: true,
    storeId: store.storeId,
    detectedSafePoint: store.detectedSafePoint,
    detectorCurrent: store.detectedSafePoint === publishedSafePoint,
    compaction: store.compaction,
    filterActive: store.filterActive,
  }
}

function projectVersion(
  version: TraceGcVersionSnapshot,
): GcStorageLabVersionProjection {
  return {
    visible: true,
    id: version.id,
    commitTs: version.commitTs,
    writeType: version.writeType,
    valueStorage: version.valueStorage,
    state: version.state,
  }
}

function projectChain(
  chain: TraceGcKeyChainSnapshot,
): GcStorageLabChainProjection {
  const versions = chain.versions
    .slice(0, GC_STORAGE_LAB_VERSIONS_PER_CHAIN)
    .map(projectVersion)
  while (versions.length < GC_STORAGE_LAB_VERSIONS_PER_CHAIN) {
    versions.push(hiddenVersion())
  }
  return {
    visible: true,
    id: chain.id,
    regionId: chain.regionId,
    versions: versions as unknown as GcStorageLabChainProjection['versions'],
    overflowVersions: Math.max(
      0,
      chain.versions.length - GC_STORAGE_LAB_VERSIONS_PER_CHAIN,
    ),
  }
}

/**
 * Converts only snapshot.gcLab into stable renderer slots. Legacy GC events
 * without the model-6 discriminator cannot accidentally create this lab.
 */
export function projectGcStorageLab(
  event: TraceEvent | null,
  options: GcStorageLabProjectionOptions,
): GcStorageLabProjection | null {
  const snapshot = event?.snapshot?.gcLab
  if (!event || !snapshot) return null

  const locks = snapshot.resolveLocks.locks
    .slice(0, GC_STORAGE_LAB_LOCK_CAPACITY)
    .map((lock): GcStorageLabLockProjection => ({
      visible: true,
      id: lock.id,
      regionId: lock.regionId,
      startTs: lock.startTs,
      primaryStatus: lock.primaryStatus,
      status: lock.status,
    }))
  while (locks.length < GC_STORAGE_LAB_LOCK_CAPACITY) {
    locks.push(hiddenLock())
  }

  const deleteRanges = snapshot.deleteRanges
    .slice(0, GC_STORAGE_LAB_DELETE_RANGE_CAPACITY)
    .map((range): GcStorageLabDeleteRangeProjection => ({
      visible: true,
      id: range.id,
      dropTs: range.dropTs,
      status: range.status,
    }))
  while (deleteRanges.length < GC_STORAGE_LAB_DELETE_RANGE_CAPACITY) {
    deleteRanges.push(hiddenDeleteRange())
  }

  const stores = snapshot.stores
    .slice(0, GC_STORAGE_LAB_STORE_CAPACITY)
    .map((store) => projectStore(store, snapshot.safePoint.published))
  while (stores.length < GC_STORAGE_LAB_STORE_CAPACITY) {
    stores.push(hiddenStore())
  }

  const chains = snapshot.keyChains
    .slice(0, GC_STORAGE_LAB_CHAIN_CAPACITY)
    .map(projectChain)
  while (chains.length < GC_STORAGE_LAB_CHAIN_CAPACITY) {
    chains.push(hiddenChain())
  }

  const overflowVersions = snapshot.keyChains.reduce(
    (total, chain, index) =>
      total + (
        index < GC_STORAGE_LAB_CHAIN_CAPACITY
          ? Math.max(
            0,
            chain.versions.length - GC_STORAGE_LAB_VERSIONS_PER_CHAIN,
          )
          : chain.versions.length
      ),
    0,
  )
  const overflow = {
    stores: Math.max(
      0,
      snapshot.stores.length - GC_STORAGE_LAB_STORE_CAPACITY,
    ),
    locks: Math.max(
      0,
      snapshot.resolveLocks.locks.length - GC_STORAGE_LAB_LOCK_CAPACITY,
    ),
    deleteRanges: Math.max(
      0,
      snapshot.deleteRanges.length - GC_STORAGE_LAB_DELETE_RANGE_CAPACITY,
    ),
    chains: Math.max(
      0,
      snapshot.keyChains.length - GC_STORAGE_LAB_CHAIN_CAPACITY,
    ),
    versions: overflowVersions,
  }

  return {
    mode: options.inspect ? 'inspect' : 'overview',
    phase: snapshot.phase,
    round: snapshot.round,
    reducedMotion: options.reducedMotion,
    pulse: clamp(options.pulse ?? 0, 0, 1),
    flowStep: flowStep(snapshot.phase),
    safePoint: {
      ...snapshot.safePoint,
      gateState: gateState(snapshot),
    },
    blocker: {
      visible: true,
      transactionId: snapshot.blocker.transactionId,
      startTs: snapshot.blocker.startTs,
      status: snapshot.blocker.status,
    },
    resolveLocks: {
      implementation: snapshot.resolveLocks.implementation,
      scannedRegionIds: [...snapshot.resolveLocks.scannedRegionIds],
      locks: locks as unknown as GcStorageLabProjection[
        'resolveLocks'
      ]['locks'],
    },
    deleteRanges:
      deleteRanges as unknown as GcStorageLabProjection['deleteRanges'],
    stores: stores as unknown as GcStorageLabProjection['stores'],
    chains: chains as unknown as GcStorageLabProjection['chains'],
    overflow: {
      ...overflow,
      total:
        overflow.stores +
        overflow.locks +
        overflow.deleteRanges +
        overflow.chains +
        overflow.versions,
    },
  }
}
