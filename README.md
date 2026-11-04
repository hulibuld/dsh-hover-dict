# dsh-hover-dict · 点选查词

[![npm](https://img.shields.io/npm/v/dsh-hover-dict)](https://www.npmjs.com/package/dsh-hover-dict)
[![月下载](https://img.shields.io/npm/dm/dsh-hover-dict)](https://www.npmjs.com/package/dsh-hover-dict)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-blue)](https://github.com/hulibuld/dsh-hover-dict)
[![License](https://img.shields.io/npm/l/dsh-hover-dict)](LICENSE)

`dsh plugin --profile desktop add dsh-hover-dict` · [遇到问题开 issue](https://github.com/hulibuld/dsh-hover-dict/issues/new/choose)

在 DeepSeek 里读英文，点一下词就看到它什么意思。

## 装

命令一行，装完重启 DSH，插件不走热重载。重启后不用找开关，划词就能用。

## 能查什么

单击一个英文词，或者双击，或者左键划选一个词，旁边浮出小卡片：词性、中文释义、考纲标签。

划选一段纯英文，给中文翻译。中英混排的不翻，汉字超过 10% 就跳过，只提示一句，不会静默没反应。

点一下浮层，展开大卡片：全部义项、英英释义、词形变化、同根词、词根词缀、双语例句。

范围只算对话正文。代码块、行内代码、工具调用卡片里的英文都能查，那些地方恰恰最常要查，变量名、命令、报错信息都在里面。输入框、右下角的模型选择器、侧栏和设置页不响应，在那些地方点一下是想定位光标或开菜单，弹词典只会碍事。

结果不会自己消失。点浮层外面、按 Esc、重新选别的，三种才关。

选中的词不加底色也不加边框。

没有音标，没有发音。

## 生词本

卡片和浮层右上角都有星标，点亮表示这个词已经在里面了。

一个词和你背过的词是什么关系，用颜色分。红的是这个词本身在生词本里，它的变位也算，收藏了 run，ran、running、runs 都标红。蓝的是同一个语义词族里但没收藏，查 care 时 careful、careless、carer 标蓝。

同根词按派生规则判断，不看字符串像不像。care 和 career 前缀一样，但没有词源关系，不会连在一起。

生词本存在 DSH 的本地存储里，换浏览器、清缓存都不丢。

导入在设置面板里，直接粘单词表，一行一个。有道、欧路、百词斩导出的内容都能认，每行第一个像英文单词的片段会被收下。

## 词根词缀

卡片里给一个词的拆解。biography 是 bio 生命加 graph 写，rewrite 是 re- 再，careless 是 -less 没有。

6,374 个词有分析，占词库 31%。宁可漏也不误判：拆完要过四道闸门，词干得真实存在，释义要有语义重叠，独立基础词不硬拆，人工确认的假拆分进排除表。所以 understand 不会被拆成 under- 加 stand。

## 设置页

设置左侧导航那一列会多出「英语翻译」，排在「技能」和「费用」之间。点开两个标签。

生词本：全部收藏的词，带中文释义预览，能搜、能单个移出。

设置：翻译接口、词库管理、生词本导入导出、显示参数。

只有这一个入口，不另外挂详情页，也不挂侧边栏图标。

## 词库

自带三个，随包分发，完全离线。

核心词库 20,499 个考纲核心词，中考、高考、四六级、考研、托福、雅思、GRE 都在里面。词根词缀库 6,374 个词的拆解。双语例句库 8,960 个词的中英对照例句。

自己加词库：文件放进 `data/packs/`，重启 DSH 后自动加载。支持两种格式。ECDICT 的 CSV，只要有 `word` 和 `translation` 两列就能用，`definition` 和 `tag` 可选。或者跟 `dict.dat` 同构的 JSON，键是词头，值是槽位数组。

文件名只能是小写字母、数字、连字符，加 `.dat` 或 `.csv`。

词库是构建期产物，随包已经给好了。要换语料或者改筛选口径才需要重跑构建脚本。

## 开发

```
node client/build.mjs
node client/build.mjs --check
node scripts/test-host.mjs
node client/test/smoke.mjs
```

改完源码务必跑一次 `node client/build.mjs`。`client.js` 是产物，只改 `client/src/` 不会生效。

## 许可

MIT，见 [LICENSE](LICENSE)。
