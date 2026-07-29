// SPDX-License-Identifier: Apache-2.0

import type { Locale } from './catalog'

export interface LocalizedTourChapter {
  title: string
  body: string
}

export interface TourChapter {
  id: string
  focus: string
  ja: LocalizedTourChapter
  en: LocalizedTourChapter
}

export const TOUR_CHAPTERS: readonly TourChapter[] = [
  {
    id: 'city-map',
    focus: 'city.overview',
    ja: {
      title: '都市はクラスタの地図',
      body: 'ゲートはTiProxy、SQLタワーはstatelessなTiDB Server、管制区画はPD、3つのキャンパスはTiKVです。建物の個数と時間は見やすく縮尺されています。',
    },
    en: {
      title: 'The city is a cluster map',
      body: 'The gate is TiProxy, SQL towers are stateless TiDB Servers, the control district is PD, and three campuses are TiKV. Counts and timing are scaled for visibility.',
    },
  },
  {
    id: 'request-route',
    focus: 'tiproxy.gate',
    ja: {
      title: 'SQLリクエストの入口',
      body: 'ClientはTiProxyを通ってTiDB Serverへ到達します。TiDBはSQLを解析・最適化しますが、ユーザー行を永続保存しません。',
    },
    en: {
      title: 'A SQL request enters',
      body: 'A client reaches a TiDB Server through TiProxy. TiDB parses and optimizes SQL, but does not persist user rows.',
    },
  },
  {
    id: 'tso',
    focus: 'pd.tso',
    ja: {
      title: 'PDとTSO',
      body: 'PDは配置を調整し、TSOはトランザクションへ単調増加するtimestampを割り当てます。PDをデータ行の通路として描かないことが重要です。',
    },
    en: {
      title: 'PD and the TSO',
      body: 'PD coordinates placement, while the TSO assigns monotonically increasing timestamps to transactions. PD is not on the user-row data path.',
    },
  },
  {
    id: 'region-routing',
    focus: 'tikv.regions',
    ja: {
      title: 'キーはRegionへ向かう',
      body: 'TiKVのkeyspaceは連続したRegionへ分割されます。TiDBはRegion cacheを使い、対象key rangeのleader peerへ要求を送ります。',
    },
    en: {
      title: 'Keys route to Regions',
      body: 'TiKV keyspace is divided into contiguous Regions. TiDB uses its Region cache to address the leader peer for the target key range.',
    },
  },
  {
    id: 'mvcc',
    focus: 'tikv.mvcc',
    ja: {
      title: 'MVCCの複数version',
      body: 'TiKVはdefault、write、lockの各column familyで値、commit記録、未確定lockを表現します。表示は概念を保った代表サンプルです。',
    },
    en: {
      title: 'MVCC keeps versions',
      body: 'TiKV represents values, commit records, and pending locks across the default, write, and lock column families. The display is a representative sample.',
    },
  },
  {
    id: 'two-phase-commit',
    focus: 'txn.2pc',
    ja: {
      title: '分散トランザクションの2PC',
      body: 'cross-Region writeはprewrite後にcommitされます。primaryとsecondaryのtransaction protocolであり、各Region内部のRaft quorumとは別の仕組みです。',
    },
    en: {
      title: 'Distributed transaction 2PC',
      body: 'A cross-Region write commits after prewrite. This primary/secondary transaction protocol is separate from the Raft quorum inside each Region.',
    },
  },
  {
    id: 'raft',
    focus: 'tikv.raft',
    ja: {
      title: 'RegionごとのRaft',
      body: '各Regionのleaderはlogをvoter peerへ複製し、quorumでRaft entryをcommitします。これはSQL transactionのcommitと同義ではありません。',
    },
    en: {
      title: 'Raft per Region',
      body: 'Each Region leader replicates its log to voter peers and commits a Raft entry at quorum. That is not the same event as committing a SQL transaction.',
    },
  },
  {
    id: 'hotspot-split',
    focus: 'pd.scheduler',
    ja: {
      title: 'hotspot、split、rebalance',
      body: '連続増加keyは末尾Regionへ負荷を集中させます。thresholdを超えるとRegionがsplitされ、PD schedulerがleaderやpeerを再配置します。',
    },
    en: {
      title: 'Hotspots, split, and rebalance',
      body: 'Sequential keys concentrate load on the tail Region. Past a threshold the Region splits, then PD schedulers can redistribute leaders and peers.',
    },
  },
  {
    id: 'gc',
    focus: 'gc.yard',
    ja: {
      title: 'GC safe point',
      body: '長時間transactionが古いsnapshotを必要とするとsafe pointの前進が止まり、不要versionが蓄積します。Resolve LocksとGCを区別して観察します。',
    },
    en: {
      title: 'The GC safe point',
      body: 'A long transaction can hold an old snapshot, stop the safe point advancing, and accumulate obsolete versions. Resolve Locks and GC remain distinct.',
    },
  },
  {
    id: 'tiflash-mpp',
    focus: 'tiflash.mpp',
    ja: {
      title: 'TiFlashとMPP',
      body: 'TiFlash learnerはTiKVから非同期に複製されます。replicaが利用可能になった後、分析queryをMPP taskへ分割して実行する流れを表示します。',
    },
    en: {
      title: 'TiFlash and MPP',
      body: 'A TiFlash learner replicates asynchronously from TiKV. Once the replica is available, an analytical query can be divided into MPP tasks.',
    },
  },
] as const

export function tourChapter(chapter: TourChapter, locale: Locale): LocalizedTourChapter {
  return chapter[locale]
}
