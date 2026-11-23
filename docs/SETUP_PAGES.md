# GitHub Pages で公開して、スマホのホーム画面に置く

## 1. リポジトリを公開（public）にする

無料の GitHub Pages は公開リポジトリが必要です。公開されるのはプログラムだけで、手帳のデータ・GAS の URL・キー・Gmail の差出人・学習計画シートの ID は**リポジトリに入っていません**（すべてアプリの画面で入力し、端末と自分の Google ドライブにだけ保存されます）。

1. GitHub でこのリポジトリを開く →「Settings」
2. 一番下の「Danger Zone」→「Change repository visibility」→「Public」

（任意）リポジトリ名が `-` のため、URL は `https://harukashibasaki28-hash.github.io/-/` になります。分かりやすくしたい場合は「Settings」→「General」→「Repository name」を `techo` などに変えると `…github.io/techo/` になります。

## 2. Pages の設定

1. 「Settings」→ 左の「Pages」
2. 「Build and deployment」の **Source を「GitHub Actions」** にする

## 3. main ブランチに入れる

作業ブランチ `claude/schedule-sleep-app-c0xl2o` の内容を `main` に入れる（プルリクエストを作って「Merge」）と、自動でテストが走り、通れば公開されます。

- 「Actions」タブで「GitHub Pages に公開」が ✅ になれば完了
- 公開された URL は「Settings」→「Pages」の上部に表示されます

## 4. iPhone のホーム画面に追加

1. **Safari** で公開 URL を開く（Chrome ではなく Safari）
2. 下の共有ボタン（□↑）→ **「ホーム画面に追加」** →「追加」
3. ホーム画面の「手帳」アイコンから開くと、アプリのように全画面で使えます
4. 初回に「設定」→「通知を許可」を押しておくと、アプリを開いている間の通知（昼寝・止め忘れなど）が届きます

## パソコン

同じ URL をブラウザで開き、ブックマークしてください（Chrome ならアドレスバー右の「インストール」でアプリとして開くこともできます）。
