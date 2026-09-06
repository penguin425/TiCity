// SPDX-License-Identifier: Apache-2.0
// TiCity changes Copyright 2026 TiCity contributors.

import type { Locale } from '../ui/catalog'

export type CityLabelId =
  | 'client.terminal'
  | 'tiproxy.0'
  | 'tidb.1'
  | 'pd.control'
  | 'tikv.0'
  | 'tikv.1'
  | 'tikv.2'
  | 'gc.yard'
  | 'tiflash.0'

interface CityLabelCopy {
  readonly name: string
  readonly detail: string
}

/** Product identities stay recognizable in both languages. */
export const CITY_LABEL_COPY: Readonly<Record<Locale, Record<CityLabelId, CityLabelCopy>>> = {
  ja: {
    'client.terminal': { name: 'CLIENTS', detail: 'MySQL ワークロード' },
    'tiproxy.0': { name: 'TiProxy', detail: '接続ルーター × 2' },
    'tidb.1': { name: 'TiDB SQL', detail: 'ステートレス SQL × 3' },
    'pd.control': { name: 'PD / TSO', detail: '制御プレーン' },
    'tikv.0': { name: 'TiKV STORE 1', detail: '36 Region の投票レプリカ' },
    'tikv.1': { name: 'TiKV STORE 2', detail: '36 Region の投票レプリカ' },
    'tikv.2': { name: 'TiKV STORE 3', detail: '36 Region の投票レプリカ' },
    'gc.yard': { name: 'MVCC GC', detail: 'セーフポイントと回収' },
    'tiflash.0': { name: 'TiFlash', detail: 'Learner レプリカ · MPP' },
  },
  en: {
    'client.terminal': { name: 'CLIENTS', detail: 'MySQL workloads' },
    'tiproxy.0': { name: 'TiProxy', detail: '2 connection routers' },
    'tidb.1': { name: 'TiDB SQL', detail: '3 stateless SQL servers' },
    'pd.control': { name: 'PD / TSO', detail: 'control plane' },
    'tikv.0': { name: 'TiKV STORE 1', detail: '36 Region voters' },
    'tikv.1': { name: 'TiKV STORE 2', detail: '36 Region voters' },
    'tikv.2': { name: 'TiKV STORE 3', detail: '36 Region voters' },
    'gc.yard': { name: 'MVCC GC', detail: 'safe-point collection' },
    'tiflash.0': { name: 'TiFlash', detail: 'learner replica · MPP' },
  },
}
