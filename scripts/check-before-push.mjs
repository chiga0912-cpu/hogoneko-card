// GitHubに上げる前に、APIキーや写真・動画が混ざっていないかを自動で確かめる
// 見るのは「これから上げるコミットに入っているファイル」（手元のフォルダ全体ではない）
//
// 使い方
//   node scripts/check-before-push.mjs            まだ上げていないコミットを確かめる（手で試すとき。npm run check-push）
//   node scripts/check-before-push.mjs --hash <ファイル>   確認済みの一覧に書く1行を出す
//   --git-hook <リモート名> <アドレス>             git の pre-push から呼ばれる（.githooks/pre-push）
//   --claude-hook                                  Claude Code が git push する前に呼ばれる（.claude/settings.json）
//
// これは「上げる前にファイルの一覧を見せて確認をもらう」決まりの代わりではなく、追加の確認
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join, basename, resolve, relative } from 'node:path'

const ALLOWLIST = 'scripts/push-allowlist.txt'
const ZERO = /^0+$/
const MAX_BYTES = 5 * 1024 * 1024

const git = (args, opts = {}) =>
  execFileSync('git', args, { maxBuffer: 1024 * 1024 * 1024, ...opts })
const gitText = (args) => git(args, { encoding: 'utf8' }).trim()

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// 確認済みの一覧：「sha256 パス  # メモ」。中身が1文字でも変わると通らない
function readAllowlist(top) {
  const file = join(top, ALLOWLIST)
  const set = new Set()
  if (!existsSync(file)) return set
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const [hash, path] = line.split(/\s+/)
    if (hash && path) set.add(`${hash.toLowerCase()} ${path}`)
  }
  return set
}

// 写真・動画の名前の終わり
const MEDIA_EXT =
  /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?|svg|ico|psd|raw|dng|mp4|m4v|mov|webm|avi|mkv|3gp|hevc)$/i

// 写真・動画の中身の始まり（名前を変えても見つける）
function mediaByContent(buf) {
  const b = buf
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG'
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'PNG'
  if (b.length >= 4 && b.toString('latin1', 0, 4) === 'GIF8') return 'GIF'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF') return b.toString('latin1', 8, 12) // WEBP / AVI
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') return `${b.toString('latin1', 8, 12)}（mp4・mov・HEICなど）`
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'WebM/MKV'
  if (b.length >= 4 && (b.toString('latin1', 0, 4) === 'II*\0' || b.toString('latin1', 0, 4) === 'MM\0*')) return 'TIFF'
  if (b.length >= 2 && b.toString('latin1', 0, 2) === 'BM') return 'BMP'
  const head = b.toString('utf8', 0, Math.min(b.length, 1024)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'SVG'
  return null
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0)

// 秘密の設定ファイル（一覧に入れても通さない）
const isSecretFile = (path) => {
  const name = basename(path)
  return /^\.env(\..*)?$/.test(name) || name === '.dev.vars' || path.split('/').includes('.wrangler')
}

// 文字の中の危ないもの
const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{16,}/, 'AnthropicのAPIキーらしき文字（sk-ant-…）'],
  [/ANTHROPIC_API_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{16,}/, 'ANTHROPIC_API_KEY に値が書かれている'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '秘密の鍵'],
]
const EMBED_PATTERNS = [
  [/data:(image|video)\//i, '写真・動画を文字にして埋め込んだもの（data:…）'],
  [/(\/9j\/4|iVBORw0KGgo)[A-Za-z0-9+/]{200,}/, '写真を文字にして埋め込んだらしきもの（長い英数字）'],
]

// これから上げるコミットに入っているファイル（パスと中身の番号）を集める
function collectFiles(revArgs) {
  const commits = gitText(['rev-list', ...revArgs]).split('\n').filter(Boolean)
  const files = new Map()
  for (const c of commits) {
    const out = git(['diff-tree', '--root', '-r', '-m', '--no-commit-id', '-z', '--diff-filter=ACMRT', c], {
      encoding: 'utf8',
    })
    const parts = out.split('\0')
    for (let i = 0; i < parts.length; ) {
      const meta = parts[i]
      if (!meta.startsWith(':')) {
        i++
        continue
      }
      const [, , , blob, status] = meta.slice(1).split(' ')
      const twoPaths = /^[RC]/.test(status)
      const path = twoPaths ? parts[i + 2] : parts[i + 1]
      i += twoPaths ? 3 : 2
      if (!path || ZERO.test(blob)) continue
      files.set(`${blob} ${path}`, { blob, path, commit: c })
    }
  }
  return { commits, files: [...files.values()] }
}

function check(revArgs, top) {
  const allow = readAllowlist(top)
  const { commits, files } = collectFiles(revArgs)
  const problems = []
  for (const { blob, path } of files) {
    const buf = git(['cat-file', 'blob', blob])
    const hash = sha256(buf)
    const allowed = allow.has(`${hash} ${path}`)
    const why = []
    if (isSecretFile(path)) why.push('秘密の設定ファイル（.env・.dev.vars など）')
    if (!allowed) {
      const kind = mediaByContent(buf)
      if (MEDIA_EXT.test(path) || kind) why.push(`写真・動画のファイル${kind ? `（中身は ${kind}）` : ''}`)
      else if (isBinary(buf)) why.push('文字ではないファイル')
      if (buf.length > MAX_BYTES) why.push(`大きすぎるファイル（${(buf.length / 1024 / 1024).toFixed(1)}MB）`)
    }
    if (!isBinary(buf)) {
      const text = buf.toString('utf8')
      for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) why.push(label)
      if (!allowed) for (const [re, label] of EMBED_PATTERNS) if (re.test(text)) why.push(label)
    }
    if (why.length) problems.push({ path, why: [...new Set(why)] })
  }
  return { commits, files, problems }
}

function report({ commits, files, problems }) {
  if (!problems.length) {
    console.error(`上げる前の確認：OK（コミット${commits.length}こ・ファイル${files.length}こ）`)
    return true
  }
  console.error('上げる前の確認で止めました。次のファイルが入っています。')
  for (const p of problems) console.error(`  ・${p.path}：${p.why.join('／')}`)
  console.error('')
  console.error('対応のしかた')
  console.error('  ・入れてはいけないものなら、コミットから外してください（ファイルを消しただけでは、前のコミットに残ります）')
  console.error(`  ・画面の飾りやアイコンなど、作る人が確認した画像だけは ${ALLOWLIST} に入れると通ります`)
  console.error('    （node scripts/check-before-push.mjs --hash <ファイル> で書く1行が出ます。本物の猫の写真は入れません）')
  console.error('  ・APIキーや .env は、一覧に入れても通りません')
  return false
}

const [mode, ...rest] = process.argv.slice(2)

// Claude Code からは、どのBashのコマンドでも呼ばれる。git push でなければ、何もせずにすぐ終える
let claudeCmd = ''
if (mode === '--claude-hook') {
  try {
    claudeCmd = String(JSON.parse(readFileSync(0, 'utf8') || '{}')?.tool_input?.command ?? '')
  } catch {
    process.exit(0)
  }
  if (!/(^|[\s;&|(])git(\s+-[Cc]\s+\S+)*\s+push\b/.test(claudeCmd)) process.exit(0)
  if (process.env.CLAUDE_PROJECT_DIR) process.chdir(process.env.CLAUDE_PROJECT_DIR)
}

const startDir = process.cwd()
const top = gitText(['rev-parse', '--show-toplevel'])
process.chdir(top)

if (mode === '--hash') {
  for (const f of rest) {
    const abs = resolve(startDir, f)
    console.log(`${sha256(readFileSync(abs))}  ${relative(top, abs)}  # 確認した日と、何の画像か`)
  }
  process.exit(0)
}

if (mode === '--git-hook') {
  // git から「ローカルの参照 ローカルの番号 リモートの参照 リモートの番号」が1行ずつ届く
  const remote = rest[0] || 'origin'
  const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean)
  let ok = true
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.split(' ')
    if (!localSha || ZERO.test(localSha)) continue // 消すだけのとき
    const revArgs = [localSha, '--not', `--remotes=${remote}`]
    if (remoteSha && !ZERO.test(remoteSha)) revArgs.push(remoteSha)
    if (!report(check(revArgs, top))) ok = false
  }
  process.exit(ok ? 0 : 1)
}

if (mode === '--claude-hook') {
  if (/--no-verify|core\.hooksPath/.test(claudeCmd)) {
    console.error('止めました：上げる前の確認を飛ばす書き方（--no-verify など）は使えません。')
    process.exit(2)
  }
  // まだ上げていない、すべての枝のコミットを見る
  const ok = report(check(['--branches', '--not', '--remotes'], top))
  process.exit(ok ? 0 : 2)
}

// 手で試すとき
process.exit(report(check(['--branches', '--not', '--remotes'], top)) ? 0 : 1)
