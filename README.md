# 保護猫カード（仮）

保護猫シェルターのスタッフさんやボランティアさんが、写真を選んで話すだけで、Instagramリール用の動画（無理なら画像。縦長 1080×1920）と投稿文を作れるスマホ用ツールです。
Built with Claude: Japan 2026 ハッカソンで制作中です。

## 今できること（11/2時点）
- シェルター情報、猫の情報を入力して、プレビュー、保存の画面まで進めます
- 投稿文のコピー

## これから
- iPhoneのブラウザで、カードから動画を作って保存できるかのテスト（無理なら画像にします）
- カード（AIを使わず、スマホの中で作ります）。シェルターのロゴ入り
- 話すだけ入力。AIで投稿文を整える＋入力にない話が混ざっていないかの確認
- 猫の名簿（スマホの中に保存）
- 譲渡会の案内と、参加する子の一括作成
- ハッシュタグは1投稿5つまで（プログラムで確認します）

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
