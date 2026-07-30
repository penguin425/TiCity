# TiCity

[English](README.md) | 日本語

**TiDBの分散SQLアーキテクチャを、歩いて観察できる決定論的な3Dモデル。**

[PGSimCity](https://github.com/NikolayS/PGSimCity)から派生した、
Apache-2.0ライセンスの独立した教育プロジェクトです。TiCityはTiDB、
TiKV、TiFlashの実装そのものや接続済みクラスタではなく、主要な処理の境界と
順序を理解するための縮尺モデルです。既定の説明は日本語で、英語へ切り替えられます。

公開先: <https://penguin425.github.io/TiCity/>

![TiCityの3D都市でTransaction 2PCの現在経路を示すTrace Dock](docs/screenshot.png)

> [!IMPORTANT]
> TiCity v0.3.3はTiDB v8.5 LTSを対象にした静的・オフラインのモデルです。
> SQLを実行せず、実データや架空の結果行も返しません。入力した単一SQL文を
> ブラウザ内で分類し、モデル上の経路と説明だけを生成します。

## 観察できるもの

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
| `/` | 3D City、シナリオ、SQL経路、ツアー |
| `/machine/` | 同じ処理を追跡する2Dステートマシン |
| `/diagnose/` | モデル状態、Region、quorum、lag、履歴の診断 |

## 代表シナリオ

1. Point Readとルーティング
2. 複数Regionをまたぐ悲観トランザクション
3. 楽観トランザクションの競合
4. 1PC／Async Commit／通常2PCの比較
5. 連番キーhotspotとRegion split
6. TiKV障害とleader election
7. 長時間トランザクションとGC safe point
8. TiFlash catch-upとMPP集約

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
- 初期36 Regionは教育用の代表値です。split後の追加Regionは2D診断に現れ、
  3D Cityは安定した36個のRegion slotを表示します。実クラスタの規模や時間を
  再現するものではありません。

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
