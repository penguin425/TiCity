// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import type { CityComponent } from '../world/city'
import { projectCityComponent } from './component-copy'

function component(
  kind: CityComponent['kind'],
  fields: Partial<CityComponent> = {},
): CityComponent {
  return {
    id: 'region.0.peer.0',
    name: 'Raw model name must not leak',
    role: 'Raw model role must not leak',
    kind,
    domain: 'kv',
    object: {} as CityComponent['object'],
    anchor: {} as CityComponent['anchor'],
    ...fields,
  }
}

describe('city component presentation copy', () => {
  it('projects stable component identity into both locales without changing model fields', () => {
    const raw = component('tidb', { id: 'tidb.1' })

    const ja = projectCityComponent('ja', raw)
    const en = projectCityComponent('en', raw)

    expect(ja.name).toBe('TiDB サーバー 2')
    expect(ja.role).toContain('ステートレス')
    expect(en.name).toBe('TiDB Server 2')
    expect(en.role).toContain('Stateless SQL')
    expect(ja.disclosure).toBe('MODEL / SIMULATED')
    expect(raw.name).toBe('Raw model name must not leak')
    expect(raw.role).toBe('Raw model role must not leak')
  })

  it('derives a leader/fault role from typed peer state and refreshes with changes', () => {
    const raw = component('region-peer', {
      id: 'region.2.peer.1',
      regionId: 2,
      storeId: 1,
      peerRole: 'leader',
      role: 'Raft leader voter',
    })

    expect(projectCityComponent('ja', raw).role).toBe('Raftリーダー投票者')
    expect(projectCityComponent('ja', raw).name).toBe('Regionピア · Region 2 / TiKV 2')
    expect(projectCityComponent('en', raw).name).toBe('Region 2 peer on TiKV 2')
    expect(raw.regionId).toBe(2)
    raw.peerRole = 'follower'
    raw.role = 'Raft follower voter'
    expect(projectCityComponent('ja', raw).role).toBe('Raftフォロワー投票者')
    raw.domain = 'fault'
    expect(projectCityComponent('en', raw).role).toBe('Unavailable Raft voter')
  })
})
