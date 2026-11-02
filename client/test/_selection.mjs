import { classifySelection, hanRatio, isTranslatable } from '../src/selection.js'

let pass=0, fail=0
const t=(name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok?'PASS':'FAIL'}  ${name.padEnd(44)} -> ${JSON.stringify(got)}${ok?'':`  want ${JSON.stringify(want)}`}`)
}

console.log('— 单词 —')
t('hello', classifySelection('hello')?.kind, 'word')
t('Hello', classifySelection('Hello')?.kind, 'word')
t("don't", classifySelection("don't")?.kind, 'word')
t('well-known', classifySelection('well-known')?.kind, 'word')
t('utf8', classifySelection('utf8')?.kind, 'word')
t('单个中文 "你好"', classifySelection('你好'), null)

console.log('\n— 纯英文句子：要翻译 —')
t('普通英文句', classifySelection('The quick brown fox jumps over the lazy dog.')?.kind, 'phrase')
t('带 8% 中文的英文', classifySelection('This is a test 测试 of the system')?.kind, 'phrase')
t('代码片段', classifySelection('const result = await fetch(url)')?.kind, 'phrase')

console.log('\n— 中英混排：不翻译（用户要求）—')
// 中英混排：直接返回 null，界面上什么都不弹
t('中英各半 → 不处理', classifySelection('这个 tokenizers 的分词是什么意思'), null)
t('中文为主 → 不处理', classifySelection('我觉得这个 approach 不太行，需要换个思路'), null)
t('纯中文 → 不处理', classifySelection('今天天气不错'), null)
t('整段对话带英文 → 不处理', classifySelection('好的，我这就去改。The plugin registers a lazy factory whose id equals the package name. 然后重启就行。'), null)

// 阈值可配
t('阈值 0：有汉字就不翻', classifySelection('This is a test 测试 of the system', { maxHanRatio: 0 }), null)
t('默认阈值：夹一个中文词仍翻', classifySelection('This is a test 测试 of the system')?.kind, 'phrase')
t('阈值放宽到 0.5：中英各半能翻', classifySelection('中文 hello world test', { maxHanRatio: 0.5 })?.kind, 'phrase')

console.log('\n— hanRatio —')
t('纯英文 = 0', hanRatio('Hello world'), 0)
t('纯中文 = 1', hanRatio('你好世界'), 1)
t('空串 = 1', hanRatio(''), 1)
t('各半 = 0.5', hanRatio('ab中文'), 0.5)

console.log('\n— isTranslatable —')
t('纯英文 true', isTranslatable('Hello world'), true)
t('混排 false', isTranslatable('你好 hello world'), false)
t('无字母 false', isTranslatable('12345'), false)

console.log(`\n${pass}/${pass+fail} passed`)
