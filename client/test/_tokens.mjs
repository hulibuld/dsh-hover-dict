// 设计 token 合规检查。这条测试是从一次真实事故长出来的：
// 我用了 4 个宿主根本没提供的 token，且没写备用值。
// CSS 里 var() 取不到值又没备用值时，**整条声明作废**，
// 于是按钮和输入框全变成没有边框的一行字——看着像没排版。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 宿主 Theme 服务实际提供的全部 token（用 cordis_inspect_query 的 Theme.listTokens 核过）
const REAL_TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
])

const files = globSync('client/src/*.js', { cwd: ROOT })
let pass = 0
let fail = 0
const t = (name, ok, detail) => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —— ${detail}` : ''}`)
}

console.log('\n[1] 用到的 token 必须真实存在')
const unknown = new Map()
for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  for (const m of src.matchAll(/var\((--dsw-[a-z0-9-]+)/g)) {
    const name = m[1]
    if (!name.startsWith('--dsw-alias-')) continue
    if (REAL_TOKENS.has(name)) continue
    if (!unknown.has(name)) unknown.set(name, [])
    unknown.get(name).push(rel)
  }
}
t('没有不存在的 alias token', unknown.size === 0,
  unknown.size === 0 ? '' : [...unknown.entries()].map(([k, v]) => `${k} @ ${v[0]}`).join('; '))

console.log('\n[2] 每个 token 都必须有备用值')
const bare = []
for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  // 匹配 var(--dsw-xxx) —— 右括号紧贴，中间没有逗号
  for (const m of src.matchAll(/var\((--dsw-alias-[a-z0-9-]+)\)/g)) {
    bare.push(`${m[1]} @ ${rel}`)
  }
}
t('没有缺备用值的 var()', bare.length === 0, bare.slice(0, 3).join('; '))

console.log('\n[3] 页面结构')
const settings = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')
t('有页面头', settings.includes('hds-header'))
t('根容器居中', settings.includes('margin-inline: auto'))
t('分区有卡片边框', /\.hds-section\s*\{[^}]*border-radius/.test(settings))
t('字号用标度', settings.includes('FS.body') || settings.includes('--fs-body'))
// 允许 20（页面标题）与 10.5（徽章）；其余字号必须走 FS
t('没有散落的字号', !/fontSize:\s*1[0-9](?:\.[05])?\b/.test(settings.replace(/fontSize:\s*10\.5/g, '')))
t('不用原生确认框', !settings.includes('window.confirm('))
t('超出上限有交代', settings.includes('CHIP_LIMIT'))

console.log(`\n${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
