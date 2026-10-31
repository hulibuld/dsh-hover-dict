#!/usr/bin/env node
/**
 * client/build.mjs —— 把 client/src/*.js 拼成 client.js（不用打包器）。
 *
 * 为什么不用打包器：这个仓库的运行期依赖必须是零。为十来个纯 ES 模块引入
 * esbuild / rollup，会让「clone 下来就能装」变成「先装一条构建链」。所以走构建期拼接：
 *
 *   源头是 client/src/*.js（人能读、能被 node 直接 import 测）；
 *   产物是 client.js（浏览器半，形状固定为 __ModuleLoader__.load({...})）。
 *
 * 三道防线（都是「静默损坏」的实际教训，不是洁癖）：
 *   1. **按行扫描 + 状态机**剥 import/export，不用裸正则。
 *      正文里有模板字符串、注释、字符串字面量；`/^export\s+/gm` 会把它们一起吃掉，
 *      而且 `node --check` 还是绿的，只是某个函数静默少了几个字。
 *   2. **每个模块包在自己的 IIFE 里**，只把 exports 交出去。
 *      拼接是同一个函数作用域，两个模块各有一个 `normalize` 就会互相遮蔽，
 *      而且这种遮蔽在产物里完全看不出来。IIFE 让「同名」变成不可能。
 *   3. 产物生成后**真的求值一遍**：抓顶层 ReferenceError（拼错模块名、
 *      用了没导入的东西，都会在这一步炸）。
 *
 * 用法：
 *   node client/build.mjs           # 生成 client.js
 *   node client/build.mjs --check   # 只校验磁盘上的 client.js 与源码同步
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC_DIR = join(HERE, 'src')
const OUT_FILE = join(ROOT, 'client.js')
const PACKAGE_NAME = 'dsh-hover-dict'

/**
 * 模块顺序**写死**，不用 readdir。
 *
 * 目录遍历顺序不保证，顺序一变 --check 就会随机变红；更糟的是模块之间有下行依赖
 * （app 用 dict，dict 用 net），顺序错了运行期才炸。
 */
const MODULES = [
  'config.js',
  'word.js',
  'hit.js',
  'selection.js',
  'net.js',
  'dict.js',
  'family.js',
  'wordbook.js',
  'anchor.js',
  'position.js',
  'overlay.js',
  'settings.js',
  'card.js',
  'app.js',
]

/** 拼进产物的前导：这些名字来自宿主注入的 react，源码里不要重复声明。 */
const PREAMBLE = `    // ── 构建期前导（源码里不要重复声明这些名字） ──
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useLayoutEffect = React.useLayoutEffect || React.useEffect
    var useRef = React.useRef
    var useMemo = React.useMemo
    var useCallback = React.useCallback
`

/**
 * 剥掉一个模块的 import / export 语法，返回它的纯净函数体。
 *
 * 按行扫描而不是正则：注释里的 "export" 和字符串里的 "import" 都不能碰。
 * 状态机只需要区分「代码」「行注释」「块注释」「字符串」四种情形。
 *
 * @param {string} source
 * @param {string} file
 * @returns {{ body: string, exports: string[] }}
 */
function transform(source, file) {
  const lines = source.split('\n')
  const out = []
  const exported = []
  /** 从 './x.js' 导入的名字，形如 { './word.js': ['wordAt', ...] } */
  const imports = new Map()
  let inBlockComment = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    let trimmed = line.trim()

    // 块注释状态跨行传递
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false
      out.push(line)
      continue
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true
      out.push(line)
      continue
    }
    if (trimmed.startsWith('//') || trimmed === '') {
      out.push(line)
      continue
    }

    // 跨模块 import：拼接后所有模块共享同一个 IIFE 外层作用域，
    // 所以 import 只是文档，必须删掉。
    if (/^import\s/.test(trimmed)) {
      // 多行 import（`import {\n a,\n b\n} from 'x'`）要一直吃到分号
      let statement = trimmed
      while (!/from\s+['"][^'"]+['"]\s*;?\s*$/.test(statement) && i + 1 < lines.length) {
        i += 1
        statement += ' ' + lines[i].trim()
      }
      const source_ = /from\s+['"]([^'"]+)['"]/.exec(statement)
      const names_ = /\{([^}]*)\}/.exec(statement)
      if (source_ && names_) {
        const spec = source_[1]
        const list = names_[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)
        if (!imports.has(spec)) imports.set(spec, [])
        imports.get(spec).push(...list)
      }
      continue
    }

    // export 声明：记下名字，再把 export 关键字去掉
    const exportFn = /^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(trimmed)
    if (exportFn) {
      exported.push(exportFn[2])
      out.push('    ' + trimmed.replace(/^export\s+/, ''))
      continue
    }
    const exportConst = /^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(trimmed)
    if (exportConst) {
      exported.push(exportConst[2])
      out.push('    ' + trimmed.replace(/^export\s+/, ''))
      continue
    }
    const exportClass = /^export\s+class\s+([A-Za-z_$][\w$]*)/.exec(trimmed)
    if (exportClass) {
      exported.push(exportClass[1])
      out.push('    ' + trimmed.replace(/^export\s+/, ''))
      continue
    }
    if (/^export\s*\{/.test(trimmed)) {
      // `export { a, b }` —— 只记名字，原行丢弃
      let statement = trimmed
      while (!/\}\s*;?\s*$/.test(statement) && i + 1 < lines.length) {
        i += 1
        statement += ' ' + lines[i].trim()
      }
      const inner = /\{([^}]*)\}/.exec(statement)
      if (inner) {
        for (const part of inner[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop()
          if (name) exported.push(name)
        }
      }
      continue
    }
    if (/^export\s+default\s/.test(trimmed)) {
      throw new Error(`${file}: 不支持 export default，请用具名导出`)
    }

    // 普通代码：补四个空格缩进，保持产物可读
    out.push(line === '' ? '' : '    ' + line)
  }

  return { body: out.join('\n'), exports: [...new Set(exported)], imports }
}

/**
 * 生成一个模块的 IIFE 包装。
 *
 * 关键：每个模块在自己的 IIFE 里，**互相看不见**。所以跨模块依赖必须在
 * IIFE 开头显式从上一个模块的导出对象里解构出来 —— 只删掉 import 语句是不够的，
 * 那样代码能过语法检查，跑到那个函数时才 ReferenceError，而外面往往有 try/catch
 * 把它吞掉，表现成「功能静默不生效」。
 *
 * @param {string} name 文件名，如 `word.js`
 * @param {string} body 已剥掉 import/export 的函数体
 * @param {string[]} exports 本模块导出的名字
 * @param {Map<string, string[]>} imports 本模块从别的模块导入的名字
 */
function wrapModule(name, body, exports, imports) {
  const varName = `__mod_${name.replace(/\.js$/, '').replace(/[^\w]/g, '_')}`

  const prologue = []
  for (const [spec, names] of imports) {
    const owner = `__mod_${spec.replace(/^\.\//, '').replace(/\.js$/, '').replace(/[^\w]/g, '_')}`
    prologue.push(`      var { ${[...new Set(names)].join(', ')} } = ${owner}`)
  }

  const returnObj = exports.length > 0
    ? `      return { ${exports.join(', ')} }`
    : '      return {}'

  return `    // ═══ ${name} ═══
    var ${varName} = (function () {
${prologue.length > 0 ? prologue.join('\n') + '\n' : ''}${body}
${returnObj}
    })()`
}

/** 生成完整产物。 */
function build() {
  const parts = []
  const allExports = new Map()

  for (const name of MODULES) {
    const path = join(SRC_DIR, name)
    if (!existsSync(path)) throw new Error(`缺少源文件 ${relative(ROOT, path)}`)
    const source = readFileSync(path, 'utf8')
    const { body, exports, imports } = transform(source, name)
    for (const symbol of exports) {
      if (allExports.has(symbol)) {
        throw new Error(`导出名冲突：${symbol} 同时出现在 ${allExports.get(symbol)} 与 ${name}`)
      }
      allExports.set(symbol, name)
    }
    parts.push(wrapModule(name, body, exports, imports))
  }

  // 宿主只认 apply / inject；其余具名导出只给测试用，不影响加载契约
  const hostExports = ['apply', 'inject']
  for (const symbol of hostExports) {
    if (!allExports.has(symbol)) throw new Error(`产物缺少宿主必需的导出 ${symbol}`)
  }

  const testExports = [...allExports.keys()]
    .filter((symbol) => !hostExports.includes(symbol))
    .sort()

  const lines = []
  lines.push('/**')
  lines.push(' * dsh-hover-dict · 浏览器半 —— **构建产物，不要手改**。')
  lines.push(' *')
  lines.push(' * 由 `node client/build.mjs` 从下列源文件拼成（顺序即依赖顺序）：')
  for (const name of MODULES) lines.push(` *   client/src/${name}`)
  lines.push(' *')
  lines.push(' * 要改行为请改 client/src/ 下对应文件，然后重新构建；')
  lines.push(' * `node client/build.mjs --check` 会在产物与源码不同步时失败。')
  lines.push(' *')
  lines.push(' * 四条硬约束（违反会白屏或崩掉整个 slot）：')
  lines.push(' *   1. 不 require 任何 @deepseek-ai/dsh-client-* 包，只用宿主给的 react；')
  lines.push(' *   2. 界面全是 slot 里的 React 组件，不托管 iframe；')
  lines.push(' *   3. 不在组件外写 DOM、不往 document.body 追加节点；')
  lines.push(' *   4. 组件抛错会让这条 entry 退役（浮层静默消失），渲染路径上不许有会抛的表达式。')
  lines.push(' *')
  lines.push(' * 本插件专属红线：**绝不改正文 DOM**。不包 span、不加 class、不改 textContent。')
  lines.push(' * 单词定位靠 caretRangeFromPoint + Range.getRects，高亮与浮层都在本插件的覆盖层里。')
  lines.push(' */')
  lines.push('window.__ModuleLoader__.load({')
  lines.push(`  id: '${PACKAGE_NAME}',`)
  lines.push('  factory: (require) => {')
  lines.push('    var module = { exports: {} }')
  lines.push('    var exports = module.exports')
  lines.push('')
  lines.push(PREAMBLE)
  lines.push(parts.join('\n\n'))
  lines.push('')
  lines.push('    // ── 宿主加载契约只读这两个名字 ──')
  lines.push('    exports.apply = __mod_app.apply')
  lines.push('    exports.inject = __mod_app.inject')
  lines.push('')
  lines.push('    // ── 纯函数透出给测试（不影响宿主） ──')
  for (const symbol of testExports) {
    const owner = allExports.get(symbol).replace(/\.js$/, '')
    lines.push(`    exports.${symbol} = __mod_${owner}.${symbol}`)
  }
  lines.push('')
  lines.push('    return module.exports')
  lines.push('  },')
  lines.push('})')
  lines.push('')

  return lines.join('\n')
}

/** 产物必须能过语法、且 factory 不能有顶层 ReferenceError。 */
function verify(output) {
  // 1) 语法
  try {
    // eslint-disable-next-line no-new-func
    new Function(output)
  } catch (error) {
    throw new Error(`产物语法错误：${error.message}`)
  }

  // 2) 真跑一遍 factory：拼错模块名、用了未导入的东西都会在这步炸
  const sandbox = { exports: {} }
  const fakeReact = {
    createElement: () => null,
    useState: (v) => [v, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: (v) => ({ current: v }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
  const loader = {
    load({ id, factory }) {
      if (id !== PACKAGE_NAME) throw new Error(`产物 id 是 ${id}，应为 ${PACKAGE_NAME}`)
      sandbox.exports = factory((name) => {
        if (name === 'react') return fakeReact
        throw new Error(`factory 里 require 了未登记的外部模块：${name}`)
      })
    },
  }
  // 用 Function 构造一个有 window 的作用域，避免污染全局
  const runner = new Function('window', output)
  runner({ __ModuleLoader__: loader })

  if (typeof sandbox.exports.apply !== 'function') {
    throw new Error('产物没有导出 apply 函数')
  }
  if (!Array.isArray(sandbox.exports.inject)) {
    throw new Error('产物没有导出 inject 数组')
  }
  return sandbox.exports
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const output = build()

  if (checkOnly) {
    if (!existsSync(OUT_FILE)) {
      console.error(`✗ client.js 不存在，请先运行 node client/build.mjs`)
      process.exit(1)
    }
    const onDisk = readFileSync(OUT_FILE, 'utf8')
    if (onDisk !== output) {
      console.error('✗ client.js 与 client/src/ 不同步，请重新运行 node client/build.mjs')
      process.exit(1)
    }
    verify(output)
    console.log(`✓ client.js 与源码同步（${(output.length / 1024).toFixed(1)} KB）`)
    return
  }

  writeFileSync(OUT_FILE, output)
  const api = verify(output)
  console.log(`✓ 已生成 client.js（${(output.length / 1024).toFixed(1)} KB）`)
  console.log(`  导出 apply: ${typeof api.apply}  ·  inject: ${api.inject.join(', ')}`)
}

try {
  main()
} catch (error) {
  console.error(`✗ 构建失败：${error.message}`)
  process.exit(1)
}
