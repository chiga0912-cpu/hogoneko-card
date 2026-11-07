# むすび

保護猫シェルターのスタッフさんやボランティアさんが、写真を選んで、短く書くか貼るだけで、Instagramリール用の動画（無理なら画像。縦長 1080×1920）と投稿文を作れるスマホ用ツールです。
Built with Claude: Japan 2026 ハッカソンで制作中です。

## 今できること（11/4時点）
- 初めて開いたとき、ホーム画面に追加する案内（Safari・Chrome）
- シェルター登録（団体名だけ必須。ロゴ、ハッシュタグ、いつもの場所も）
- 新しい子の入力（手入力だけ）と、猫の名簿。データはスマホの中だけに保存します
- 名簿の子をもう一度紹介するとき、前の内容が入った状態で開きます
- 決まった形の投稿文のコピー（ハッシュタグは5つまで）

## これから
- カードと動画（AIを使わず、スマホの中で作ります）。保存画面
- メッセージを貼ると、Claudeが項目を読み取る。投稿文づくりと、入力にない話が混ざっていないかの確認
- 譲渡会の案内
- （ハッカソンのあと）譲渡会に参加する子の動画を、まとめて作る

## 動かし方
```
npm install
npm run dev
```

## ライセンス
- このリポジトリのプログラム（ソースコード）は MITライセンスです（LICENSE）。
- 次のものは MITライセンスの対象外です。
  - このツールの画像（イラスト、飾り（Midjourneyで作ったものを含む）、アイコン、スクリーンショットなど）：このツールを使ってカードや動画を作る場合を除き、複製、再配布、そのほかの利用はできません。
  - 「nekoto」の名前、キャラクター、ロゴ、このツールのロゴ：どのような場合も、複製、再配布、そのほかの利用はできません。シェルターが作るカードや動画にも入りません。
- シェルターがこのツールに登録したロゴや写真は、そのシェルターのものです。リポジトリには含まれず、そのスマホの中だけに保存されます。
- 猫の写真はこのリポジトリに含まれていません。

## License
- The source code in this repository is licensed under the MIT License (see LICENSE).
- The following are NOT covered by the MIT License.
  - Images of this tool (illustrations, decorations including those made with Midjourney, icons, screenshots, etc.): except for creating cards and videos with this tool, they may not be copied, redistributed, or otherwise used.
  - The "nekoto" name, character and logo, and the logo of this tool: they may not be copied, redistributed, or otherwise used in any case. They are not included in the cards or videos that shelters make.
- Logos and photos that a shelter registers in this tool belong to that shelter. They are not included in this repository and are stored only on that device.
- No cat photos are included in this repository.
