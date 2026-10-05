# TiDB v8.5 ソース比較監査 — 2026-10-05

## v0.12.0 での追加精緻化

現行のモデルは `tidb-v8.5-model-9`。SQL の実行可能コメント・型変換・主キー範囲、
連続操作での状態保持と quorum、Raft の vote / persist / apply、GC の完全な論理入力と
Delete eligibility、MPP の独立した複製と逐次結果受信を追加検証した。
固定ソースへのリンク、修正内容、教育上の省略は [REFINEMENT.md](REFINEMENT.md) に記録する。
以下の F1〜F8 は初回監査と v0.11 の修正履歴として保持している。

## v0.11.0 での修正

モデル `tidb-v8.5-model-8` で F1〜F8 を修正した。以下の指摘と観測値は
初回監査の baseline `1ea6ae18` に対する記録であり、現行版の未修正一覧ではない。

| ID | 修正後の条件 |
| --- | --- |
| F1 | 生存 voter / 候補の log / persistence quorum を分離。compact 選挙は current-term no-op を commit / apply してから read。Follower Read は ReadIndex と local apply を待機 |
| F2 | NOT・comma join・OVER・未対応構文を拒否し、単一 table / alias と肯定的条件を検証 |
| F3 | data / PD control / transaction commit / Raft replication の directed hops を分離 |
| F4 | scalar / grouped を分析・ReplaySpec・plan に保持。scalar は TiDB final、詳細 grouped Lab は grouped のみ |
| F5 | tunnel planned → dispatch → TiFlash registered、通常 MPP も dispatch → per-Region gate |
| F6 | optimization candidates → latestTS / request bounds → Region batching / final protocol → Prewrite |
| F7 | PD latestTS と TiKV-returned timestamp を分離。floor は latestTS + 1、返却結果で PD allocation を増やさない |
| F8 | 初回 filter は Delete Keep / filter 3、後続 filter 累計 5、別 GC-key task で marker 1 件を削除 |

split actor、PD heartbeat の因果関係、commit family 名、GC coordinator / filter trigger の
説明、日英 event copy も更新した。修正後は次の offline チェックで 8 系統を確認できる。

```bash
node tools/reproduce-source-audit.mjs --verify
```

修正後のローカル検証は 51 files / 391 unit tests、typecheck、production build、
license / offline boundary、8 系統の verifier が成功した。verifier の JSON は
同じ seed での 2 回実行で byte 単位の一致も確認した。ブラウザの完全な検証は
CI の全 shard と Pages の公開前 gate で行う。

## 初回監査の記録

TiCity の処理順序・状態・説明を、宣言している TiDB v8.5.0 と関連コンポーネントの実ソースに照合した。**修正が必要な不整合を 8 系統確認した。** 以下の P2 は教育モデルの正常系・分類・因果説明に影響する問題、P3 は説明の改善を示す。TiDB 本体の障害を報告するものではない。

監査対象は TiCity `1ea6ae18caf38405196b2faf65b09603d37f0c44`、モデル `tidb-v8.5-model-7`。このコミットの `src/tidb/model/`、`src/tidb/ui/`、`src/tidb/diagnose/` は公開済み v0.10.2 の `029d88fac3c662b1ed8dc8ce822db25e43161412` と同じで、今回の指摘は造形変更に起因しない。初回監査で追加したのは監査文書と再現ツールのみだった。v0.11.0 では上記の動作修正を行った。

## 対象と方法

| 対象 | 確認した固定リビジョン |
| --- | --- |
| TiDB v8.5.0 | [`d13e52ed6e22cc5789bed7c64c861578cd2ed55b`](https://github.com/pingcap/tidb/tree/d13e52ed6e22cc5789bed7c64c861578cd2ed55b) |
| TiDB が使用する client-go | [`006dfb024c26859f2e3757172296d84ef36ff585`](https://github.com/tikv/client-go/tree/006dfb024c26859f2e3757172296d84ef36ff585) |
| TiKV v8.5.0 | [`a2c58c94f89cbb410e66d8f85c236308d6fc64f0`](https://github.com/tikv/tikv/tree/a2c58c94f89cbb410e66d8f85c236308d6fc64f0) |
| TiKV が使用する raft-rs | [`a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e`](https://github.com/tikv/raft-rs/tree/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e) |
| PD v8.5.0 | [`d190c0e9082de46128b756f93b1291768dda645a`](https://github.com/tikv/pd/tree/d190c0e9082de46128b756f93b1291768dda645a) |
| TiFlash v8.5.0 | [`6e12ba23c70f358f2ffbee837feac24118a3e988`](https://github.com/pingcap/tiflash/tree/6e12ba23c70f358f2ffbee837feac24118a3e988) |
| TiFlash proxy / engine FFI | [`b877a976997acb7c552db970c01546b4e82bce18`](https://github.com/pingcap/tidb-engine-ext/tree/b877a976997acb7c552db970c01546b4e82bce18) |

各 v8.5.0 タグのコミットを確認し、TiDB の [go.mod](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/go.mod) と TiKV の [Cargo.lock](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/Cargo.lock#L4988-L4990) から依存ソースのリビジョンも確認した。

現行の公式ドキュメントは `pingcap/docs` の `release-8.5` を監査時点の [`49ed15df968aedb44b0290df53e124ef740c6a67`](https://github.com/pingcap/docs/tree/49ed15df968aedb44b0290df53e124ef740c6a67) に固定して参照した。このブランチには後続パッチの説明も含まれるため、個別の実装順序の判定は上記 v8.5.0 ソースを優先した。

ソースの呼び出し順を読み、純 TypeScript モデルで状態・イベント・SQL 表示を再現した。実 TiDB クラスタや Go/Rust/C++ の結合テストは実行していない。TiCity は SQL を実行せず結果行も返さないため、以下はモデルと表示の問題である。`MODEL_BOUNDARY.md` に明示された省略、固定 fixture、合成時間、スケジューリング方針は、それだけを理由に問題としていない。

## 確認済みの不整合

### F1 / P2 — Raft の生存 quorum と追従済み peer 数を混同する

**場所:** `src/tidb/model/simulation.ts:650–658`、`src/tidb/model/raft-lab.ts:412–417`。

`ensureLeader` は `healthy && matchIndex >= commitIndex` の peer が 2 台未満なら、現在の leader が正常でも先に失敗を返す。Raft Lab の選挙条件も、最新 log を持つ候補の「人数」が quorum に達することを要求する。古い log の生存 voter が最新候補に投票できることを表現できていない。

**再現:** `cross-region-transaction` → Region 0 の `tikv-failover` → Region 19 の read を公開モデル API から実行する。Region 19 は正常な leader TiKV 2（index 2）と正常な follower TiKV 3（index 0）が残るが、read は `Region 19 has no available leader.` で失敗し、write も rollback する。状態を直接改変せず再現した。通常のシナリオボタンは切替時に reset するため、これは公開モデル操作での再現であり、同じボタン順だけで起きると主張しない。

別の有効な reducer 入力では、旧 leader 障害後の生存 log が index 42 / 41 のとき、最新の 42 を候補にしても `election requires a live quorum` となる。固定 Lab fixture は全 peer が index 42 のため、この誤った条件を通過してしまう。

**ソースの根拠:** raft-rs の [投票条件](https://github.com/tikv/raft-rs/blob/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e/src/raft.rs#L1472-L1503) は候補の log が voter 自身より古くないことを確認する。[選挙](https://github.com/tikv/raft-rs/blob/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e/src/raft.rs#L1271-L1320) は configured voters の票を集める。[遅れた follower の追従](https://github.com/tikv/raft-rs/blob/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e/src/raft.rs#L1761-L1836) と [leader の proposal](https://github.com/tikv/raft-rs/blob/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e/src/raft.rs#L2051-L2130) は、遅れを回復して新しい entry の persistence quorum を成立させる。

**修正方針:** 生存 voter、候補の log 適格性、投票 quorum、新 entry の persistence quorum を分ける。正常な現在の leader を follower の遅れだけで不在扱いにしない。上記の自然な操作列と 42 / 41 の選挙を invariant テストにする。

### F2 / P2 — SQL の否定・結合・Window を別の処理として受理する

**場所:** `src/tidb/model/sql.ts:201–239`、`:443–519`。

主キー判定は WHERE 内に `id = literal` というトークン列が存在するかを探し、論理式の肯定・否定を確認しない。また、`JOIN` / `WINDOW` キーワードだけを拒否し、単一テーブルの FROM や `OVER()` を確認しない。

**再現:**

| 入力 | 現在の分類 | 食い違い |
| --- | --- | --- |
| `SELECT * FROM accounts WHERE NOT (id = 1)` | `point_read / Point_Get` | 1 キーの肯定的等値条件ではない |
| `UPDATE accounts SET balance = 0 WHERE NOT (id = 1)` | 対応済みの bounded KV write | 1 行への限定条件ではない |
| `DELETE FROM accounts WHERE NOT id = 1` | 対応済みの bounded KV write | 同上 |
| `SELECT * FROM accounts a, orders o WHERE a.id = 1` | accounts だけの `Point_Get` | orders との結合を消している |
| `SELECT COUNT(*) OVER () FROM events` | 集約 MPP | Window の行ごとの処理を普通の集約に変えている |

これは「完全な SQL parser ではない」という境界で正当化できない。未対応構文を保守的に拒否するという、この classifier 自身の方針に反している。

**ソースの根拠:** TiDB の [Point_Get 条件抽出](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/point_get_plan.go#L1648-L1666) は AST の `LogicAnd` / `EQ` を扱い、[単一テーブル判定](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/point_get_plan.go#L1626-L1646) が必要。Window には [別の physical plan 経路](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/exhaust_physical_plans.go#L2405-L2445) がある。

**修正方針:** 肯定的な等値条件の AND、選択テーブルと alias の対応、単一 FROM を保守的に検証する。NOT、カンマ結合、OVER を対応範囲から外す。実 optimizer 全体を再実装する必要はない。

### F3 / P2 — SQL 経路表示に PD の制御通信や Raft を混ぜる

**場所:** `src/tidb/ui/sql.ts:73–87`、`src/tidb/model/simulation.ts:951–959`、`src/tidb/ui/catalog.ts:227–228`。

`defaultRoute` は全イベントの source / target を無区別に一本の ordered list にする。point read の表示は `Client → TiProxy → TiDB → PD → TiDB → PD → TiDB → TiKV → TiDB → Client` となる。write では Raft の peer 間通信も入る。また、PD の Region metadata 照会を `sql` domain で送り、その凡例は「SQL / データ経路」になっている。

モデルが実際に行データを PD に送っているという指摘ではない。**制御・複製・データの異なる経路を区別せず表示し、PD がデータ経路に入るように見せている**ことが問題である。

**ソースの根拠:** client-go の [PD oracle](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/oracle/oracles/pd.go#L246-L272) は TSO、[RegionCache](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/internal/locate/region_cache.go#L2049-L2101) は Region metadata を取得する。[GetRequest](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/txnsnapshot/snapshot.go#L665-L723) は key / version を TiKV に送る。公式の [architecture](https://github.com/pingcap/docs/blob/49ed15df968aedb44b0290df53e124ef740c6a67/tidb-architecture.md#L27-L43) も役割を分けている。

**修正方針:** データ要求・結果の経路と、TSO / metadata / Raft の edge を型と表示で分ける。`locate_regions` の domain と凡例も制御通信として扱う。

### F4 / P2 — GROUP BY のない COUNT に grouped MPP の流れを表示する

**場所:** `src/tidb/model/sql.ts:313–385`、`:458–465`、`src/tidb/model/simulation.ts:8039–8051`。

`SELECT COUNT(*) FROM events` にも `HashAgg(Partial) → HashPartition → HashAgg(Final)` を TiFlash 内に表示する。scalar / grouped の区別を保持していない。さらに、`tiflash-mpp` シナリオ後にこの SQL を入力すると、`queryClass='grouped_aggregate'`、final task 2 個の詳細 Lab に入る。`sql.test.ts:96–112` は現在、この誤った scalar 用 HashPartition を期待値にしている。

**ソースの根拠:** TiDB の [候補生成](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/exhaust_physical_plans.go#L2720-L2733) は、通常の GROUP BY なし・DISTINCT なし COUNT を MPP で扱う場合、`MppTiDB` を生成する。[task への接続](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/task.go#L2178-L2185) は partial を TiFlash、final を TiDB root に置く。DISTINCT 等の `MppScalar` では [single partition](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/task.go#L2187-L2260) を要求し、grouped fixture の複数 final task と同じにはならない。

実際にどの plan が採用されるかは schema、統計、設定、cost に依存する。この指摘は「本物の EXPLAIN と同じ plan を出すべき」というものではなく、scalar を grouped fixture として説明する意味上の不整合である。

**修正方針:** analysis に scalar / grouped を保持して plan と scenario dispatch を分ける。固定 grouped Lab はその対応 SQL に限定する。未対応 aggregate 形状は明示的に拒否する。

### F5 / P2 — TiFlash dispatch と server 側の処理順が逆になる

**場所:** 詳細 Lab の `src/tidb/model/simulation.ts:1434–1470`、`src/tidb/model/tiflash-mpp-lab.ts:183–250`、通常 SQL の `simulation.ts:988–1019`。

詳細 Lab は task が全て `built` の時点で tunnel 6 本を `registered` にし、そのイベントを前提に TiFlash へ dispatch する。TiDB による論理的な tunnel 計画と、TiFlash server 上の登録を混同している。日英の event / inspector / Diagnose も「登録」と説明する。

通常 SQL の簡略 MPP trace は `learner_snapshot_gate → mpp_dispatch` の順になり、TiFlash の task 内の read gate が task 受信より先に完了する因果関係を作る。初期モデルで INSERT の直後に COUNT を分類すると再現する。

**ソースの根拠:** TiDB の [TargetTasks 計画](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/fragment.go#L418-L428) は dispatch より前にできる。一方、TiFlash の [MPPTask::prepare](https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Flash/Mpp/MPPTask.cpp#L390-L460) は受信した `DispatchTaskRequest` を読み、task を登録してから `registerTunnels` を呼ぶ。learner read はその後の [DAGStorageInterpreter::execute](https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Flash/Coprocessor/DAGStorageInterpreter.cpp#L305-L316) が行う [prepare / learner read](https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Flash/Coprocessor/DAGStorageInterpreter.cpp#L595-L626) の中にある。

**修正方針:** pre-dispatch の tunnel は `planned` とし、dispatch 受信後の prepare で `registered` に遷移する。簡略 trace も dispatch を gate より前にする。省略する場合でも、表示する因果関係を逆にしない。

### F6 / P2 — Protocol Lab の最終 2PC lane が必要な latestTS を消す

**場所:** `src/tidb/model/simulation.ts:5284–5310`、`:6246–6279`、`src/tidb/model/protocol-lab.ts:334–338`。

2PC fixture は 1PC / Async Commit 両フラグ ON、linearizable、257 mutations、2 Regions。ここでは global / non-pipelined transaction、binlog なし、commitTS upper-bound callback なしという通常 fixture の条件で照合した。モデルは最初に両最適化を拒否し、latestTS を取得せず Prewrite に進む。reducer も最終 protocol が 2PC なら latestTS を許さない。再現結果は `latestTs=null`、TSO イベントは startTS と post-prewrite commitTS の 2 つだけ。

**ソースの根拠:** client-go の [Async 条件](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1504-L1530) では 257 keys は不適格だが、[1PC 初期条件](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1537-L1546) はまだ Region batching を見ていない。[latestTS 取得](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1745-L1769) を行ってから [prewriteMutations](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1797) に入り、[Region grouping](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L807-L814) / [1PC fallback](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1577-L1582) で 1PC を外す。最終 2PC は Prewrite 後に [別の commitTS](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1885-L1894) も取る。

**修正方針:** 最適化の候補、batching 決定、最終 protocol を分ける。現在の fixture を維持するなら、latestTS / min / max の準備を batching 拒否より前に置き、最終 2PC でも保持する。Async lane の batching 拒否も同じ順序を修正する。別案は両フラグ OFF の通常 2PC fixture にすることだが、その場合は fixture の比較目的・説明も変更する。

### F7 / P2 — 通常 SQL の 1PC / Async Commit が commitTS の由来を変える

**場所:** `src/tidb/model/simulation.ts:7745`、`:7771–7787`、`:7833`。

簡略 1PC は直接 `allocateTs()` を commitTS にする。Async は同じ PD allocator の値を minCommitTs と呼び、そのまま commitTS にする。再現では両方とも `commitTs === tso.lastAllocated === 1000000002`、PD allocations は 2。1PC は 2 回目の PD 割当てイベントさえ表示しない。詳細 Protocol Lab はここを適切に分離している。

**ソースの根拠:** linear consistency の最適化は [latestTS + 1 の request floor](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1745-L1761) を用意する。1PC は [Prewrite response の onePCCommitTS](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1862-L1871) を使い、Async は [各 Region の返した minCommitTs](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/prewrite.go#L408-L424) を取り込んだ [最大値](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1879-L1883) を使う。TiKV も [max_ts 等を考慮して計算](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/storage/txn/actions/prewrite.rs#L815-L819) する。

**修正方針:** 合成値のままでよいので、PD の latestTS、`latestTS + 1` の floor、TiKV が返す timestamp を分ける。後者を求めるときに PD allocation counter を増やさない。最適化で post-prewrite commitTS RPC を省く意味を正しく示す。既存の response / background commit の順序は維持する。

### F8 / P2 — GC Compaction Filter の初回に最新 Delete marker まで消す

**場所:** `src/tidb/model/simulation.ts:7260–7266`、`src/tidb/model/gc-lab.test.ts:295–304`。

round 1 の `gc_compaction_filter_apply` は、safe point 以下の最新 Delete `b-v2` と古い Put `b-v1` を同時に `filtered` にする。filtered count は 4。upstream の filter は、この初回では最新 Delete を Keep し、古い Put だけを除去する。

**ソースの根拠:** TiKV の [filter の Delete 分岐](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/compaction_filter.rs#L485-L507) は `remove_older=true` にするが、Delete 自体は Keep する。bottommost marker の掃除は [GcTask::GcKeys](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/compaction_filter.rs#L445-L454) に分離され、[同じ compaction で古い version と overlap しないこと](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/compaction_filter.rs#L470-L483) が scheduling 条件となる。upstream の [テスト](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/compaction_filter.rs#L1090-L1100) も初回は task なし、後続 compaction では task ありを確認している。

**修正方針:** round 1 の marker を残し、filtered count を 3、present count を 9 にする。後続 round では marker を残す境界を明示するか、別の GC-key task とその完了を追加する。inline filter が marker を消したと説明しない。現在の unit test は誤った値を期待しているため、通過してもソース整合性の証明にならない。

## 二次的な説明・境界の改善

| 優先度 | 場所 / 論点 | 修正方針と根拠 |
| --- | --- | --- |
| P3 | `simulation.ts:778–817`、`ui/event-copy.ts:318–331`: サイズ閾値の split を「PD がスケジュール」と表示 | この fixture の自動 split は TiKV の [split checker](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/components/raftstore/src/store/worker/split_check.rs#L706-L724) → [PD ID allocation / TiKV admin command](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/components/raftstore/src/store/worker/pd.rs#L1042-L1088) が起点。compact な省略は許容するが actor を修正する。PD の [明示的 split operator](https://github.com/tikv/pd/blob/d190c0e9082de46128b756f93b1291768dda645a/pkg/schedule/splitter/region_splitter.go#L189-L203) も実在し、PD が一切 split を要求しないという意味ではない |
| P3 | `ui/gc-storage-lab.ts:132,224,279,371`、`ui/event-copy.ts:993–994`: staging / visibility / DeleteRange の説明と filter 起動契機 | staging は Resolve Locks 前、visibility-save は DeleteRange 前。Store の PD safe point 観測は local 値更新であり、filter を直接起動しない。[GC coordinator](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L482-L513)、[Store GC manager](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/gc_manager.rs#L325-L335) に合わせる。モデル本体の coordinator 順序は正しい |
| P3 | `ui/catalog.ts` の `txn2pc` ラベル | 1PC / Async も含む domain を全て「Transaction 2PC」と呼ばず、commit family と個別 protocol を区別する |
| P3 | `ui/event-copy.ts` の通常 Async / TiFlash 説明 | `min_commit_ts`、`commit_background`、`learner_snapshot_gate`、`mpp_dispatch` を辞書に追加する。主要な flow event が汎用の unknown 説明に落ちる。詳細 9 scenarios の event copy は揃っている |
| 条件付き | `simulation.ts:1029–1038`: Follower Read の ReadIndex / apply gate が省略 | 実 TiKV の [applied-index gate](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/components/raftstore/src/store/peer.rs#L2509-L2520) と [ReadIndex response](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/components/raftstore/src/store/peer.rs#L3528-L3575) を compact に表現するか assumed-ready 境界を明示する。選択 follower の apply 遅れを直接注入すれば success を確認できるが、現在の通常操作でその follower を遅らせる再現は未確認。現行 UI が stale rows を返したと主張しない |
| P3 | `simulation.ts:2960`: PD heartbeat が current-term no-op apply に因果依存 | 実 TiKV は [leader role 変更時](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/components/raftstore/src/store/fsm/peer.rs#L2181-L2191) に PD heartbeat を予定できる。no-op apply は安全な read の条件で、PD 通知の必須条件ではない。固定表示順と実装上の依存を分ける |

## 整合していた主要な流れ

- **詳細 cross-Region 2PC:** 各 Region の Prewrite / Raft と、transaction 全体の commit 判定は分離されている。全 Prewrite 完了後の commitTS、primary 決定の永続化後の応答、secondary の background cleanup は client-go の [commit 処理](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L998-L1054) と整合する。background の具体的な表示時刻は明示されたモデル方針。
- **詳細 1PC / Async Commit:** 1PC の TiKV-returned commitTS、Async の Region 最小値の最大値、応答後の background Commit は整合する。問題は F6 の初期準備順と F7 の別実装である。
- **Lock Lab:** waiter → holder の wait-for edge、non-retryable deadlock、全 transaction rollback、アプリによる新 startTS の transaction retry は [TiDB の retry 判定](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/sessiontxn/isolation/repeatable_read.go#L242-L258) と整合する。固定 victim / wake 方針は MODEL POLICY として区別されている。
- **詳細 Raft failover:** Pre-Vote / Vote、current-term 空 entry、persistence quorum、leader apply、read の基本順序は整合する。PD は投票せず、TiDB が request retry を所有する。13 ticks / lowest Store ID は明示された固定方針。F1 の log skew を持たない固定 fixture は正常に進む。
- **詳細 TiFlash:** TiFlash learner は voter quorum に入らない。永続的 Raft replication と一時的 MPP Exchange を分離し、Region cache への Raft command 適用 → committed data の DeltaMerge write → applied-index 更新・通知を [実ソース](https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Storages/KVStore/MultiRaft/RaftCommands.cpp#L460-L516) と同じ順にする。per-Region safe-ts fast path、ReadIndex、waitIndex、lock 確認は [LearnerReadWorker](https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Storages/KVStore/Read/LearnerReadWorker.cpp#L108-L160) と [wait / lock 処理](https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Storages/KVStore/Read/LearnerReadWorker.cpp#L353-L419) に沿う。F5 の tunnel 登録順は別途修正が必要。
- **GC coordinator:** lifetime、active min startTS、service safe point、単調な PD publication、Resolve Locks → visibility-save / cache barrier → DeleteRange → PD publication は [GC worker](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L482-L559) と整合する。Put anchor と DEFAULT CF cleanup も正しく、F8 の Delete marker を除く filter の基本規則は合う。

`SELECT ... FOR UPDATE` は現在 plain read に分類されるが、TiDB にも [autocommit 時の lock skip](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/point_get_plan.go#L941-L960) があり、TiCity は session transaction context を定義していない。今回は無条件の不具合に数えない。将来 explicit transaction を対応範囲にするなら、locking read を拒否するか別途モデル化する必要がある。

## 再現と検証

Node.js 26 とインストール済みの依存関係で、リポジトリの root から次を実行する。

```bash
node tools/reproduce-source-audit.mjs
```

[再現ツール](../tools/reproduce-source-audit.mjs) は固定 seed 425 と、ツール内に記載した合成 demo SQL だけを用いる。モデルをメモリ内で bundle し、F1〜F8 の観測値を JSON 出力する。入力したユーザー SQL を取得せず、実 DB 接続・SQL 実行・ネットワーク通信・アプリコードの書換えは行わない。これは現在のモデルを観測するツールであり、baseline の誤った観測値を要求しない。モデル8以降の修正条件を検証する場合は --verify を付ける。

監査時に確認した主な値は次のとおり。

| ID | 実測したモデル出力 |
| --- | --- |
| F1 | 正常 leader + 生存 lagging voter の Region 19 read が `failed`、write が `rolled_back`。42 / 41 の選挙は例外 |
| F2 | NOT / comma join / OVER の 5 例が全て `supported` |
| F3 | point read の route に PD が 2 回入る |
| F4 | scalar plan に HashPartition。grouped scenario 後の scalar も `grouped_aggregate` / final task 2 |
| F5 | dispatch 前に tunnel 6 本が `registered`。compact trace は gate → dispatch |
| F6 | 最適化フラグ両 ON の最終 2PC lane が `latestTs=null` |
| F7 | 1PC / Async の `commitTs === PD lastAllocated === 1000000002` |
| F8 | round 1 で `b-v2.state='filtered'`、filtered count 4 |

初回監査時の検証結果:

- 再現ツールを Node.js 26 で 2 回実行し、8 系統の観測値と因果 edge を確認。JSON 出力も byte 単位で一致した。
- `npm test`: 48 files / 329 tests 成功。`npm run typecheck`、`npm run build`、`npm run test:license`、再現ツールの `node --check`、`git diff --check` も成功。
- 標準 `npm run test:e2e` は Playwright 管理ブラウザが環境内にないため起動できなかった。既存の system Chromium に切り替えた再実行は 4 tests 成功後に停止し、1 interrupted / 42 not run。今回の変更は文書と観測ツールのみでアプリコードを変えていないため、全 47 tests は監査対象と同一コミット `1ea6ae18` の [成功済み CI](https://github.com/penguin425/TiCity/actions/runs/37238305458) を根拠とする。今回のローカル再実行で 47 tests 全てが成功したとは報告しない。

修正時は、上記ソースの条件を invariant として検証し、日英 catalog、snapshot / delta、ReplaySpec、モデル version を一緒に見直す。現在の scalar / GC の誤った期待値を維持したまま tests を追加しても、正しい流れを保証できない。
