# TiCity

[English](README.md) | 日本語

**TiDBの分散SQLアーキテクチャを、歩いて観察できる決定論的な3Dモデル。**

[PGSimCity](https://github.com/NikolayS/PGSimCity)から派生した、
Apache-2.0ライセンスの独立した教育プロジェクトです。TiCityはTiDBの
エミュレータ、TiDB／TiKV／TiFlashの実装そのもの、接続済みクラスタではなく、
主要な処理の境界と順序を理解するための教育用縮尺モデルです。既定の説明は
日本語で、英語へ切り替えられます。

公開先: <https://penguin425.github.io/TiCity/>

![2つのRegionにまたがる悲観トランザクションのprimary commitを表示するTiCity Transaction Lab](docs/screenshot.png)

> [!IMPORTANT]
> TiCity v0.8.0が公開済みの最新releaseです。TiDB v8.5 LTS系列を対象にした
> 静的・オフラインのモデルで、model-6 GC/Storage Labを含みます。SQLを実行せず、
> 実データや架空の結果行も返しません。入力した単一SQL文をブラウザ内で分類し、
> モデル上の経路と説明だけを生成します。

## 観察できるもの

- **内部**（Inspect）で開く、2つのRegionにまたがる悲観トランザクションの
  詳細なTransaction Labカットアウェイ
- Leaderメモリ上の悲観ロック、並列prewrite、Regionごとに独立した2-of-3
  Raft quorum、apply、概念上のMVCC `LOCK`／`DEFAULT`／`WRITE` column family
- 2つの明示的な悲観トランザクションと2つの不透明なresourceを扱い、lock
  owner、wait queue、waiterからholderへのedge、2トランザクションcycle、
  victimの完全rollback、application retryを示す独立したLock Labカットアウェイ
- TiKV上のクラスタ全体deadlock detector leaderと、そのleaderの場所だけを
  検索するPD。決定的なvictim／wake規則はTiDBの保証ではなく
  **TiCity MODEL POLICY**と明示
- 代表する1つのRegionを、cache上の旧Leaderへの要求、TiKV processの到達不能、
  TiDB内部backoffとcache無効化、選出、route更新、read復旧まで27個の不変な
  eventで展開するRaft Failure Lab
- role、health、term、vote、log、commit、applyを明示した3 voter peer。
  Pre-VoteとVoteはそれぞれ2-of-3へ達し、新Leaderのcurrent-term no-opを
  persist、commit、applyします
- 1PC、Async Commit、通常2PCを1つの74 eventの不変な比較receiptへ展開する
  Protocol Lab
- 宣言済みfixtureのeligibility outcomeとtimestampの出所を明示した3つの
  独立した代表的な楽観transaction。各laneはprotocolの形を比較するもので、
  表示SQLの実行でもlatency benchmarkでもありません
- `TryOnePc`を持つ1 Regionの1PC Prewrite、2 RegionのAsync Commit prewrite、
  通常2PCのprimary／secondary経路。すべてのTiKV mutationは、それぞれの
  Regionで独立した2-of-3 Raft chainを通ります
- 1PCにはcleanupを残さず、Async Commitでは両Regionのcommit record解決、
  通常2PCではsecondary commitをbackgroundへ残すclient response境界
- 1つの43 eventの不変なreceiptを2回のGC roundへ展開するmodel-6 GC/Storage
  Lab。最初はactive transactionが候補をglobal
  `minStartTS - 1`へ制限し、明示的なfixture境界でtransactionが完了した後、
  2回目の候補が前進します
- `mysql.tidb`へstageしたstatus、TiDBが保存したvisibility safe pointと
  実装上の100秒cache barrier、PDへ公開したglobal safe pointを、exact event
  ごとに別の値として表示
- Region単位のScanLockとResolveLock outcome、classic raftstore-v1のStore別
  `UnsafeDestroyRange`、TiKVによる非同期safe-point観測、Put anchorを保持する
  default Compaction Filter経路
- 3 replica分へ乗算せず1回だけ数える論理MVCC chain。Deleteによる旧chainの
  除去と、DEFAULT CFの長いvalueのcleanupも含みます
- 不変なイベント後snapshot、明示的なfork/join依存、クライアント応答境界、
  応答後のsecondary cleanupを持つ因果イベントグラフ
- 3D City、Machine、Diagnoseへ投影される1つの不変なreceipt。Lock Labの
  意味上のwait-for graph、Raft Failure Labの意味上の選出graph、GC/Storage
  Labの2-round意味pipelineは、いずれも因果依存graphとは分離されます
- 3画面の間を移動してもscenarioと選択eventを引き継ぐ安定したlink
- TiProxy、TiDB Server、PD、TiKV、TiFlashからなる既定トポロジ
- PDのTSO、Regionの範囲・Leader・3 voter、Raft複製とquorum
- 悲観／楽観トランザクション、prewriteとcommit、1PC／Async Commit／2PC
- hotspot、Region split、leader election、GC safe point、TiFlash catch-upとMPP
- 2PC（トランザクションの原子性）とRaft（Region複製）を分離したトレース
- 昼夜の空、道路、区画サイン、建築照明を備えた俯瞰・視線方向Fly・衝突判定付きWalk
- Fly／Walkを長押しで移動できる、短いスマートフォン画面にも対応したタッチ操作
- 現在イベント、経路、進行方向、前後移動と同一トレースのループを示す教育用Trace Dock
- 都市全体まで引ける俯瞰ズームと、距離に応じて整理される区画サイン

画面は次の3つです。

| URL | 内容 |
|---|---|
| [`…/TiCity/?scenario=commit-protocols&event=trace-1-event-32`](https://penguin425.github.io/TiCity/?scenario=commit-protocols&event=trace-1-event-32) | Async Commitのclient応答境界における3D Cityとscenarioで選択した詳細Lab |
| [`…/machine/?scenario=commit-protocols&event=trace-1-event-32`](https://penguin425.github.io/TiCity/machine/?scenario=commit-protocols&event=trace-1-event-32) | 因果event DAGと、選択Labから分離されたprotocol、lock、選出、GC／storageの意味graph |
| [`…/diagnose/?scenario=commit-protocols&event=trace-1-event-32`](https://penguin425.github.io/TiCity/diagnose/?scenario=commit-protocols&event=trace-1-event-32) | exact event時点のtransaction、protocol、Raft、MVCC、lock／deadlock／retry、GC／storage診断 |

3D Cityで**内部**を選ぶとカットアウェイへフォーカスします。再生操作は同じ
不変なreceipt上を移動し、ループ時もトランザクションを再実行しません。

[`lock-deadlock` scenario](https://penguin425.github.io/TiCity/?scenario=lock-deadlock)
からLock Labを直接開けます。この古典的なretry不可deadlockが返すのは
Error 1213であり、別経路のlock-wait timeoutであるError 1205ではありません。
失敗したトランザクションを完全にrollbackし、application retryではTiDB内部の
retryとして見せず、新しいtransaction IDと`start_ts`を作ります。

![2トランザクションのwait-for cycleで停止したTiCity Lock Lab](docs/lock-lab.png)

[`tikv-failover` scenario](https://penguin425.github.io/TiCity/?scenario=tikv-failover)
からRaft Failure Labを直接開けます。27 eventのreceiptは、1つのlogical point
readについて、cache上の旧Leaderへの試行からprocess停止、TiDB内部backoffと
Region cache無効化、Pre-VoteとVote、Leader確認、route更新、retryまでを
追跡します。設定上の10–20 tick選出windowは対象TiKVのconfigurationに由来します。
正確な経過13 tickと、稼働中でlogが最新のstore IDが最小のcandidateを選ぶ規則は、
実環境の時間やwinnerの保証ではなく、決定論的な**TiCity MODEL POLICY**です。
PDは選出済みLeaderを観測してrouting metadataを返しますが、candidate選択、
Pre-Vote／Vote付与、Leader選出は行いません。

このモデル上のreadはuser-data Raft entryを作りません。新Leaderのモデル化された
current-term no-opを2-of-3 voterがpersistし、commitしてLeaderがapplyした後に、
TiDBがrouteを更新して同じlogical requestをretryします。これはapplication retry
ではなくTiDB内部のrequest retryで、このtraceでは一時的なerrorはclientへ見えません。
surviving followerによるno-op applyは応答後のbackground workです。

![2-of-3の選出と復旧中のTiCity Raft Failure Lab](docs/raft-lab.png)

[`commit-protocols` scenario](https://penguin425.github.io/TiCity/?scenario=commit-protocols)
からProtocol Labを直接開けます。74 eventのreceiptに含まれるのは3つの独立した
代表的な楽観transactionで、workbench SQLを3回実行したものでもlatency競争でも
ありません。

各laneの宣言済みfixture profileとprotocol outcomeは、意図的に比較開始時から
表示します。これは不変なreceiptがこれからたどる固定経路の説明であり、現在の
cursorですでに完了した処理を表すものではありません。lane stage、timestamp、
Region Raft／MVCC、client応答、background cleanupは、選択したexact event時点の
時間変化する状態です。

- **1PC:** PDが`start_ts`を払い出し、モデル化した既定のlinear consistencyの
  ために`latest_ts`も返します。TiCityが代表的なrequest boundを導出してから、
  `TryOnePc=true`のPrewriteを1 Regionへ送ります。そのRegionでRaft applyした後、
  TiKVが`one_pc_commit_ts`を返します。このlaneには通常のCommit RPC、永続的な
  lock-CF中間状態、background cleanupがありません。
- **Async Commit:** PDが`start_ts`と`latest_ts`を返します。2 Regionのprewriteは
  それぞれ独立にRaft applyへ達して`min_commit_ts`を返し、モデル上の
  `commit_ts`はその最大値であって、PDが払い出すcommit timestampではありません。
  両prewriteの後にclientへ応答し、両Regionのcommit record解決はbackgroundで
  続きます。
- **通常2PC:** PDが`start_ts`を返し、両Regionのprewriteがjoinした後で
  `commit_ts`を払い出します。primary commitとそのRegionのRaft applyがclient
  responseを制御し、secondary commitとlock cleanupはbackgroundで続きます。

これらのfixtureでは両方のoptional featureを有効にしています。Async Commitの
eligibility判定は、対象client実装のdefaultである256 key、合計4,096 key byteに
固定しています。これはこのモデルが取り込んだ実装上のdefaultであり、公開された
安定的なTiDB contractでもtuning推奨値でもありません。通常2PC fixtureは意図的に
257個のaggregate mutationを使い、どのfixtureもaggregate countとsynthetic ID
だけを保持します。

![1PC、Async Commit、通常2PCを比較するTiCity Protocol Lab](docs/protocol-lab.png)

GC/Storage Labは、公開中の`gc-safe-point` scenarioから直接開けます:
[City](https://penguin425.github.io/TiCity/?scenario=gc-safe-point&event=trace-1-event-22)、
[Machine](https://penguin425.github.io/TiCity/machine/?scenario=gc-safe-point&event=trace-1-event-22)、
[Diagnose](https://penguin425.github.io/TiCity/diagnose/?scenario=gc-safe-point&event=trace-1-event-22)。
これらの公開linkはv0.8のscenarioと選択exact eventを引き継ぎます。
Cityは固定capacityの3D cutawayと日本語／英語のsemantic inspectorを使います。
Machineは正確な因果DAGを置き換えず、2行の意味pipelineを追加します。Diagnoseは
候補とbound、coordinator stage、lock、range、3つのStore detector／filter、
論理version、機構境界のrowを表示します。3画面とも同じ選択event後snapshotを
読み取ります。

43 eventのreceiptは、2回の決定的なroundからなります。round 1ではGC lifetimeが
候補を作り、報告されたactive transaction状態がglobal `minStartTS - 1`へ制限し、
このfixtureにはさらに古いexternal service safe pointがありません。TiDBは
`mysql.tidb`へ`tikv_gc_safe_point`をstageし、代表Regionをscanして2つの合成old
lockを解決し、visibility safe pointを保存して、固定した実装上の100秒cache
barrierを通過します。その後、1つの合成drop済みrangeを処理し、単調増加する
global値をPDへ公開します。3つのTiKV storeは大きくなった値を非同期に観測し、
Compaction Filterの進行を表示します。

明示的な教育用境界で、blockerはtransaction commit protocolをこのslice内で
再生せずに完了します。そのためround 2は後の候補を受け入れ、fixture上のlockも
Delete Range taskも残っていないことを確認し、後の値を公開してStore filterを
再実行できます。version boardは単一の論理projectionです。最後の対象Putを
anchorとして残し、1つのold Delete chainを含むobsolete recordを除去し、filterが
削除するDEFAULT CFの長いvalueを数えます。3 replica分の複製、disk byte測定、
latency benchmarkではありません。

このsliceは、TiDB/TiKV v8.5.0で使われるTiDB、TiKV、PD、client実装profileへ
固定しています。ResolveLockはScanLockとcommit／rollback outcomeまでを表し、
内部Raft entryは意図的に範囲外です。classic raftstore-v1 fixtureの
`UnsafeDestroyRange`はRegion Raftを迂回し、RocksDB Compaction Filterはモデル上の
Raft entryを作りません。後のpatch releaseやraftstore-v2では内部経路が異なる
場合があります。正確なsource commitと行単位の参照は
[モデル境界](docs/MODEL_BOUNDARY.md)に記録しています。

![round 1のCompaction Filter eventを表示するTiCity GC/Storage Lab](docs/gc-storage-lab.png)

## 代表シナリオ

1. Point Readとルーティング
2. 複数Regionをまたぐ悲観トランザクション
3. 悲観lock wait、deadlock、rollback、application retry
4. 楽観トランザクションの競合
5. 1PC／Async Commit／通常2PCの比較
6. 連番キーhotspotとRegion split
7. TiKV障害とleader election
8. 2-round、43 eventの長時間transactionとGC／storage trace
9. TiFlash catch-upとMPP集約

## ローカル実行

Node.js 24以降とWebGL2対応ブラウザが必要です。

```bash
npm install
npm run dev
```

検証と静的ビルド:

```bash
npm test
npm run typecheck
npm run build
npm run preview
```

ビルド成果物は`dist/`だけで動作します。解析サービス、Cookie、外部API、
実クラスタへの接続はありません。自由入力SQLはメモリ内だけで扱い、
永続化も送信もしません。

## 設計上の境界

```text
src/tidb/
  model/      Three.jsに依存しない決定論的シミュレーション
  world/      状態を読むだけの3D地理・建物・フロー
  engine/     renderer、camera、collision、audio
  ui/         日本語／英語UI、SQL分類UI、ツアー
  machine/    2Dステートマシン
  diagnose/   状態診断
```

- モデルはThree.jsをimportしません。
- 3D Worldは`TiCityState`を変更しません。
- 2PCとRaftは別々の状態機械、色、`TraceEvent.domain`を持ちます。
- seedと固定stepが同じなら、状態と`TraceReceipt`も同じになります。
- model-2の詳細トランザクションでは、並列branchは教育用clock上で重なり得ますが、
  因果順序は明示的な依存関係で決まります。
- model-3 Lock Labのwait-for edgeは、waiterから現在のholderへ向きます。
  cycleを閉じたwaiterを決定的なmodel victimとし、最小の`start_ts`を決定的な
  wake優先順位とします。どちらもTiDBの選択保証ではなくTiCityのmodel policyです。
- model-4 Raft Failure Labでは、TiKVに設定された選出windowと、モデル上の
  決定論的な13 tick経過値／candidate policyを分けて表示します。PDは
  observer／routing限定で、retryはapplication retryではなく、同じlogical
  Region requestに対するTiDB内部処理です。
- model-5 Protocol Labの1PC、Async Commit、通常2PCは、3つの独立した代表的な
  fixtureです。event durationと順番に表示するlane順序はlatency比較ではありません。
  `start_ts`と`latest_ts`はモデル上のPD TSO call、1PC timestampはTiKV result、
  Async Commit timestampはTiKVが返した`min_commit_ts`の最大値、通常2PC
  timestampはprewrite後のPDから来ます。
- Protocol Labはtransaction commit coordinationと9本のRegion別Raft mutation
  chainを分離します。各chainはconceptual MVCC状態が変わる前に、propose、
  2 voterへのpersist、2-of-3 commit、applyを独立して示します。
- model-6 GC/Storage Labでは、43 eventすべてがdeep-freezeされた
  `gcLab`のevent後snapshotを持ち、City、Machine、Diagnoseが同じ選択snapshotを
  投影します。最初のsafe pointは`globalMinStartTS - 1`へ制限され、service
  point選択、`mysql.tidb`へのstage、Region ScanLock、visibility保存／cache
  barrier、Delete Range、PD global公開、Store観測、Compaction Filterを別々の
  stageとして扱います。
- GC/Storage LabはTiDB/TiKV v8.5.0のdefault Compaction Filterとclassic
  raftstore-v1 fixtureへ固定しています。ResolveLock内部のRaft詳細、
  raftstore-v2のDelete Range挙動、compactionのschedule／時間、実SST layout、
  physical byte、Raft log GCはモデル化しません。
- 初期36 Regionは教育用の代表値です。split後の追加Regionは2D診断に現れ、
  3D Cityは安定した36個のRegion slotを表示します。実クラスタの規模や時間を
  再現するものではありません。

v0.8では、機構レベルの詳細projectionを5 scenarioへ適用しています。
複数Regionトランザクションはtransaction 2PC、RegionごとのRaft、概念上のMVCCを
展開します。Lock LabはLeaderメモリ上のlock競合を展開し、commit経路を前者の
pipelineへhandoffします。Raft Failure Labは1 Regionの選出、current-term
Leader no-op、PDの観測とrouting、TiDB内部request復旧を展開します。Protocol
Labはeligibility、timestamp authority、1 Regionの1PC、2 RegionのAsync Commit、
通常2PCを、client／background境界と独立したRegion Raft chainを含めて展開します。
GC/Storage LabはResolve Locks、Delete Range、global公開、物理
compactionを1つのstepへまとめず、2回のsafe-point／storage roundを展開します。
ほかの4 scenarioは簡潔な教育用traceのままで、同じ機構上の深度をまだ主張しません。

ブラウザコンソールの`window.TICITY`から、モデル、再生、シナリオ、
最後の不変なトレースを操作・確認できます。
各表示上の主張と一次資料の対応は
[モデル境界](docs/MODEL_BOUNDARY.md)に記録しています。

## 派生元とライセンス

TiCityはPGSimCityの履歴を保持したforkです。派生元の基準commitと変更の
帰属は[NOTICE](NOTICE)に記載しています。コードは同じ
[Apache License 2.0](LICENSE)で提供されます。

Copyright 2026 Nikolay Samokhvalov<br>
TiCity changes Copyright 2026 TiCity contributors

TiDB、TiKV、TiFlashおよびPingCAPの公式ロゴや資産は同梱していません。
TiCityはPingCAP, Inc.とは独立したプロジェクトで、同社による承認・後援を
示すものではありません。
