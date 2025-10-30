# LineLimitBlocker — 行数上限でブロック

行数が多すぎるファイル（デフォルトで1000行）を開いた際に自動でタブを閉じます。巨大ログやminify済みバンドルを誤って開いてエディタが固まるのを防ぎます。

## 設定項目
- `lineLimitBlocker.maxLines`: 最大許容行数（既定値: 1000）
- `lineLimitBlocker.languagesAllowlist`: 制限を無視する言語ID
- `lineLimitBlocker.pathAllowlist`: 制限を無視するパスパターン
- `lineLimitBlocker.showInfoMessage`: タブが閉じられた際の通知表示の有無

## コマンド
- **LineLimitBlocker: 次の1回だけ許可** — 次の1回のファイルオープンを許可します。

## 使い方
1. `npm install` を実行。
2. `npm run build` でビルド。
3. VS Codeで「F5」キーを押して拡張開発ホストを起動。
4. もしくは `npm run package` で `.vsix` を生成し、「拡張機能パネル → … → VSIXからインストール」で導入可能。

## 注意事項
- 行数ベースの判定です。バイトサイズでの上限は別実装になります（pre-openフックが無いため、同様に“開いた直後に閉じる”アプローチが必要）。
- Remote/WSL/コンテナでもタブAPIで閉じるため安定して動作します。