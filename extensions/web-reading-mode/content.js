(() => {
  const attr = 'data-wrm-mode';
  const bgAttr = 'data-wrm-bg';   // 1 = 白/近白底，2 = 浅灰/浅色底
  const fgAttr = 'data-wrm-fg';   // dark = 深色彩色文字，gray = 黑/灰色文字
  const styleId = 'wrm-global-style';
  const modeNames = new Set(['night', 'green', 'outdoor']);

  // 思路：逐个检测元素原本的颜色，只把“白底 / 浅灰底”换成对应模式的底色，
  // 夜间模式下把处在深色底上的黑字、灰字统一改成纯白。
  // 很多网站（如 B 站评论区）把内容放在 Shadow DOM 里，普通网页样式进不去，
  // 所以每个 Shadow DOM 也会单独挂上一份同样的样式，并单独检测。
  // 用 :not(#_wrm1#_wrm2#_wrm3) 提高选择器优先级，避免被网站自带的 !important 样式压过
  const HI = ':not(#_wrm1#_wrm2#_wrm3)';
  const WHITE = 'color: #fff !important; -webkit-text-fill-color: #fff !important;';
  const LINK_NIGHT = 'color: #8ab4ff !important; -webkit-text-fill-color: #8ab4ff !important;';
  const RULES = {
    night: [
      [`[${bgAttr}="1"]${HI}`, 'background-color: #1c1f26 !important;'],
      [`[${bgAttr}="2"]${HI}`, 'background-color: #14161b !important;'],
      [`[${bgAttr}]${HI}`, 'border-color: #333842 !important;'],
      [`[${fgAttr}]${HI}`, WHITE],
      [`:is(a[${fgAttr}="dark"], a [${fgAttr}="dark"])${HI}`, LINK_NIGHT],
      [`:is(input, select, textarea, button)[${bgAttr}]${HI}`, WHITE],
      ['::placeholder', 'color: #a0a6b0 !important; -webkit-text-fill-color: #a0a6b0 !important;']
    ],
    green: [
      [`[${bgAttr}="1"]${HI}`, 'background-color: #dce8d5 !important;'],
      [`[${bgAttr}="2"]${HI}`, 'background-color: #cddcc4 !important;']
    ],
    outdoor: [
      [`[${bgAttr}="1"]${HI}`, 'background-color: #fff !important;'],
      [`[${bgAttr}="2"]${HI}`, 'background-color: #e6e6e6 !important; border-color: #777 !important;'],
      [`[${fgAttr}]${HI}`, 'color: #000 !important; -webkit-text-fill-color: #000 !important;'],
      [`:is(a[${fgAttr}], a [${fgAttr}])${HI}`, 'color: #0033a0 !important; -webkit-text-fill-color: #0033a0 !important;']
    ]
  };

  const docCss = [
    `html[${attr}="night"] { color-scheme: dark !important; background-color: #111318 !important; }`,
    `html[${attr}="night"] body { color: #fff !important; }`,
    `html[${attr}="green"] { color-scheme: light !important; background-color: #dce8d5 !important; }`,
    `html[${attr}="outdoor"] { color-scheme: light !important; background-color: #fff !important; }`,
    ...Object.entries(RULES).flatMap(([mode, list]) =>
      list.map(([sel, decl]) => `html[${attr}="${mode}"] ${sel} { ${decl} }`)),
    // 网页底色跟随 body，避免内容不够长时下方露出另一种颜色
    `html[${attr}="night"]:has(> body[${bgAttr}="2"]) { background-color: #14161b !important; }`,
    `html[${attr}="night"]:has(> body[${bgAttr}="1"]) { background-color: #1c1f26 !important; }`,
    `html[${attr}="green"]:has(> body[${bgAttr}="2"]) { background-color: #cddcc4 !important; }`,
    `html[${attr}="outdoor"]:has(> body[${bgAttr}="2"]) { background-color: #e6e6e6 !important; }`
  ].join('\n');

  const shadowCssFor = mode => (RULES[mode] || []).map(([sel, decl]) => `${sel} { ${decl} }`).join('\n');

  const style = document.getElementById(styleId) || document.createElement('style');
  style.id = styleId;
  style.textContent = docCss;
  if (!style.isConnected) (document.head || document.documentElement).appendChild(style);

  // ---------- 颜色检测 ----------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE',
    'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'svg', 'IFRAME', 'OBJECT', 'EMBED', 'BR', 'HR']);
  const FORM = /^(INPUT|TEXTAREA|SELECT|BUTTON)$/;

  let mode = null;

  function parseColor(value) {
    const m = value && value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function bgTier(c) {
    if (!c || c.a < 0.5) return 0;
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    const sat = max - min;
    if (min >= 247 && sat <= 15) return 1;  // 纯白、近白
    if (min >= 205 && sat <= 35) return 2;  // 浅灰、很淡的浅色底
    return 0;
  }

  function luminance(c) {
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  }

  // 文字实际显示的颜色：优先看 -webkit-text-fill-color（有些网站用它覆盖 color）
  function textColor(cs) {
    const fill = parseColor(cs.webkitTextFillColor);
    if (fill && fill.a > 0) return fill;
    return parseColor(cs.color);
  }

  // 视觉上的父元素：可穿过 Shadow DOM 边界
  function parentOf(node) {
    return node.assignedSlot || node.parentElement || (node.parentNode && node.parentNode.host) || null;
  }

  function shadowOf(el) {
    try {
      return (chrome.dom && chrome.dom.openOrClosedShadowRoot && chrome.dom.openOrClosedShadowRoot(el)) || el.shadowRoot || null;
    } catch {
      return el.shadowRoot || null;
    }
  }

  // 夜间模式：文字所处背景（替换后）是否为深色。同一批次内缓存结果
  // 只在明确遇到“未被替换的亮色实底”（如亮黄/亮粉按钮）时保留原字色，
  // 不因小图标/雪碧图等 background-image 跳过，避免论坛等站点出现黑底黑字。
  let darkCache = new Map();
  function isDarkBehind(node) {
    const path = [];
    let result = true;
    for (let n = node, depth = 0; n && depth < 80; n = parentOf(n), depth++) {
      if (darkCache.has(n)) { result = darkCache.get(n); break; }
      path.push(n);
      if (n.hasAttribute(bgAttr) || n === document.documentElement || n === document.body) { result = true; break; }
      const cs = getComputedStyle(n);
      const c = parseColor(cs.backgroundColor);
      if (c && c.a >= 0.5) { result = luminance(c) < 0.55; break; }
    }
    for (const n of path) darkCache.set(n, result);
    return result;
  }

  // 户外模式：文字所处背景是否是浅色底（白/浅灰/页面底色）
  function onLightBackground(el) {
    for (let node = el, depth = 0; node && depth < 80; node = parentOf(node), depth++) {
      if (node.hasAttribute(bgAttr)) return true;
      if (node === document.documentElement) return true;
      const cs = getComputedStyle(node);
      const c = parseColor(cs.backgroundColor);
      if (c && c.a >= 0.5) return false;
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && node !== el) return false;
    }
    return true;
  }

  function hasOwnText(el) {
    if (FORM.test(el.tagName)) return true;
    if (el.tagName === 'SLOT') {
      for (const n of el.assignedNodes()) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
      return false;
    }
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && !child.assignedSlot && child.nodeValue.trim()) return true;
    }
    return false;
  }

  function decideFg(el, cs, tier) {
    const fg = textColor(cs);
    if (!fg || fg.a < 0.1) return;
    const lum = luminance(fg);
    const sat = Math.max(fg.r, fg.g, fg.b) - Math.min(fg.r, fg.g, fg.b);
    const kind = sat < 60 ? 'gray' : 'dark';
    if (mode === 'night') {
      if (lum < 0.62 && (tier || isDarkBehind(el))) el.setAttribute(fgAttr, kind);
    } else if (mode === 'outdoor') {
      if (lum < 0.72 && (tier || onLightBackground(el))) el.setAttribute(fgAttr, kind);
    }
  }

  // fresh = true：先清掉旧标记重新判断；false：只给漏掉的元素补标记（定时巡检用）
  function classify(el, fresh) {
    if (!el || el.nodeType !== 1 || SKIP.has(el.tagName)) return;
    const sr = shadowOf(el);
    if (sr) registerRoot(sr);
    if (el === document.documentElement) return;
    if (fresh) {
      el.removeAttribute(bgAttr);
      el.removeAttribute(fgAttr);
    }
    const hasBg = el.hasAttribute(bgAttr);
    const hasFg = el.hasAttribute(fgAttr);
    if (hasBg && hasFg) return;
    const textual = hasOwnText(el);
    if (hasBg && !textual) return;
    const cs = getComputedStyle(el);
    let tier = hasBg ? 1 : bgTier(parseColor(cs.backgroundColor));
    if (!hasBg && tier) el.setAttribute(bgAttr, String(tier));
    if (hasFg || !textual || mode === 'green') return;
    decideFg(el, cs, tier);
  }

  // ---------- Shadow DOM ----------
  let sheet = null;
  try { sheet = new CSSStyleSheet(); } catch { sheet = null; }
  let roots = new Set();
  let rootSeen = new WeakSet();

  function attachSheet(root) {
    if (sheet) {
      try {
        if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return;
      } catch {
        sheet = null;
      }
    }
    let s = root.querySelector('style[data-wrm-shadow]');
    if (!s) {
      s = document.createElement('style');
      s.setAttribute('data-wrm-shadow', '');
      root.appendChild(s);
    }
    const css = enabled ? shadowCssFor(mode) : '';
    if (s.textContent !== css) s.textContent = css;
  }

  function updateShadowCss() {
    const css = enabled ? shadowCssFor(mode) : '';
    if (sheet) {
      try { sheet.replaceSync(css); } catch {}
    }
    for (const r of roots) attachSheet(r);
  }

  function registerRoot(root) {
    if (!enabled || rootSeen.has(root)) return;
    rootSeen.add(root);
    roots.add(root);
    attachSheet(root);
    observer.observe(root, OBSERVE);
    enqueueTree(root);
  }

  // shadow-hook.js（页面环境）在网页新建 Shadow DOM 时发出通知
  document.addEventListener('wrm-shadow-attached', event => {
    if (!enabled) return;
    const host = event.composedPath()[0];
    if (host && host.nodeType === 1) {
      const sr = shadowOf(host);
      if (sr) registerRoot(sr);
    }
  }, true);

  // ---------- 分批扫描 + 监听新内容 + 定时巡检 ----------
  let queue = [];
  let head = 0;
  let sweepList = null;
  let sweepIdx = 0;
  let scheduled = false;
  let enabled = false;

  function enqueueTree(root) {
    if (!root) return;
    if (root.nodeType === 1) {
      queue.push(root);
      const all = root.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) queue.push(all[i]);
    } else if (root.nodeType === 11) {
      const all = root.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) queue.push(all[i]);
    }
    schedule();
  }

  function enqueueText(textNode) {
    if (textNode.assignedSlot) queue.push(textNode.assignedSlot);
    const p = textNode.parentNode;
    if (p && p.nodeType === 1) queue.push(p);
    schedule();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(work);
  }

  function work() {
    scheduled = false;
    if (!enabled) { queue = []; head = 0; sweepList = null; return; }
    darkCache = new Map();
    const begin = performance.now();
    while (head < queue.length && performance.now() - begin < 12) {
      const el = queue[head++];
      if (el.isConnected) classify(el, true);
    }
    if (head >= queue.length) { queue = []; head = 0; }
    while (sweepList && sweepIdx < sweepList.length && performance.now() - begin < 12) {
      const el = sweepList[sweepIdx++];
      if (el.isConnected) classify(el, false);
    }
    if (sweepList && sweepIdx >= sweepList.length) sweepList = null;
    if (head < queue.length || sweepList) schedule();
  }

  function startSweep() {
    if (!enabled || sweepList || document.hidden) return;
    const list = [];
    const base = document.body || document.documentElement;
    list.push(base);
    const all = base.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) list.push(all[i]);
    for (const r of roots) {
      if (!r.host || !r.host.isConnected) { roots.delete(r); continue; }
      attachSheet(r);
      const inner = r.querySelectorAll('*');
      for (let i = 0; i < inner.length; i++) list.push(inner[i]);
    }
    sweepList = list;
    sweepIdx = 0;
    schedule();
  }

  let sweepTimer = 0;
  function requestSweep(delay) {
    if (!enabled || sweepTimer) return;
    sweepTimer = setTimeout(() => { sweepTimer = 0; startSweep(); }, delay);
  }

  const OBSERVE = {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'style']
  };

  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') {
        r.addedNodes.forEach(n => {
          if (n.nodeType === 1) enqueueTree(n);
          else if (n.nodeType === 3) enqueueText(n);
        });
      } else if (r.type === 'characterData') {
        enqueueText(r.target);
      } else if (r.type === 'attributes' && r.target.nodeType === 1) {
        const el = r.target;
        if (el.getElementsByTagName('*').length < 400) enqueueTree(el);
        else { queue.push(el); schedule(); requestSweep(300); }
      }
    }
  });

  const onScroll = () => requestSweep(250);
  let interval = 0;

  function fullScan() {
    queue = [];
    head = 0;
    sweepList = null;
    enqueueTree(document.body || document.documentElement);
    for (const r of roots) enqueueTree(r);
  }

  function start() {
    if (enabled) return;
    enabled = true;
    updateShadowCss();
    const begin = () => {
      if (!enabled) return;
      observer.observe(document.documentElement, OBSERVE);
      fullScan();
    };
    if (document.body) begin();
    else document.addEventListener('DOMContentLoaded', begin, { once: true });
    // 网页样式可能晚于脚本加载完成，加载完再整体检查一次
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => { if (enabled) fullScan(); }, { once: true });
    }
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    interval = setInterval(() => startSweep(), 2500);
  }

  function stop() {
    enabled = false;
    observer.disconnect();
    removeEventListener('scroll', onScroll, { capture: true });
    clearInterval(interval);
    clearTimeout(sweepTimer);
    sweepTimer = 0;
    queue = [];
    head = 0;
    sweepList = null;
    updateShadowCss();
    roots = new Set();
    rootSeen = new WeakSet();
  }

  function apply(next) {
    if (modeNames.has(next)) {
      const changed = next !== mode;
      mode = next;
      document.documentElement.setAttribute(attr, next);
      if (!enabled) start();
      else {
        updateShadowCss();
        if (changed && document.body) fullScan();
      }
    } else {
      mode = null;
      document.documentElement.removeAttribute(attr);
      stop();
    }
  }

  // 弹窗可能会向已打开的标签页重复注入新版本：先停掉旧实例
  window.__wrmStop?.();
  window.__wrmStop = stop;
  window.__wrmApply = apply;
  if (!window.__wrmListenerInstalled) {
    window.__wrmListenerInstalled = true;
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === 'SET_MODE') window.__wrmApply?.(message.mode);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.defaultMode) return;
      window.__wrmApply?.(changes.defaultMode.newValue);
    });
  }

  chrome.storage.local.get('defaultMode').then(({ defaultMode }) => {
    window.__wrmApply?.(defaultMode);
  });
})();
