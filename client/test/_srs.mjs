/**
 * _srs.mjs —— srs.js 纯函数单测（设计-v2 §A3 / §A6）。
 *
 * 只测数学，不碰存储。天数边界全部给死，任何一条红都说明复习间隔会走歪。
 */

import {
  nextSrs, stateAfterGrade, normalizeSrs, defaultSrs,
  DAY_MS, EASE_MIN, EASE_MAX, INTERVAL_MAX, KNOWN_INTERVAL,
} from '../src/srs.js'

let pass = 0
let fail = 0
const t = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} -> ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`)
}
const close = (n, got, want) => {
  const ok = Math.abs(got - want) < 1e-9
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} -> ${got}${ok ? '' : ` want ${want}`}`)
}

const NOW = 1_700_000_000_000

// ── 默认值与夹取 ──
t('默认 srs', defaultSrs(), { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, lastReviewAt: 0 })
t('normalizeSrs 空输入回默认', normalizeSrs(undefined), defaultSrs())
t('normalizeSrs 夹 ease 下限', normalizeSrs({ ease: 0 }).ease, EASE_MIN)
t('normalizeSrs 夹 ease 上限', normalizeSrs({ ease: 9 }).ease, EASE_MAX)
t('normalizeSrs 夹 interval 上限', normalizeSrs({ interval: 9999 }).interval, INTERVAL_MAX)

// ── again：10 分钟后重来，ease -0.2，连对清零，次数 +1 ──
const a1 = nextSrs({ interval: 20, ease: 2.5, reps: 4, lapses: 2 }, 'again', NOW)
t('again.due = now + 10 分钟', a1.due, NOW + 10 * 60000)
t('again.interval 归零', a1.interval, 0)
t('again.reps 归零', a1.reps, 0)
t('again.lapses +1', a1.lapses, 3)
close('again.ease -0.2', a1.ease, 2.3)
t('again.lastReviewAt', a1.lastReviewAt, NOW)

const a2 = nextSrs({ interval: 5, ease: 1.35, reps: 1, lapses: 0 }, 'again', NOW)
t('again.ease 夹到 1.3', a2.ease, EASE_MIN)

// ── hard：间隔减半（至少 1 天），ease -0.15，状态可 delay ──
const h1 = nextSrs({ interval: 10, ease: 2.5, reps: 3, lapses: 0 }, 'hard', NOW)
t('hard.interval 减半', h1.interval, 5)
t('hard.due = now + 5 天', h1.due, NOW + 5 * DAY_MS)
t('hard.reps 归零', h1.reps, 0)
t('hard.lapses +1', h1.lapses, 1)
close('hard.ease -0.15', h1.ease, 2.35)

t('hard.interval 最小 1 天', nextSrs({ interval: 0, ease: 2.5, reps: 1, lapses: 0 }, 'hard', NOW).interval, 1)
t('hard.ease 夹到 1.3', nextSrs({ interval: 4, ease: 1.31, reps: 1, lapses: 0 }, 'hard', NOW).ease, EASE_MIN)

// ── good：1 / 3 / interval*ease ──
const g1 = nextSrs(defaultSrs(), 'good', NOW)
t('good 第 1 次 = 1 天', g1.interval, 1)
t('good 第 1 次 due', g1.due, NOW + DAY_MS)
t('good 第 1 次 reps=1', g1.reps, 1)
close('good 第 1 次 ease +0.02', g1.ease, 2.52)

const g2 = nextSrs(defaultSrs(), 'good', NOW)
const g3 = nextSrs(g2, 'good', NOW)
t('good 第 2 次 = 3 天', g3.interval, 3)

const g4 = nextSrs(g3, 'good', NOW)
// reps 变 3，interval = round(3 * ease)，ease 已涨到 2.56 → round(7.68)=8
t('good 第 3 次 = round(3*2.56)', g4.interval, Math.round(3 * 2.56))

// interval 封顶 365
let capped = { interval: 360, ease: 3.0, reps: 20, lapses: 0 }
t('good interval 封顶 365', nextSrs(capped, 'good', NOW).interval, INTERVAL_MAX)
t('good ease 封顶 3.0', nextSrs({ interval: 1, ease: 3.0, reps: 1, lapses: 0 }, 'good', NOW).ease, EASE_MAX)

// 纯函数：不改传入对象
const src = { interval: 7, ease: 2.3, reps: 2, lapses: 1 }
nextSrs(src, 'good', NOW)
t('nextSrs 不改入参', src, { interval: 7, ease: 2.3, reps: 2, lapses: 1 })

// ── stateAfterGrade ──
t('again → unknown', stateAfterGrade('known', 'again', 0), 'unknown')
t('hard → fuzzy', stateAfterGrade('known', 'hard', 3), 'fuzzy')
t('good 间隔 <21 且 new → fuzzy', stateAfterGrade('new', 'good', 3), 'fuzzy')
t('good 间隔 <21 且已学过 → 保持原状态', stateAfterGrade('unknown', 'good', 3), 'unknown')
t('good 间隔 =21 → known', stateAfterGrade('fuzzy', 'good', KNOWN_INTERVAL), 'known')
t('good 间隔 20 → 不 known', stateAfterGrade('fuzzy', 'good', 20), 'fuzzy')
t('good 间隔 >365 也算 known', stateAfterGrade('fuzzy', 'good', 400), 'known')
t('非法状态按 new 处理', stateAfterGrade('bogus', 'good', 3), 'fuzzy')
t('非法状态 + again → unknown', stateAfterGrade(undefined, 'again', 0), 'unknown')

// ── 连打三次 good 的完整轨迹（能到 21 天以上）──
let walk = defaultSrs()
const trace = []
for (let i = 0; i < 8; i += 1) {
  walk = nextSrs(walk, 'good', NOW)
  trace.push(walk.interval)
}
t('good 连击间隔单调不降', trace.every((v, i) => i === 0 || v >= trace[i - 1]), true)
t('good 连击能跨过 21 天', Math.max(...trace) >= KNOWN_INTERVAL, true)

// ── 未知评分按 good 处理（不卡队列）──
t('未知 grade 走 good 分支', nextSrs(defaultSrs(), 'bogus', NOW).interval, 1)

console.log(`\n${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)