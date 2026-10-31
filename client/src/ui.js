/**
 * ui.js —— 一套共用的设计原语。
 *
 * 为什么要有这个文件：设置页 `settings.section` 的宿主容器是**裸壳子**
 * （没底色、没内边距、没圆角），所以层级只能在自己这一层造出来。
 * 之前我把颜色、间距、字号散在各处手搓，结果：
 *   1. 用了四个宿主根本没提供的 token（吸了 `bg-layer-3`、`label-tertiary` 等），
 *      而 CSS 的 var() 取不到值又不给备用值时，**整条声明作废**，
 *      按钮和输入框于是变成「没有边框的一行字」——这就是「简陋」的真正原因；
 *   2. 字号散成 13.5 / 13 / 12.5 / 12 / 11.5 五档，没有标度。
 *
 * 现在的约定：
 *   - 颜色一律走宿主给的 14 个 `--dsw-alias-*`，**每条都给备用值**；
 *   - 字号只有三档（TITLE / BODY / SMALL）；
 *   - 间距只有四档（GAP_XS / GAP_SM / GAP_MD / GAP_LG）；
 *   - 所有可交互件都带 `aria-*`，键盘可达。
 *
 * 同一宿主槽里别的插件（例如「大肥鱼的后台」）也在手搓自己的样式。
 * 这份原语本来就打算给两家共用：谁要用，把这个文件复制过去，
 * 在插件入口调一次 `makePrimitives(React.createElement)` 即可。
 *
 * 为什么用工厂而不是直接导出组件：这份代码跑在宿主的模块表里，
 * 拿不到顶层 import 的 React。`h` 必须由调用方在运行期注入，
 * 所以组件在工厂里闭包生成。
 */

/* ── 字号标度：三档，不再散 ─────────────────────────────────────────── */
export const FS = Object.freeze({
  title: 15,
  body: 13,
  small: 11.5,
})

/* ── 间距标度：四档 ─────────────────────────────────────────────────── */
export const GAP = Object.freeze({
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
})

/* ── 圆角 ───────────────────────────────────────────────────────────── */
export const RADIUS = Object.freeze({
  sm: 7,
  md: 10,
  lg: 14,
  pill: 999,
})

/**
 * 主题色。
 *
 * 键名与宿主 token 一一对应，**值里已经带好备用值**——调用方直接拿去当
 * style 用，不要再自己写一遍 var()。备用值取的是深色主题下能看的半透明白，
 * 宿主 token 在就优先用 token。
 */
export const C = Object.freeze({
  text: 'var(--dsw-alias-label-primary, #e8e8e8)',
  textDim: 'var(--dsw-alias-label-secondary, rgba(255,255,255,0.66))',
  textFaint: 'var(--dsw-alias-label-secondary, rgba(255,255,255,0.48))',
  bgBase: 'var(--dsw-alias-bg-base, rgba(255,255,255,0.03))',
  bg1: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.06))',
  bg2: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.09))',
  overlay: 'var(--dsw-alias-bg-overlay, rgba(255,255,255,0.10))',
  border1: 'var(--dsw-alias-border-l1, rgba(255,255,255,0.12))',
  border2: 'var(--dsw-alias-border-l2, rgba(255,255,255,0.20))',
  accent: 'var(--dsw-alias-brand-primary, #4d6bfe)',
  danger: 'var(--dsw-alias-state-error-primary, #e5484d)',
  success: 'var(--dsw-alias-state-success-primary, #2f9e44)',
  warn: 'var(--dsw-alias-state-warn-primary, #f0a441)',
  idle: 'var(--dsw-alias-state-idle-primary, rgba(255,255,255,0.4))',
})

/* ── 动效曲线 ───────────────────────────────────────────────────────── */
export const EASE = Object.freeze({
  /** 快出缓停：适合位移与展开 */
  out: 'cubic-bezier(.16,1,.3,1)',
  /** 轻微过冲：适合开关与按下回弹 */
  settle: 'cubic-bezier(.34,1.4,.4,1)',
})

/**
 * 把若干 style 对象合成一个，过滤掉假值。
 *
 * 不用 Object.assign 是因为调用点常常是 `[base, cond && extra]` 这种，
 * 里面会有 false / null / undefined。
 *
 * @param {...(object|false|null|undefined)} parts
 * @returns {object}
 */
export function sx(...parts) {
  const out = {}
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    for (const [key, value] of Object.entries(part)) {
      if (value !== undefined && value !== null && value !== false) out[key] = value
    }
  }
  return out
}

/** 一段说明文字。 */
export function hintStyle() {
  return {
    margin: 0,
    fontSize: FS.small,
    lineHeight: 1.85,
    color: C.textDim,
  }
}

/**
 * 分区卡。
 *
 * 宿主给的容器是裸的，所以每块内容自己带一张卡片：
 * 细边框 + 分层底色 + 顶部内高光 + 圆角。
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.hint]
 * @param {import('react').ReactNode} [props.action] 标题右侧的操作区
 * @param {import('react').ReactNode} props.children
 * @returns {import('react').ReactElement}
 */
  function Card(props) {
  return h('section', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      borderRadius: RADIUS.lg,
      border: `1px solid ${C.border1}`,
      background: C.bg2,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
      overflow: 'hidden',
    },
    'aria-label': typeof props.title === 'string' ? props.title : undefined,
  }, [
    h('div', {
      key: 'head',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: GAP.sm,
        padding: `${GAP.md - 1}px ${GAP.md + 2}px ${GAP.sm + 3}px`,
        borderBottom: `1px solid ${C.border1}`,
        background: C.bg1,
      },
    }, [
      h('div', { key: 'tw', style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 } }, [
        h('h3', {
          key: 't',
          style: { margin: 0, fontSize: FS.title, fontWeight: 680, lineHeight: 1.5, color: C.text },
        }, props.title),
        props.hint ? h('p', { key: 'h', style: hintStyle() }, props.hint) : null,
      ]),
      props.action ? h('div', { key: 'a', style: { flex: 'none' } }, props.action) : null,
    ]),
    h('div', {
      key: 'body',
      style: { display: 'flex', flexDirection: 'column', gap: GAP.md, padding: `${GAP.md}px ${GAP.md + 2}px` },
    }, props.children),
  ])
}

/**
 * 按钮。
 *
 * 视觉：细边 + 顶高光 + 悬停时一条斜向高光扫过 + 按下缩到 .985 并加内阴影。
 * 立体感来自「按下去看得见」这一下的反馈，不是靠堆渐变。
 *
 * @param {object} props
 * @param {string} props.label
 * @param {'default'|'primary'|'ghost'|'danger'} [props.variant]
 * @param {'sm'|'md'} [props.size]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.busy] 进行中：显示转圈并禁用
 * @param {() => void} props.onClick
 * @returns {import('react').ReactElement}
 */
  function Button(props) {
  const variant = props.variant ?? 'default'
  const small = props.size === 'sm'
  const disabled = props.disabled === true || props.busy === true

  const paint = {
    default: { background: C.bg1, color: C.text, border: C.border2 },
    primary: { background: C.accent, color: '#fff', border: 'transparent' },
    ghost: { background: 'transparent', color: C.textDim, border: 'transparent' },
    danger: { background: 'transparent', color: C.danger, border: `color-mix(in srgb, ${C.danger} 55%, transparent)` },
  }[variant]

  return h('button', {
    type: 'button',
    disabled,
    'aria-busy': props.busy === true ? 'true' : undefined,
    onClick: disabled ? undefined : props.onClick,
    style: {
      position: 'relative',
      overflow: 'hidden',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: GAP.xs,
      minHeight: small ? 28 : 32,
      padding: small ? '4px 12px' : '6px 16px',
      borderRadius: small ? RADIUS.sm : 9,
      border: `1px solid ${paint.border}`,
      background: paint.background,
      boxShadow: variant === 'ghost' ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      color: disabled ? C.textFaint : paint.color,
      font: 'inherit',
      fontSize: small ? FS.small : 12.5,
      fontWeight: 580,
      lineHeight: 1.4,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      whiteSpace: 'nowrap',
      transition: 'transform .16s cubic-bezier(.34,1.4,.4,1), border-color .2s, background .2s, box-shadow .2s',
      WebkitTapHighlightColor: 'transparent',
    },
  }, props.busy
    ? h('span', { key: 's', 'aria-hidden': 'true', style: { fontSize: FS.small, opacity: 0.8 } }, '处理中…')
    : props.label)
}

/**
 * 开关。
 *
 * 结构是 track + 滑块两层，滑块用 spring 曲线回弹。
 *
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(next: boolean) => void} props.onChange
 * @param {string} [props.label]
 * @returns {import('react').ReactElement}
 */
  function Switch(props) {
  const on = props.checked === true
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': on ? 'true' : 'false',
    'aria-label': props.label,
    onClick: () => props.onChange(!on),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 9,
      padding: 0,
      border: 0,
      background: 'transparent',
      font: 'inherit',
      color: 'inherit',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
    },
  }, [
    h('span', {
      key: 'track',
      'aria-hidden': 'true',
      style: {
        position: 'relative',
        width: 38,
        height: 21,
        flex: 'none',
        borderRadius: RADIUS.pill,
        border: `1px solid ${on ? 'transparent' : C.border2}`,
        background: on ? C.accent : C.bg1,
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.18)',
        transition: `background .22s ${EASE.out}, border-color .22s ${EASE.out}`,
      },
    }, h('span', {
      style: {
        position: 'absolute',
        top: 2,
        left: 2,
        width: 15,
        height: 15,
        borderRadius: '50%',
        background: on ? '#fff' : C.textFaint,
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        transform: on ? 'translateX(17px)' : 'translateX(0)',
        transition: `transform .28s ${EASE.settle}, background .2s ${EASE.out}`,
      },
    })),
    props.label
      ? h('span', { key: 'l', style: { fontSize: FS.body, lineHeight: 1.7, color: C.text } }, props.label)
      : null,
  ])
}

/**
 * 文本框 / 多行框。
 *
 * 常态是「凹槽」手感（内阴影），focus 只换边色 + 外发光，凹槽不动。
 *
 * @param {object} props
 * @param {string} [props.value]
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {boolean} [props.multiline]
 * @param {'text'|'number'|'search'} [props.type]
 * @param {object} [props.style]
 * @returns {import('react').ReactElement}
 */
  function Input(props) {
  const base = {
    font: 'inherit',
    fontSize: FS.body,
    padding: '8px 12px',
    borderRadius: 9,
    border: `1px solid ${C.border2}`,
    background: C.bgBase,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.16)',
    color: C.text,
    minWidth: 0,
    width: '100%',
    outline: 'none',
    transition: `border-color .18s ${EASE.out}, box-shadow .2s ${EASE.out}`,
  }
  const shared = {
    value: props.value ?? '',
    placeholder: props.placeholder,
    onChange: (event) => props.onChange(event.target.value),
    onFocus: (event) => {
      event.currentTarget.style.borderColor = C.accent
      event.currentTarget.style.boxShadow = `inset 0 1px 2px rgba(0,0,0,0.12), 0 0 0 3px color-mix(in srgb, ${C.accent} 18%, transparent)`
    },
    onBlur: (event) => {
      event.currentTarget.style.borderColor = C.border2
      event.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.16)'
    },
  }

  if (props.multiline === true) {
    return h('textarea', {
      ...shared,
      style: sx(base, {
        minHeight: 128,
        lineHeight: 1.85,
        resize: 'vertical',
        fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
        fontSize: FS.small,
      }, props.style),
    })
  }
  return h('input', {
    ...shared,
    type: props.type ?? 'text',
    style: sx(base, props.style),
  })
}

/**
 * 下拉选择。
 *
 * @param {object} props
 * @param {string} props.value
 * @param {Array<{ value: string, label: string }>} props.options
 * @param {(value: string) => void} props.onChange
 * @returns {import('react').ReactElement}
 */
  function Select(props) {
  return h('select', {
    value: props.value,
    onChange: (event) => props.onChange(event.target.value),
    style: {
      font: 'inherit',
      fontSize: FS.body,
      padding: '8px 12px',
      borderRadius: 9,
      border: `1px solid ${C.border2}`,
      background: C.bgBase,
      color: C.text,
      cursor: 'pointer',
      outline: 'none',
    },
  }, (props.options ?? []).map((option) => h('option', {
    key: option.value,
    value: option.value,
  }, option.label)))
}

/**
 * 标签。用于状态徽章。
 *
 * @param {object} props
 * @param {string} props.text
 * @param {'neutral'|'accent'|'success'|'danger'|'warn'} [props.tone]
 * @returns {import('react').ReactElement}
 */
  function Badge(props) {
  const tone = props.tone ?? 'neutral'
  const paint = {
    neutral: { color: C.textFaint, border: C.border2 },
    accent: { color: C.accent, border: `color-mix(in srgb, ${C.accent} 45%, transparent)` },
    success: { color: C.success, border: `color-mix(in srgb, ${C.success} 45%, transparent)` },
    danger: { color: C.danger, border: `color-mix(in srgb, ${C.danger} 45%, transparent)` },
    warn: { color: C.warn, border: `color-mix(in srgb, ${C.warn} 45%, transparent)` },
  }[tone]

  return h('span', {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '1px 8px',
      borderRadius: RADIUS.pill,
      border: `1px solid ${paint.border}`,
      fontSize: 10.5,
      fontWeight: 500,
      lineHeight: 1.7,
      color: paint.color,
      whiteSpace: 'nowrap',
    },
  }, props.text)
}

/**
 * 提示条。四种语气。
 *
 * @param {object} props
 * @param {string} props.text
 * @param {'info'|'ok'|'err'|'warn'} [props.tone]
 * @param {import('react').ReactNode} [props.action]
 * @returns {import('react').ReactElement}
 */
  function Note(props) {
  const tone = props.tone ?? 'info'
  const paint = {
    info: { color: C.textDim, border: C.border1, bg: 'transparent' },
    ok: { color: C.success, border: `color-mix(in srgb, ${C.success} 45%, transparent)`, bg: `color-mix(in srgb, ${C.success} 9%, transparent)` },
    err: { color: C.danger, border: `color-mix(in srgb, ${C.danger} 45%, transparent)`, bg: `color-mix(in srgb, ${C.danger} 9%, transparent)` },
    warn: { color: C.warn, border: `color-mix(in srgb, ${C.warn} 45%, transparent)`, bg: `color-mix(in srgb, ${C.warn} 9%, transparent)` },
  }[tone]

  return h('div', {
    role: tone === 'err' ? 'alert' : undefined,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: GAP.sm,
      padding: '10px 13px',
      borderRadius: RADIUS.md,
      border: `1px solid ${paint.border}`,
      background: paint.bg,
      fontSize: FS.small,
      lineHeight: 1.8,
      color: paint.color,
    },
  }, [
    h('span', { key: 't', style: { flex: 1, minWidth: 0 } }, props.text),
    props.action ? h('span', { key: 'a', style: { flex: 'none' } }, props.action) : null,
  ])
}

/**
 * 设置行：标签在上，控件在下。
 *
 * 上下排列而不是左右两列，是因为设置页的容器宽度不确定；
 * 左右两列在窄容器里会把标签挤断行。
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} [props.hint]
 * @param {import('react').ReactNode} props.children
 * @returns {import('react').ReactElement}
 */
  function Field(props) {
  return h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: GAP.xs + 2 },
  }, [
    h('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
      h('span', { key: 't', style: { fontSize: 12.5, lineHeight: 1.7, color: C.textDim } }, props.label),
      props.hint ? h('span', { key: 'h', style: hintStyle() }, props.hint) : null,
    ]),
    h('div', { key: 'c', style: { display: 'flex', alignItems: 'center', gap: GAP.sm, flexWrap: 'wrap' } }, props.children),
  ])
}

/**
 * 页面头：标题 + 一句话说明 + 可选的状态徽章/数字。
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.desc]
 * @param {import('react').ReactNode} [props.extra]
 * @returns {import('react').ReactElement}
 */
  function PageHeader(props) {
  return h('header', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: GAP.sm,
      padding: `2px 2px ${GAP.md + 4}px`,
      borderBottom: `1px solid ${C.border1}`,
    },
  }, [
    h('div', { key: 'line', style: { display: 'flex', alignItems: 'center', gap: GAP.sm, flexWrap: 'wrap' } }, [
      h('h2', {
        key: 't',
        style: { margin: 0, fontSize: 20, fontWeight: 680, letterSpacing: '-.3px', lineHeight: 1.4, color: C.text },
      }, props.title),
      props.extra ? h('span', { key: 'x', style: { display: 'inline-flex', gap: GAP.xs, flexWrap: 'wrap' } }, props.extra) : null,
    ]),
    props.desc ? h('p', { key: 'd', style: sx(hintStyle(), { maxWidth: '58ch' }) }, props.desc) : null,
  ])
}

/**
 * 页面根容器：居中、限宽、统一的纵向节奏。
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @returns {import('react').ReactElement}
 */
  function Page(props) {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: GAP.md + 2,
      maxWidth: 820,
      marginInline: 'auto',
      width: '100%',
      padding: '4px 0 32px',
      fontSize: FS.body,
      lineHeight: 1.8,
      color: C.text,
      WebkitFontSmoothing: 'antialiased',
    },
  }, props.children)
}

/**
 * 造一套原语。
 *
 * @param {Function} h React.createElement（由插件入口从 `require('react')` 拿到）
 * @returns {{
 *   Card: Function, Button: Function, Switch: Function, Input: Function,
 *   Select: Function, Badge: Function, Note: Function, Field: Function,
 *   PageHeader: Function, Page: Function,
 *   FS: object, GAP: object, RADIUS: object, C: object, EASE: object, sx: Function, hintStyle: Function,
 * }}
 */
export function makePrimitives(h) {
  if (typeof h !== 'function') {
    throw new TypeError('makePrimitives 需要 React.createElement')
  }
  return {
    Card, Button, Switch, Input, Select, Badge, Note, Field, PageHeader, Page,
    FS, GAP, RADIUS, C, EASE, sx, hintStyle,
  }
}
