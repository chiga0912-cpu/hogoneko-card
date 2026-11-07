// 欄に見えている文字を、入力に入れる（11/7 作者が iPhone の Chrome で見つけた件）
// iPhone の日本語入力では、変換を確定する前にボタンを押すと、欄に見えている最後の文字の「入力の知らせ」が、
// ボタンの動きのあとに届く（または届かない）ことがある。そこで、ボタンを押したら
// 1) 入力中の欄から離れて変換を確定させ 2) 欄ごとに「入力の知らせ」をもう一度送る（欄の文字が入力と違うときだけ、ふだんの onChange が動く）
// 値を直接入れずに知らせを送るのは、React が覚えている「欄の前の値」もそろえるため（直接入れると、そのあと欄を直しても反映されないことがあった）
export function flushTyped(...boxes: (HTMLInputElement | HTMLTextAreaElement | null | undefined)[]): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  for (const b of boxes) b?.dispatchEvent(new Event('input', { bubbles: true }))
}
