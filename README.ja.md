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
> TiCity v0.6.0はTiDB v8.5 LTSを対象にした静的・オフラインのモデルです。
> SQLを実行せず、実データや架空の結果行も返しません。入力した単一SQL文を
> ブラウザ内で分類し、モデル上の経路と説明だけを生成します。

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
- 不変なイベント後snapshot、明示的なfork/join依存、クライアント応答境界、
  応答後のsecondary cleanupを持つ因果イベントグラフ
- 3D City、Machine、Diagnoseへ投影される1つの不変なreceipt。Lock Labの
  意味上のwait-for graphとRaft Failure Labの意味上の選出graphは、どちらも
  因果依存graphとは分離されます
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
| [`…/TiCity/?scenario=tikv-failover&event=trace-1-event-16`](https://penguin425.github.io/TiCity/?scenario=tikv-failover&event=trace-1-event-16) | exact event時点の3D Cityとscenarioで選択した詳細Lab |
| [`…/machine/?scenario=tikv-failover&event=trace-1-event-16`](https://penguin425.github.io/TiCity/machine/?scenario=tikv-failover&event=trace-1-event-16) | 因果event DAGと、分離されたLock wait-forまたはRaft Pre-Vote／Vote意味graph |
| [`…/diagnose/?scenario=tikv-failover&event=trace-1-event-16`](https://penguin425.github.io/TiCity/diagnose/?scenario=tikv-failover&event=trace-1-event-16) | exact event時点のtransaction、Raft選出、MVCC、lock wait、deadlock、retry診断 |

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

## 代表シナリオ

1. Point Readとルーティング
2. 複数Regionをまたぐ悲観トランザクション
3. 悲観lock wait、deadlock、rollback、application retry
4. 楽観トランザクションの競合
5. 1PC／Async Commit／通常2PCの比較
6. 連番キーhotspotとRegion split
7. TiKV障害とleader election
8. 長時間トランザクションとGC safe point
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
- 初期36 Regionは教育用の代表値です。split後の追加Regionは2D診断に現れ、
  3D Cityは安定した36個のRegion slotを表示します。実クラスタの規模や時間を
  再現するものではありません。

機構レベルの詳細projectionは、現時点では3 scenarioに適用されています。
複数Regionトランザクションはtransaction 2PC、RegionごとのRaft、概念上のMVCCを
展開します。Lock LabはLeaderメモリ上のlock競合を展開し、commit経路を前者の
pipelineへhandoffします。Raft Failure Labは1 Regionの選出、current-term
Leader no-op、PDの観測とrouting、TiDB内部request復旧を展開します。ほかの
6 scenarioは簡潔な教育用traceのままで、同じ機構上の深度をまだ主張しません。

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
