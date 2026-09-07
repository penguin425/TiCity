// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import type { CityComponent } from '../world/city'
import { selectionCopy } from './selection-copy'

describe('selected component copy', () => {
  it('keeps the floating label compact while exposing role and model disclosure to ARIA', () => {
    const raw = {
      id: 'region.0.peer.0',
      name: 'Region 1 peer on TiKV 1',
      role: 'Raft leader voter',
      kind: 'region-peer',
      domain: 'kv',
      object: {} as CityComponent['object'],
      anchor: {} as CityComponent['anchor'],
      regionId: 0,
      storeId: 0,
      peerRole: 'leader',
    } as CityComponent

    const ja = selectionCopy('ja', raw)
    const en = selectionCopy('en', raw)

    expect(ja.visibleLabel).toBe('Regionピア · Region 0 / TiKV 1')
    expect(ja.visibleLabel).not.toContain('Raftリーダー投票者')
    expect(ja.visibleLabel).not.toContain('MODEL / SIMULATED')
    expect(ja.ariaLabel).toContain('MODEL / SIMULATED')
    expect(en.ariaLabel).toContain('MODEL / SIMULATED: Region 0 peer on TiKV 1')
    expect(en.ariaLabel).toContain('Raft leader voter')
  })
})
