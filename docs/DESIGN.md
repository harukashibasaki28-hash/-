# 手帳アプリ 設計書（ドラフト v0.2）

> 状態: **確認待ち**。この設計で良いか確認を取ってから実装に入ります。
> v0.2 の変更: データの本体を Google スプレッドシートに移し、スマホと PC で同期する形に変更。

## 0. 全体像

```
 ┌──────────── スマホ / PC ────────────┐            ┌────────── Google（自分のアカウント）──────────┐
 │  手帳アプリ（PWA, GitHub Pages）     │            │  GAS Web アプリ（自分として実行）               │
 │   ├ 画面                             │  HTTPS     │   ├ sync: 変更の受け取り・差分の返却             │
 │   ├ 計算（睡眠・繰越・タイムライン） │ ─────────▶ │   ├ calendar: タスク時刻を登録・更新            │
 │   ├ IndexedDB（控え＋未送信の変更）  │ ◀───────── │   └ 合言葉（キー）で本人確認                    │
 │   └ 同期エンジン                     │            │  スプレッドシート「手帳DB」（データの本体）      │
 └──────────────────────────────────────┘            │  時間トリガー: 21:50 翌日To Do / Gmail / 23:00  │
                                                     │  Googleカレンダー・Gmail                        │
                                                     └─────────────────────────────────────────────────┘
```

| 項目 | 決定 |
|---|---|
| 形態 | PWA（ホーム画面に追加）＋PC ブラウザ。GitHub Pages で無料公開 |
| 技術 | ビルド不要の素の JavaScript（ES Modules）＋HTML＋CSS。外部パッケージなし |
| データ本体 | Google スプレッドシート（GAS 経由で読み書き） |
| 端末内 | IndexedDB に控え＋未送信の変更。オフラインでも記録でき、つながったら自動で反映 |
| テスト | Node.js 標準の `node --test`（インストール不要） |
| 有料サービス | なし |

計算ロジックは画面から切り離した関数にして、Node でテストします。

---

## 1. ファイル構成

```
/
├─ index.html                 アプリ本体（1ページ、タブで画面切り替え）
├─ manifest.webmanifest       PWA 設定
├─ sw.js                      Service Worker（オフラインでも起動）
├─ icons/
├─ config/
│   ├─ defaults.json          初期設定（目標時刻・固定予定・毎日のタスク・食事枠など）
│   └─ rules.json             改善策ルールの初期値（アプリ内で追加・編集可）
├─ src/
│   ├─ app.js                 起動（控えを読む→同期→繰越→画面表示）
│   ├─ store/
│   │   ├─ localDb.js         IndexedDB（控え・未送信キュー）
│   │   ├─ repo.js            データ操作の窓口（画面はここだけを使う）
│   │   └─ sync.js            同期エンジン（送信・受信・競合解決・再試行）
│   ├─ model/
│   │   ├─ schema.js          データ型・既定値・正規化
│   │   ├─ importExport.js    JSON 読み込み・書き出し ★最初に作る
│   │   └─ dates.js           日付計算（Asia/Tokyo 固定、論理日付）
│   ├─ core/
│   │   ├─ sleep.js           寝る/起きた/昼寝、睡眠時間
│   │   ├─ tasks.js           タスク操作、毎日のタスクの展開
│   │   ├─ timer.js           計測、止め忘れ検知
│   │   ├─ carryover.js       繰越・closed
│   │   ├─ study.js           4002 / FP2級 の進行・章末問題・遅れ警告
│   │   ├─ scheduler.js       タイムライン自動作成
│   │   ├─ estimates.js       実績倍率・見積もり補正
│   │   └─ stats.js           完了率・【min】達成・平均ずれ・週集計・標準偏差
│   ├─ analysis/
│   │   ├─ index.js           分析器の登録口（差し替え可能）
│   │   ├─ metrics.js         ルールが参照する指標
│   │   └─ ruleEngine.js      ルール評価 → 課題・改善策
│   ├─ notify/
│   │   ├─ notifier.js        アプリを開いている間の通知
│   │   ├─ ics.js             アラーム付き .ics 生成
│   │   └─ shortcuts.js       iPhone ショートカット起動 URL
│   └─ ui/                    today / timeline / review / weekly / hourensou /
│                             log / study / inbox / settings / chart.js / styles.css
├─ gas/                       Apps Script（スプレッドシートに貼り付ける）
│   ├─ appsscript.json        timeZone: "Asia/Tokyo"
│   ├─ Main.gs                doGet / doPost、本人確認、振り分け
│   ├─ Db.gs                  シートの読み書き（行⇔データ変換、版番号）
│   ├─ Sync.gs                同期処理（排他ロック付き）
│   ├─ NextDay.gs             21:50 翌日 To Do 作成
│   ├─ Calendar.gs            カレンダー登録・更新、23:30 寝る準備の予定
│   ├─ Gmail.gs               確認候補の抽出・日付検出・「手帳済」ラベル
│   ├─ Night.gs               23:00 未完了【min】の確認
│   └─ Setup.gs               初回セットアップ（シート作成・キー発行・トリガー登録）
├─ tests/                     import / sleep / carryover / stats / scheduler / study / rules / sync
├─ docs/
│   ├─ DESIGN.md
│   ├─ SETUP_GAS.md           スプレッドシートと GAS の設定（初心者向け・画面ごと）
│   ├─ SETUP_PAGES.md         GitHub Pages 公開とホーム画面追加
│   └─ SETUP_ALARM.md         iPhone ショートカット / .ics でアラーム
├─ package.json               `npm test` だけ（依存なし）
└─ .github/workflows/         test.yml（自動テスト）, pages.yml（公開）
```

---

## 2. データ構造

### 2.1 アプリ内・JSON の形（今の形を引き継ぐ）

```jsonc
{
  "days": {
    "2026-11-22": {
      "tasks": [{ "id", "title", "done", "doneAt", "priority", "est", "actualMin",
                  "sessions": [{ "start", "end", "min" }],
                  "runningSince", "deadline", "start", "carryCount", "carriedFrom" }],
      "sleep": { "bed", "wake", "min" },
      "naps": [{ "start", "end", "min" }],
      "note", "closed", "planned", "done", "rate", "review"
    }
  },
  "hourensou": { "<id>": { "to", "what", "kind", "due", "done" } },
  "settings": {...}, "fixedEvents": [...], "templates": [...],
  "study": {...}, "rules": [...], "inbox": [...]
}
```
- タスクに任意で追加する項目（無くても動く）: `tag`（min/A、タイトルから自動判定）, `templateId`, `source`（plan/calendar/gmail）, `calendarEventId`, `updatedAt`。
- **読み込みで受け付ける形**: ①上の形 ②今のチャットのキー形式 `{"days/2026-11-22": {...}, "hourensou/abc": {...}}` ③一部分だけ。読み込み前に件数をプレビューし、「マージ」か「置き換え」を選ぶ。読み込んだデータは同期でスプレッドシートにも入る。
- 日時は `+09:00` 付き ISO 文字列、予定開始などは `"HH:MM"`。
- 夜の睡眠は**起床した日**、昼寝は**開始した日**。「寝る」の時点では「睡眠中」として一時保存し、「起きた」で起床日に確定。

### 2.2 スプレッドシート「手帳DB」のシート

人が見ても分かるよう、1 件 1 行で保存します（JSON 列は配列などの細かい部分だけ）。

| シート | 1行 = | 主な列 |
|---|---|---|
| `days` | 1日 | date, bed, wake, sleepMin, naps(JSON), note, closed, planned, done, rate, review |
| `tasks` | 1タスク | id, date, title, done, doneAt, priority, est, actualMin, sessions(JSON), runningSince, deadline, start, carryCount, carriedFrom, tag, templateId, source, calendarEventId |
| `hourensou` | 1件 | id, to, what, kind, due, done |
| `config` | 1設定 | key（settings / fixedEvents / templates / study / rules / state）, value(JSON) |
| `inbox` | 1メール | id, from, subject, date, snippet, dateCandidates(JSON), status（new/task/ignored）, link |
| `学習計画` | 1行 | date, subject, content, est（形式は要確認。別のスプレッドシートでも可） |

全シート共通の管理列: `rev`（版番号）, `updatedAt`, `deviceId`, `deleted`（削除は印だけ付ける）。

### 2.3 同期のしくみ（sync.js ⇔ Sync.gs）

1. アプリでの変更はすべて、まず IndexedDB に保存し、「未送信キュー」に積む（オフラインでもここまでは動く）。
2. 送るタイミング: 変更の2秒後、アプリを開いたとき、オンラインに戻ったとき、開いている間は5分ごと。
3. 送信 `POST {action:"sync", since:<前回受け取った版>, changes:[...]}`。
   GAS は排他ロック（LockService）を取り、各行に新しい `rev` を付けて保存し、`since` 以降の変更を返す。
4. **競合**: 1件（1日・1タスク・1報連相・1設定）ごとに `updatedAt` が新しい方を採用する。スマホと PC で同じタスクを同時に編集した場合だけ後勝ちになる。
5. **二重作成を防ぐ ID**: 繰越・毎日のタスク・翌日 To Do は**決まった規則で ID を作る**（例: 繰越 `元ID>2026-11-23`、毎日のタスク `tpl:fp2:2026-11-23`）。スマホと PC の両方で繰越が走っても同じ行になり、重複しない。
6. 画面に「未送信 N 件／最終同期 21:05」を表示。失敗したら自動で再試行。

### 2.4 本人確認（自分以外が読み書きできないようにする）

- スプレッドシート自体は共有しない（自分だけ）。GAS は「自分として実行」。
- GAS Web アプリは、ブラウザアプリから呼ぶために公開範囲を「全員」にする必要がある（「自分のみ」にすると、Safari などで Google のログイン状態を渡せずアプリから呼べない）。
- そこで **合言葉（キー）で本人確認** する:
  - 初回セットアップで GAS が 256 ビットの乱数キーを発行し、スクリプトのプロパティ（自分しか見られない場所）に保存。
  - アプリの設定画面に URL とキーを貼る（PC で表示した QR コードをスマホで読む方法も用意）。キーは端末内にだけ保存し、GitHub には置かない。
  - キーが違うリクエストには何も返さない。失敗が続いたら一時的に拒否。
  - 端末をなくしたときは、GAS でキーを作り直せば古いキーは使えなくなる。
- より強くしたい場合のオプション: Google ログイン（無料の OAuth クライアント ID）で「自分のメールアドレスか」を GAS で確認する。ただし iPhone のホーム画面アプリではログイン画面の挙動が不安定なため、初期は合言葉方式を提案します。

---

## 3. 設定（config/defaults.json）

```jsonc
{
  "settings": {
    "wakeTarget": { "from": "05:00", "to": "07:00" }, "bedTarget": "24:00",
    "availableMin": 600,            // 要確認
    "focusPeriod": "afternoon",
    "dayStartsAt": "04:00",         // 日付の切り替え時刻（要確認）
    "bufferRatio": 0.25, "defaultEstFactor": 1.3,
    "sleepAlarm": "06:00", "napAlarmMin": 20,
    "minCheckTime": "23:00", "bedPrepTime": "23:30", "timerWarnMin": 120,
    "meals": [ { "label": "昼食", "start": "12:00", "min": 60 },
               { "label": "夕食", "start": "19:00", "min": 60 } ],
    "breakEveryMin": 90, "breakMin": 10, "travelMinAroundFixed": 30
  },
  "fixedEvents": [
    { "weekday": 1, "start": "10:30", "end": "12:00", "title": "英語スピーキング" },
    { "weekday": 2, "start": "14:45", "end": "16:15", "title": "ゼミ" }
  ],
  "templates": [
    { "id": "nikkei", "title": "日経4ニュース【A】",     "est": 20, "priority": 2 },
    { "id": "eng",    "title": "英語学習1講座【min】",   "est": 30, "priority": 1 },
    { "id": "s4002",  "title": "4002 半stage【min】",    "est": 30, "priority": 1, "study": "4002" },
    { "id": "gpt",    "title": "ChatGPT英会話【A】",     "est": 20, "priority": 3 },
    { "id": "fp2",    "title": "FP2級 1section【min】",  "est": 45, "priority": 1, "study": "fp2" }
  ],
  "study": {
    "examDate": "2027-01-24", "reviewDaysBeforeExam": 0,
    "4002": { "totalStages": null, "current": { "stage": 1, "half": "前半" } },
    "fp2":  { "chapters": [], "current": { "chapter": 1, "sec": 1 }, "chapterTestMin": 75 }
  }
}
```
すべて設定画面から変更でき、変更は同期でスプレッドシートにも反映されます。

---

## 4. 機能ごとの設計

### 4.1 睡眠ボタン
- 「寝る」「起きた」「昼寝する」「昼寝から起きた」。状態に応じて押せるボタンだけ有効。
- 睡眠時間は 終了−開始（日付またぎ対応）。時刻の修正も可。
- 「寝る」「昼寝する」を押したとき、計測中のタスクがあれば「止めますか？（今止める／そのまま）」と確認。

### 4.2 通知とアラーム（PWA の制約への対応）
PWA は**アプリを閉じている間、指定時刻に確実に通知を鳴らせない**（iPhone は有料のプッシュサーバーが必要、Android も時刻指定通知は未対応）。そのため次のように分けます。

| 用途 | 方法 |
|---|---|
| 起床 6:00 / 昼寝 20 分後 | **iPhone**: ボタンを押すとショートカット「手帳アラーム」が起動し、端末の時計アプリにアラームを作成。**Android/PC**: アラーム付き .ics を開いてカレンダーに追加 |
| 23:00 【min】未完了の一覧 | GAS が 23:00 にスプレッドシートを確認し、未完了があれば**一覧をメールで自分に送る**（Gmail アプリの通知で届く）。アプリを開けば画面上部にも表示 |
| 23:30 寝る準備 | GAS が Google カレンダーに毎日の「寝る準備」予定（通知付き）を登録 → カレンダーの通知で確実に鳴る |
| タイマー 2 時間超 | アプリを開いている間は通知＋確認。閉じていた場合は次に開いたとき確認（「2時間で止める／実際の時刻で止める／続ける」） |

### 4.3 タスクと計測
- 追加・編集・削除・完了。【min】【A】はタイトルから自動判定。
- 開始で `runningSince`、停止で `sessions` に追加して `actualMin` を合計。同時に動くのは 1 つだけ。
- `runningSince` は同期されるので、スマホで開始して PC で止めることもできる。

### 4.4 繰越（carryover.js）
アプリを開いたとき（論理日付が変わっていれば）:
1. 今日より前で `closed=false` の日を全部探す。
2. 未完了タスクを今日へコピー（ID は規則で作成、`carryCount+1`、`carriedFrom=元の日付`、計測はリセット）。
3. その日の `planned / done / rate` を確定して `closed=true`。
4. 今日の毎日のタスクを追加（4002/FP は学習の進み具合から具体的な名前に）。繰越分と重複させない。
- 日付の切り替えは**論理日付**（既定 4:00）。0時過ぎの作業は前日扱い。
- 21:50 の GAS が先に翌日のタスクを作っていても、ID が同じなので重複しない。

### 4.5 学習の自動進行（study.js）
- 4002: 「4002 stage5 前半【min】」完了 → 翌日は「stage5 後半」→ その次は「stage6 前半」。
- FP2級: 「FP2級 第2章 Sec3【min】」完了 → 翌日は Sec4。章の全 Sec が終わった翌日は「FP2級 第2章 章末問題【min】（見積75分）」、その次から次の章。
- 1 日に複数こなしたら、その分進む。進み具合は `config` シートの `study` に保存（GAS もこれを見て翌日分を作る）。
- **遅れ警告**: 残りの単位数 ÷ 試験日までに使える日数 ＞ 1（1日1単位のペース）なら「遅れ: あと N 単位、1日あたり X 必要」と今日画面と学習画面に表示。

### 4.6 タイムライン自動作成（scheduler.js）
1. 起床（または今）〜就寝目標から、固定予定＋前後の移動枠・食事枠を除いた**空き区間**を作る。
2. 空き時間 × 75% までしか置かない（残りはバッファ）。
3. 置く長さ = 見積 × 倍率（そのタスクの過去の実績倍率 → 全体の実績倍率 → 1.3 の順で採用）。
4. 締切が近い → 優先度が高い → 繰越が多い の順。
5. 重いタスク（45 分以上）は午後の区間を優先、軽いもの（20 分以下）は短い隙間を優先。
6. 90 分ごとに 10 分の休憩を入れる。
7. 入らなかったものは「**後ろ倒し候補**」として理由付きで一覧（明日へ／週末へ／削る）。
8. 決めた時刻は `start` に入り、「カレンダーに登録」で Google カレンダーへ（同じ予定は更新、Asia/Tokyo）。

### 4.7 今日の進捗（夜）
睡眠時間、昼寝の回数と合計、完了率、【min】達成数、見積と実績の倍率、予定開始との平均ずれ ＋ ルールによる課題と改善策。振り返りの一言を `review` に保存。

### 4.8 週の振り返り（日曜。いつでも開ける）
平均睡眠時間、就寝時刻の標準偏差（24時またぎに対応）、完了率の推移グラフ（7日）、翌週に変えること 1 つ（重要度が最も高い改善策）。

### 4.9 報連相・日次ログ・確認候補
- 報連相: 期限が近い順（期限切れは赤で最上部）。今日の画面にも期限 3 日以内を表示。
- 日次ログ表: 日付・就寝・起床・睡眠・昼寝・予定数・完了数・メモ。CSV 書き出しも可。
- 確認候補（Gmail）: 件名・差出人・本文の抜粋・締切候補の日付。「タスクにする（締切を選ぶ）」「報連相にする」「無視」を選ぶ。

---

## 5. 改善策ルール（config/rules.json ＋ アプリ内で編集）

```jsonc
[
  { "id": "nap_long", "severity": 2,
    "when": { "metric": "napTotalMin", "op": ">", "value": 60 },
    "issue": "昼寝が合計{napTotalMin}分", "advice": "昼寝は20分アラームで1回まで" },
  { "id": "late_bed", "severity": 3,
    "when": { "metric": "bedLateMin", "op": ">=", "value": 60, "streak": 2 },
    "issue": "就寝が目標より60分以上遅い日が{streak}日続いている", "advice": "23:30に寝る準備" },
  { "id": "late_wake", "severity": 2,
    "when": { "all": [ { "metric": "wakeHour", "op": ">=", "value": 7 },
                       { "metric": "morningTasksUntouched", "op": ">", "value": 0 } ] },
    "issue": "起床が7時以降で朝のタスクが未着手", "advice": "朝タスクを午後へ移す" },
  { "id": "carry3", "scope": "task", "severity": 2,
    "when": { "metric": "carryCount", "op": ">=", "value": 3 },
    "issue": "「{title}」が{carryCount}回繰越", "advice": "やる／削る／週末に回すを決める" },
  { "id": "ratio_over", "scope": "task", "severity": 1,
    "when": { "metric": "actualRatio", "op": ">", "value": 1.3 },
    "issue": "「{title}」の実績が見積の{actualRatio}倍", "advice": "次回の見積もりを自動で増やします",
    "action": { "type": "raiseEstimate" } }
]
```
- 条件は `metric / op / value`、`all`/`any`、`streak`（連続日数）の組み合わせ。
- 設定画面で追加・編集でき、使える指標の一覧も表示。新しい指標は `metrics.js` に関数を 1 つ足すだけ。
- ルールは `config` シートに保存されるので、スマホと PC で共通。

**分析の差し替え口（analysis/index.js）**
```js
// 分析器はすべてこの形。async なので将来 AI 分析も同じ形で追加できる
{ id: "rules", analyze: async (ctx) => ({ metrics, findings: [{ severity, issue, advice, action }] }) }
```

---

## 6. Google 連携（GAS）

| 処理 | 実行タイミング | 内容 |
|---|---|---|
| 翌日 To Do | 毎晩 **21:50** | 学習計画シートの翌日行＋Googleカレンダーの翌日予定（アプリが登録したものは除く）から翌日のタスクを作り、`tasks` シートに追加。ID は規則で作るので何度実行しても重複しない |
| カレンダー登録 | アプリの「カレンダーに登録」 | タスクの時刻で予定を作成・更新（`calendarEventId` で同じ予定を更新）、Asia/Tokyo |
| Gmail 確認候補 | 30 分ごと | 条件に合う未読メールを `inbox` シートへ追加し、「手帳済」ラベルを付ける（以後は出ない）。アプリは同期で受け取って表示 |
| 23:00 確認 | 毎晩 23:00 | 今日の未完了【min】があれば一覧を自分宛てにメール |
| 23:30 寝る準備 | 初回セットアップで登録 | 毎日繰り返しのカレンダー予定（通知付き） |

- GAS の時刻指定は「21 時台のどこか」になるため、**ちょうど 21:50 / 23:00 に動かす仕組み**（実行のたびに次回の 1 回だけのトリガーを作り直す）を入れる。
- Gmail の検索条件（設定で変更可）:
  ```
  is:unread -label:手帳済 (from:mizuho-fg@mail.axol.jp OR subject:(締切 OR 提出 OR 期限 OR 日程 OR ご確認))
  ```
- 本文の日付検出: `2026/12/3`、`2026年12月3日`、`12月3日`、`12/3(水)`、`明日`・`明後日`。年が無いものは今日以降で一番近い日付と解釈。見つかった日付はすべて締切候補として出す。

---

## 7. 公開（GitHub Pages）
- `main` に入ると自動で公開。URL は `https://harukashibasaki28-hash.github.io/-/`（リポジトリ名が `-` のため）。
- 無料の GitHub Pages はリポジトリを**公開（public）**にする必要がある。公開されるのはプログラムだけで、手帳のデータ・GAS の URL・キーはリポジトリに入らない。

---

## 8. テスト（node --test）
- **繰越**: 複数日の未完了、closed の確定、carryCount、二重繰越防止（2 台で実行しても同じ ID）、毎日のタスクとの重複除外、4:00 の日付境界
- **睡眠**: 日付またぎ、起床日に記録、昼寝は開始日、昼寝の回数・合計
- **完了率**: 0 件、全完了、繰越分の数え方
- 平均ずれ・就寝時刻の標準偏差、タイムライン、学習進行・章末問題・遅れ警告、ルール（streak 含む）、インポート（3 形式・欠損補完・不正 JSON）、同期（オフライン中の変更、競合時の後勝ち）

---

## 9. 実装の順番
1. データの形＋**JSON インポート/エクスポート**＋テスト（最初）
2. IndexedDB の控えと今日画面（睡眠ボタン・タスク・計測・繰越）＋テスト
3. GAS（シート・同期・本人確認）＋同期エンジン＋**設定手順書**
4. 学習の自動進行
5. タイムライン・カレンダー登録
6. 分析（ルール）・今日の進捗・週の振り返り・ログ表・報連相
7. 通知・.ics・ショートカット、21:50 / Gmail / 23:00 の GAS 処理
8. PWA 化・GitHub Pages 公開と手順書
