import { computePopoverPlacement, computeCardPlacement, unionRect, containsPoint, computeOverlayRect } from '../src/position.js'
let pass=0,fail=0
const t=(n,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n} -> ${JSON.stringify(got)}${ok?'':`\n        want ${JSON.stringify(want)}`}`)}
const vp = {width:1200, height:800}

// 词在中间，下方有空间 → 落下方
t('middle → bottom', computePopoverPlacement({anchor:{left:500,top:300,right:600,bottom:320,width:100,height:20},size:{width:280,height:90},viewport:vp}),
  {top:326,left:500,placement:'bottom',clamped:false})

// 词在底部，下方放不下 → 翻上方
t('near bottom → top', computePopoverPlacement({anchor:{left:500,top:760,right:600,bottom:780,width:100,height:20},size:{width:280,height:90},viewport:vp}),
  {top:664,left:500,placement:'top',clamped:false})

// 词靠右 → 左移，不越界
const right = computePopoverPlacement({anchor:{left:1150,top:300,right:1190,bottom:320,width:40,height:20},size:{width:280,height:90},viewport:vp})
t('near right → clamped left', right.left <= vp.width-280-8, true)
t('near right → within viewport', right.left+280 <= vp.width, true)

// 视口比浮层窄
const narrow = computePopoverPlacement({anchor:{left:10,top:100,right:50,bottom:120,width:40,height:20},size:{width:1400,height:90},viewport:{width:400,height:800}})
t('narrow viewport → left=margin', narrow.left, 8)

// 卡片
const card = computeCardPlacement({anchor:{left:500,top:300,right:600,bottom:320,width:100,height:20},size:{width:560,height:400},viewport:vp})
t('card centered horizontally', Math.abs((card.left+280) - 550) < 2, true)
t('card within viewport', card.top>=8 && card.top+400<=vp.height-8, true)

// unionRect
t('unionRect empty → null', unionRect([]), null)
t('unionRect', unionRect([{left:0,top:0,right:10,bottom:5},{left:5,top:3,right:20,bottom:15}]),
  {left:0,top:0,right:20,bottom:15,width:20,height:15})

// containsPoint
t('containsPoint inside', containsPoint(5,5,{left:0,top:0,right:10,bottom:10},0), true)
t('containsPoint pad extends', containsPoint(12,5,{left:0,top:0,right:10,bottom:10},3), true)
t('containsPoint outside', containsPoint(20,20,{left:0,top:0,right:10,bottom:10},3), false)
t('containsPoint null rect', containsPoint(1,1,null,3), false)

// 总出口
t('computeOverlayRect card', computeOverlayRect('card',{anchor:{left:0,top:0,right:10,bottom:10,width:10,height:10},size:{width:100,height:100},viewport:vp}).placement, 'bottom')
console.log(`\n${pass}/${pass+fail} passed`)
