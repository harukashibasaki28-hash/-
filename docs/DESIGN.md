# 手帳アプリ 設計書（ドラフト v0.1）

> 状態: **確認待ち**。この設計で良いか確認を取ってから実装に入ります。

## 0. 方針

| 項目 | 決定 |
|---|---|
| 形態 | PWA（スマホのホーム画面に追加／PCブラウザ） |
| 技術 | **ビルド不要の素の JavaScript（ES Modules）+ HTML + CSS**。npm パッケージは使わない（GitHub Pages にそのまま置ける・壊れにくい） |
| 保存 | IndexedDB（端末内）。JSON で書き出し／読み込み |
| グラフ | 自前の SVG 描画（ライブラリなし） |
| テスト | Node.js 標準のテストランナー（`node --test`）。追加インストール不要 |
| 外部連携 | Google Apps Script（GAS）のみ。有料 API・独自サーバーなし |
| 公開 | GitHub Pages（GitHub Actions で自動デプロイ＋テスト） |

計算ロジック（睡眠・繰越・完了率・タイムライン・分析）は **画面から切り離した純粋関数** にして、Node でもブラウザでも同じコードをテストできるようにします。

---

## 1. ファイル構成

```
/
├─ index.html                 アプリ本体（1ページ。画面はタブ切り替え）
├─ manifest.webmanifest       PWA 設定（名前・アイコン・standalone 表示）
├─ sw.js                      Service Worker（オフライン起動用キャッシュ）
├─ icons/                     ホーム画面アイコン
├─ config/
│   ├─ defaults.json          初期設定（起床/就寝目標・固定予定・毎日のタスク・食事枠など）
│   └─ rules.json             改善策ルール（後から追加・編集できる）
├─ src/
│   ├─ app.js                 起動処理（DB を開く→繰越→画面表示→バックアップ）
│   ├─ db.js                  IndexedDB の薄いラッパー
│   ├─ model/
│   │   ├─ schema.js          データ型・初期値・正規化（欠けた項目を補う）
│   │   ├─ importExport.js    JSON 読み込み・書き出し・形式チェック ★最初に作る
│   │   └─ dates.js           日付計算（Asia/Tokyo 固定、「論理日付」）
│   ├─ core/
│   │   ├─ sleep.js           寝る/起きた/昼寝の記録と睡眠時間計算
│   │   ├─ tasks.js           タスク追加・編集・完了、テンプレート展開
│   │   ├─ timer.js           開始/停止・実績時間・止め忘れ検知
│   │   ├─ carryover.js       繰越と closed 処理
│   │   ├─ scheduler.js       タイムライン自動作成
│   │   ├─ estimates.js       実績倍率の計算と見積もり補正
│   │   ├─ stats.js           完了率・【min】達成数・平均ずれ・週集計・標準偏差
│   │   └─ study.js           4002 / FP2級 の進捗と次回分の自動生成・遅れ警告
│   ├─ analysis/
│   │   ├─ index.js           分析器の登録口（差し替え可能なインターフェース）
│   │   ├─ metrics.js         ルールが参照する指標を計算
│   │   └─ ruleEngine.js      rules.json を評価して「課題・改善策」を出す
│   ├─ notify/
│   │   ├─ notifier.js        アプリを開いている間の通知（Notification API）
│   │   ├─ ics.js             アラーム付き .ics ファイル生成
│   │   └─ shortcuts.js       iPhone ショートカット呼び出し URL 生成
│   ├─ sync/
│   │   ├─ gasClient.js       GAS Web アプリとの通信
│   │   └─ backup.js          Google ドライブへの日次バックアップ
│   └─ ui/
│       ├─ today.js           今日（睡眠ボタン・タスク・タイマー・確認候補）
│       ├─ timeline.js        タイムライン・後ろ倒し候補
│       ├─ review.js          今日の進捗（夜）
│       ├─ weekly.js          週の振り返り（グラフ）
│       ├─ hourensou.js       報連相リスト
│       ├─ log.js             日次ログ表
│       ├─ study.js           学習の進み具合
│       ├─ settings.js        設定・ルール編集・インポート/エクスポート・GAS 接続
│       ├─ chart.js           SVG 折れ線/棒グラフ
│       └─ styles.css
├─ gas/                       Google Apps Script（コピーして貼り付ける用）
│   ├─ appsscript.json        timeZone: "Asia/Tokyo"
│   ├─ Main.gs                Web アプリ入口（doGet / doPost）、トークン認証
│   ├─ NextDay.gs             21:50 実行：スプレッドシート＋カレンダー → 翌日 To Do
│   ├─ Calendar.gs            タスク時刻をカレンダーに登録・更新
│   ├─ Gmail.gs               確認候補の抽出・日付検出・「手帳済」ラベル
│   ├─ Backup.gs              JSON をドライブに保存（世代管理）
│   └─ Setup.gs               トリガー作成・ラベル作成を一発で行う関数
├─ tests/
│   ├─ import.test.js
│   ├─ sleep.test.js
│   ├─ carryover.test.js
│   ├─ stats.test.js          完了率・平均ずれ・標準偏差
│   ├─ scheduler.test.js
│   ├─ study.test.js
│   └─ rules.test.js
├─ docs/
│   ├─ DESIGN.md              この文書
│   ├─ SETUP_GAS.md           GAS 設定手順（初心者向け・画面ごと）
│   ├─ SETUP_PAGES.md         GitHub Pages 公開とホーム画面追加の手順
│   └─ SETUP_ALARM.md         iPhone ショートカット / .ics でアラームを鳴らす手順
├─ package.json               `npm test` で node --test を呼ぶだけ（依存なし）
└─ .github/workflows/
    ├─ test.yml               push ごとに自動テスト
    └─ pages.yml              GitHub Pages へデプロイ
```

---

## 2. データ構造

今の形をそのまま引き継ぎ、**足りない項目は読み込み時に既定値で補う**（壊さない）。

### 2.1 書き出し JSON（＝バックアップ形式）

```jsonc
{
  "format": "techo",
  "version": 1,
  "exportedAt": "2026-11-22T21:50:00+09:00",
  "days": {
    "2026-11-22": {
      "tasks": [{
        "id": "t_xxx", "title": "FP2級 1section【min】", "done": false, "doneAt": null,
        "priority": 2, "est": 45, "actualMin": 0,
        "sessions": [{ "start": "...", "end": "...", "min": 30 }],
        "runningSince": null, "deadline": null, "start": "14:00",
        "carryCount": 0, "carriedFrom": null,
        // ↓追加（任意・無くても動く）
        "tag": "min",            // "min" | "A" | null  （タイトルの【min】【A】から自動判定）
        "templateId": "fp2",     // 毎日のタスク由来なら元テンプレート
        "weight": "heavy",       // heavy | light（未指定なら est で自動判定）
        "calendarEventId": null  // Google カレンダー連携用
      }],
      "sleep": { "bed": "...", "wake": "...", "min": 420 },
      "naps": [{ "start": "...", "end": "...", "min": 20 }],
      "note": "", "closed": false,
      "planned": 5, "done": 3, "rate": 0.6, "review": "..."
    }
  },
  "hourensou": {
    "h_xxx": { "to": "...", "what": "...", "kind": "報告", "due": "2026-11-25", "done": false }
  },
  "settings": { ... },       // 3章
  "fixedEvents": [ ... ],
  "templates": [ ... ],
  "study": { ... },          // 6章
  "rules": [ ... ],          // 5章（書き出しに含める＝端末移行しても残る）
  "inbox": [ ... ]           // Gmail 確認候補
}
```

**読み込みで受け付ける形**（どれでも可）
1. 上の形式そのもの
2. Claude チャットで使っているキー形式 `{"days/2026-11-22": {...}, "hourensou/abc": {...}}`
3. `days` / `hourensou` だけの部分 JSON

読み込み時は「上書き」か「マージ（日付ごとに新しい方・タスクは id で統合）」を選べる。事前にプレビュー（何日分・何件）を表示。

### 2.2 時刻の表し方
- 日時は ISO 8601 文字列 `+09:00` 付き（例 `2026-11-22T23:41:00+09:00`）。
- `start`（予定開始）・固定予定は `"HH:MM"`。
- タイムゾーンは常に Asia/Tokyo として計算（端末の設定に依存しない）。

### 2.3 記録先の日付
- 夜の睡眠：**起床した日** の `sleep`。`bed` は前日夜の時刻でも起床日に記録。
- 昼寝：**開始した日** の `naps`。
- 「寝る」を押した時点では `meta.pendingSleep = {bed}` に一時保存し、「起きた」で起床日に確定。

### 2.4 IndexedDB のストア
| ストア | キー | 内容 |
|---|---|---|
| `days` | `YYYY-MM-DD` | 1日分 |
| `hourensou` | id | 報連相 |
| `kv` | 名前 | settings / fixedEvents / templates / study / rules / inbox / meta（最終起動日・実行中の睡眠・最終バックアップ等） |

---

## 3. 設定（config/defaults.json の初期値）

```jsonc
{
  "settings": {
    "wakeTarget": { "from": "05:00", "to": "07:00" },
    "bedTarget": "24:00",
    "availableMin": 600,              // 1日に使える時間（要確認）
    "focusPeriod": "afternoon",       // 集中しやすい時間帯
    "dayStartsAt": "04:00",           // 論理日付の切り替え時刻（要確認）
    "bufferRatio": 0.25,              // 空き時間の 25% はバッファ
    "defaultEstFactor": 1.3,
    "sleepAlarm": "06:00", "napAlarmMin": 20,
    "bedPrepTime": "23:30", "minCheckTime": "23:00",
    "timerWarnMin": 120,
    "meals": [ { "label": "昼食", "start": "12:00", "min": 60 }, { "label": "夕食", "start": "19:00", "min": 60 } ],
    "breakEveryMin": 90, "breakMin": 10,
    "travelMinAroundFixed": 30,
    "gas": { "url": "", "token": "" } // 端末内のみ。リポジトリには入れない
  },
  "fixedEvents": [
    { "weekday": 1, "start": "10:30", "end": "12:00", "title": "英語スピーキング" },
    { "weekday": 2, "start": "14:45", "end": "16:15", "title": "ゼミ" }
  ],
  "templates": [
    { "id": "nikkei", "title": "日経4ニュース【A】", "est": 20, "priority": 2 },
    { "id": "eng",    "title": "英語学習1講座【min】", "est": 30, "priority": 1 },
    { "id": "s4002",  "title": "4002 半stage【min】", "est": 30, "priority": 1, "study": "4002" },
    { "id": "gpt",    "title": "ChatGPT英会話【A】", "est": 20, "priority": 3 },
    { "id": "fp2",    "title": "FP2級 1section【min】", "est": 45, "priority": 1, "study": "fp2" }
  ]
}
```
すべて「設定」画面から変更可能。

---

## 4. 機能ごとの設計

### 4.1 睡眠ボタン
- 4 つの大きなボタン。状態に応じて押せるものだけ有効（寝ている間は「起きた」だけ等）。
- `min` は 終了−開始 を分で計算（日付またぎ対応）。
- 押し間違い用に「時刻を修正」ボタン。
- **止め忘れ確認**：「寝る」「昼寝する」を押したとき動いているタイマーがあれば「止めますか？（今止める／寝た時刻で止める／そのまま）」。

### 4.2 通知とアラーム（重要：PWA の制約）
PWA は **アプリを閉じていると、指定時刻に通知を確実に鳴らせません**（iPhone はサーバーからのプッシュが必要、Android も時刻指定通知は未対応）。そこで三段構え：

| 用途 | 方法 |
|---|---|
| アプリを開いている間 | ブラウザ通知＋画面表示（タイマー2時間超など） |
| 起床 6:00 / 昼寝 20分 | **iPhone ショートカット**：ボタンを押すと `shortcuts://run-shortcut?name=手帳アラーム&input=06:00` を開き、端末のアラームを作成。設定手順は SETUP_ALARM.md |
| 同上（Android/PC） | アラーム付き **.ics** をダウンロード→カレンダーに追加 |
| 23:30 寝る準備・23:00 【min】確認 | GAS で **Google カレンダーに毎日の予定（通知付き）** を登録 → スマホのカレンダー通知で確実に鳴る。アプリを開けば 23:00 以降は未完了【min】一覧を最上部に表示 |

### 4.3 タスクとタイマー
- 追加・編集・削除・完了。【min】【A】はタイトルから自動判定。
- 開始で `runningSince` をセット、停止で `sessions` に追加し `actualMin` を合計。同時に動くタイマーは 1 つ（別を開始すると前のは自動停止）。
- アプリ再起動しても `runningSince` から経過を復元。2時間超で確認ダイアログ。

### 4.4 繰越（carryover.js）
アプリを開いたとき／画面に戻ったとき（日付が変わっていれば）：
1. 今日より前で `closed=false` の日を全部探す。
2. 未完了タスクを今日へ**コピー**（新 id、`carryCount+1`、`carriedFrom=元の日付`、タイマー・sessions はリセット）。
3. 同じタスクの二重コピーを防ぐ（元タスクに `carriedTo` を記録）。
4. その日の `planned / done / rate` を確定して `closed=true`。
5. 今日のテンプレートタスク（毎日の5つ）を追加。テンプレート由来で繰越されたものとは重複させない。
- 「日付が変わった」の判定は **論理日付**（既定 4:00 切り替え）。0時過ぎに作業中でも前日扱い。

### 4.5 タイムライン自動作成（scheduler.js）
入力：今日のタスク・固定予定・食事・起床時刻・就寝目標・設定。
1. 起床（または現在時刻）〜就寝目標の間から、固定予定＋前後の移動枠・食事枠を除いた**空き区間**を作る。
2. 空き時間合計 × 0.75 = 配置できる上限。残り 25% はバッファ。
3. 配置する長さ = est × 倍率（そのタスク（テンプレート）の過去実績倍率 → 無ければ全体の実績倍率 → 無ければ 1.3）。
4. 並び順：締切が近い → 優先度高 → 繰越回数多。
5. 重いタスク（配置長 ≥ 45 分 or weight=heavy）は午後の区間を優先、軽いもの（≤ 20分）は短い隙間を優先。
6. 90 分ごとに 10 分休憩を挿入。
7. 入らなかったものは「**後ろ倒し候補**」として理由付きで一覧表示（明日へ／週末へ／削るボタン）。
8. 結果はタスクの `start` に反映。手動でドラッグ・時刻変更も可。「カレンダーに送る」で GAS 経由で Google カレンダーへ。

### 4.6 今日の進捗（夜に表示）
- 睡眠時間、昼寝回数と合計、完了率、【min】達成数 / 総数、見積と実績の倍率、予定開始との平均ずれ（実際の初回開始 − `start` の平均）。
- 課題と改善策は 5 章のルールエンジンで生成。
- 「ひとこと振り返り」を `review` に保存。

### 4.7 週の振り返り（日曜に表示・いつでも開ける）
- 平均睡眠時間、就寝時刻の標準偏差（24時またぎは「18時起点の分」に変換して計算）、完了率の推移（7日の折れ線）、睡眠時間（棒）。
- 「翌週に変えること」はルールの重要度が最も高いもの1つを表示。

### 4.8 報連相リスト
- 期限が近い順（期限切れは赤で最上部）、完了は下に折りたたみ。今日画面にも期限3日以内を表示。

### 4.9 日次ログ表
- 日付・就寝・起床・睡眠・昼寝・予定数・完了数・メモ。期間切り替え、CSV 書き出し。

---

## 5. 改善策ルール（config/rules.json ＋ アプリ内で編集）

```jsonc
[
  { "id": "nap_long", "scope": "day", "severity": 2,
    "when": { "metric": "napTotalMin", "op": ">", "value": 60 },
    "issue": "昼寝が{napTotalMin}分", "advice": "昼寝は20分アラームで1回まで" },
  { "id": "late_bed", "scope": "day", "severity": 3,
    "when": { "metric": "bedLateMin", "op": ">=", "value": 60, "streak": 2 },
    "issue": "就寝が目標より60分以上遅い日が{streak}日続いている", "advice": "23:30に寝る準備" },
  { "id": "late_wake_morning", "scope": "day", "severity": 2,
    "when": { "all": [ { "metric": "wakeHour", "op": ">=", "value": 7 },
                       { "metric": "morningTasksUntouched", "op": ">", "value": 0 } ] },
    "issue": "起床が7時以降で朝のタスクが未着手", "advice": "朝タスクを午後へ移す" },
  { "id": "carry3", "scope": "task", "severity": 2,
    "when": { "metric": "carryCount", "op": ">=", "value": 3 },
    "issue": "「{title}」が{carryCount}回繰越", "advice": "やる／削る／週末に回すを決める" },
  { "id": "ratio_over", "scope": "task", "severity": 1,
    "when": { "metric": "actualRatio", "op": ">", "value": 1.3 },
    "issue": "「{title}」の実績が見積の{actualRatio}倍", "advice": "次回の見積もりを自動で増やします",
    "action": { "type": "raiseEstimate", "useRatio": true } }
]
```
- `when` は `metric / op / value`、`all` / `any`、`streak`（連続日数）を組み合わせ。
- 使える指標名の一覧を設定画面に表示。新しい指標を足すときは `metrics.js` に1関数追加するだけ。
- `action` は今のところ `raiseEstimate`（テンプレートの est を更新）のみ。

### 分析部分の差し替え口（analysis/index.js）
```js
// 分析器はすべてこの形。async にしておくので将来 AI（外部 API）も入れられる
{ id: "rules", analyze: async (ctx) => ({ metrics, findings: [{severity, issue, advice, action?}] }) }
```
`ctx` = { 対象日, 直近の days, settings, rules }。登録された分析器を順に呼び、結果をまとめて表示。将来は `{ id: "ai", analyze: ... }` を追加するだけ。

---

## 6. 学習の進み具合（study.js）

```jsonc
"study": {
  "examDate": "2027-01-24",
  "4002": { "totalStages": 0, "current": { "stage": 1, "half": "前半" }, "done": [] },
  "fp2":  { "chapters": [ { "no": 1, "secs": 0 } ], "current": { "chapter": 1, "sec": 1 },
            "chapterTestMin": 75, "done": [] }
}
```
- 【min】タスク「4002 半stage」完了 → `current` を次へ（前半→後半→次 stage 前半）。翌日のタスク名が「4002 stage5 後半【min】」のように具体化される。
- FP2級：Sec 完了 → 次の Sec。章の全 Sec が終わった翌日は「FP2級 第N章 章末問題【min】（見積75分）」を入れ、終わったら次章。
- **遅れ警告**：残り単位数 ÷ 試験日までの残り日数（試験前の復習期間を設定で確保）＝ 1日に必要な量。1日1単位を超えていたら「遅れ：あとN単位、1日あたりX必要」と表示。

---

## 7. Google 連携（GAS）

### 7.1 やり取りの方式（提案）
**GAS を「Web アプリ」として公開し、手帳アプリから直接呼ぶ**。
- 認証は長いランダムな「合言葉（トークン）」。アプリの設定画面に URL とトークンを貼るだけ。トークンは端末内だけに保存し、GitHub には置かない。
- POST は `Content-Type: text/plain` で送る（ブラウザの制約を避ける定番の方法）。
- 予備手段：通信できないときは、GAS がドライブに置いた JSON を手動で読み込む／アプリの JSON を手動でアップロード。

| 呼び出し | 内容 |
|---|---|
| `GET ?action=nextday` | 21:50 に作っておいた翌日 To Do（JSON）を受け取る → アプリが翌日のタスクに取り込み（重複は除外） |
| `GET ?action=inbox` | Gmail 確認候補を受け取る |
| `POST {action:"inboxAck", ids}` | アプリが受け取ったメールに「手帳済」ラベル（受け取りに失敗したメールは次回また出る） |
| `POST {action:"calendar", date, tasks}` | タスク時刻をカレンダーへ登録・更新（`calendarEventId` で更新、Asia/Tokyo） |
| `POST {action:"backup", data}` | ドライブの「手帳バックアップ」フォルダに `techo-YYYY-MM-DD.json` を保存（30日分保持） |

### 7.2 21:50 の自動実行（NextDay.gs）
- 時間主導トリガー（毎日 21〜22 時の枠。GAS は分単位の指定ができないため、**21:50 ちょうどにするには「毎日1回トリガー」を 21:50 に作り直す方式**を Setup.gs で実装）。
- 学習計画スプレッドシートの翌日行 ＋ Google カレンダーの翌日予定 ＋ 学習進捗（アプリが送った study）から翌日 To Do を作り、`nextday.json` としてドライブに保存。
- カレンダーで手帳アプリが作った予定は除外（二重取り込み防止）。

### 7.3 Gmail 確認候補（Gmail.gs）
検索条件（設定で変更可）：
```
is:unread -label:手帳済 newer_than:14d
  ( from:(@mizuho-fg.co.jp) OR subject:(締切 OR 提出 OR 期限 OR 日程 OR ご確認) )
```
- 本文から日付を抽出：`2026/12/3`、`12月3日`、`12/3(水)`、`明日`/`明後日` など → 締切候補として表示（複数あれば全部、年が省略されたら直近の未来の日付と解釈）。
- アプリでは「タスクにする（締切候補を選ぶ）」「報連相にする」「無視」を選択。

### 7.4 自動バックアップ
- ブラウザは閉じている間に動けないため、**その日アプリを最初に開いたとき＋夜の振り返り保存時** に自動でドライブへ送信。アプリを開かない日はデータも変わらないので、これで「毎日」を満たす。
- 復元：設定 →「ドライブから復元」で日付を選択、または JSON ファイルを読み込み。

---

## 8. 公開（GitHub Pages）
- `main` ブランチへのマージで自動デプロイ。URL は `https://harukashibasaki28-hash.github.io/-/`（リポジトリ名が `-` のため）。
- **無料の GitHub Pages はリポジトリが公開（public）である必要あり**。コードだけが公開され、手帳データ・GAS の URL・トークンはリポジトリに入らないので中身は漏れません。

---

## 9. テスト（node --test）
- 繰越：複数日の未完了、二重繰越防止、closed 確定、carryCount、テンプレート重複除外、論理日付 4:00 境界
- 睡眠：日付またぎ、起床日への記録、昼寝は開始日、昼寝の合計と回数
- 完了率：0件、全完了、繰越分を含むか
- 平均ずれ・就寝時刻の標準偏差（24時またぎ）
- タイムライン：75%上限、1.3倍、締切/優先度順、午後優先、後ろ倒し候補
- 学習：前半→後半→次stage、章末問題の挿入、遅れ警告
- ルール：各ルールの発火・streak
- インポート：3形式、欠損項目の補完、不正 JSON の拒否

---

## 10. 実装の順番
1. データ層＋**インポート/エクスポート**＋テスト（最初）
2. 今日画面：睡眠ボタン・タスク・タイマー・繰越
3. タイムライン
4. 分析（ルールエンジン）・今日の進捗・週の振り返り・ログ表・報連相
5. 通知・.ics・ショートカット
6. 学習進捗
7. GAS 一式＋初心者向け手順書
8. PWA 化・GitHub Pages 公開
