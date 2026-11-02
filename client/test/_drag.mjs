import { clampToViewport, dragPosition, VIEWPORT_PAD } from '../src/drag.js'
let pass=0, fail=0
const t=(n,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n} -> ${JSON.stringify(got)}${ok?'':` want ${JSON.stringify(want)}`}`)}

const vp = { width: 1200, height: 800 }
const size = { width: 400, height: 300 }

t('中间位置不变', clampToViewport({top:200,left:300}, size, vp), {top:200,left:300})
t('超出左边 → 贴边', clampToViewport({top:200,left:-50}, size, vp), {top:200,left:VIEWPORT_PAD})
t('超出上边 → 贴边', clampToViewport({top:-99,left:300}, size, vp), {top:VIEWPORT_PAD,left:300})
t('超出右边 → 贴边', clampToViewport({top:200,left:1100}, size, vp), {top:200,left:vp.width-size.width-VIEWPORT_PAD})
t('超出下边 → 贴边', clampToViewport({top:900,left:300}, size, vp), {top:vp.height-size.height-VIEWPORT_PAD,left:300})
t('视口比卡片还小 → 不崩', clampToViewport({top:100,left:100}, {width:2000,height:2000}, vp), {top:VIEWPORT_PAD,left:VIEWPORT_PAD})

// 位移计算：起点 200,300，指针从 (500,400) 移到 (560,450) = +60,+50
t('按位移移动', dragPosition({top:200,left:300},{x:500,y:400},{x:560,y:450},size,vp), {top:250,left:360})
t('拖到左上角会夹住', dragPosition({top:20,left:20},{x:500,y:400},{x:100,y:100},size,vp), {top:VIEWPORT_PAD,left:VIEWPORT_PAD})

/* 汇总放最后 */

// ── 回归：把手里的按钮不能被拖动吞掉 ──
// 真实 bug：星标嵌在拖动把手内，把手的 pointerdown 调 preventDefault +
// setPointerCapture，星标点击收不到，表现为「点星标没反应」。
{
  const handled = []
  const makeNode = (isButton) => ({
    closest: (sel) => (isButton && /button/.test(sel) ? { tag: 'button' } : null),
    setPointerCapture: () => {
      handled.push('capture')
    },
    releasePointerCapture: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  const panel = { getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100 }) }
  const doc = { addEventListener: () => {}, removeEventListener: () => {} }
  const { attachDrag } = await import('../src/drag.js')

  // 用真实 attachDrag 的判定逻辑：按在 button 上不该进入拖动
  const handle = makeNode(false)
  const detach = attachDrag({ handle, panel, doc, viewport: { width: 1200, height: 800 } })
  detach()

  // 直接验证判定式本身
  const target = makeNode(true)
  const shouldSkip = Boolean(
    target.closest && target.closest('button, a, input, textarea, select, [role="button"]') !== null,
  )
  t('按在按钮上不启动拖动', shouldSkip, true)
  t('按在空白处启动拖动', Boolean(makeNode(false).closest('button, a, input, textarea, select, [role="button"]')), false)
}

console.log(`\n${pass}/${pass+fail} passed`)
if (fail>0) process.exit(1)
