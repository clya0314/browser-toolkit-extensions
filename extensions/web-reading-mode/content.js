(() => {
  const attr = 'data-wrm-mode';
  const bgAttr = 'data-wrm-bg';   // 1 = 白/近白底，2 = 浅灰/浅色底
  const fgAttr = 'data-wrm-fg';   // dark = 深色文字，gray = 灰色文字
  const styleId = 'wrm-global-style';
  const modeNames = new Set(['night', 'green', 'outdoor']);

  // 思路：不再把所有 div 强制变透明（会让弹窗、下拉菜单、吸顶栏、卡片变成“透明”叠在一起），
  // 而是逐个检测元素原本的背景色，只把“白底 / 浅灰底”替换成对应模式的底色，其它颜色保持不变。
  const styleText = `
    html[${attr}="night"] { color-scheme: dark !important; background-color: #111318 !important; }
    html[${attr}="night"] body { color: #e5e7eb !important; }
    html[${attr}="night"] [${bgAttr}="1"] { background-color: #1c1f26 !important; }
    html[${attr}="night"] [${bgAttr}="2"] { background-color: #14161b !important; }
    html[${attr}="night"] [${bgAttr}] { border-color: #333842 !important; }
    html[${attr}="night"] [${fgAttr}] { color: #e5e7eb !important; }
    html[${attr}="night"] :is(a[${fgAttr}], a [${fgAttr}]) { color: #9fc5ff !important; }
    html[${attr}="night"] :is(input, select, textarea, button)[${bgAttr}] { color: #e5e7eb !important; }
    html[${attr}="night"] ::placeholder { color: #8b919c !important; }

    html[${attr}="green"] { color-scheme: light !important; background-color: #dce8d5 !important; }
    html[${attr}="green"] [${bgAttr}="1"] { background-color: #dce8d5 !important; }
    html[${attr}="green"] [${bgAttr}="2"] { background-color: #cddcc4 !important; }

    html[${attr}="outdoor"] { color-scheme: light !important; background-color: #fff !important; }
    html[${attr}="outdoor"] [${bgAttr}="1"] { background-color: #fff !important; }
    html[${attr}="outdoor"] [${bgAttr}="2"] { background-color: #e6e6e6 !important; }
    html[${attr}="outdoor"] [${fgAttr}] { color: #000 !important; }
    html[${attr}="outdoor"] :is(a[${fgAttr}], a [${fgAttr}]) { color: #0033a0 !important; }
    html[${attr}="outdoor"] [${bgAttr}="2"] { border-color: #777 !important; }

    /* 网页底色跟随 body，避免内容不够长时下方露出另一种颜色 */
    html[${attr}="night"]:has(> body[${bgAttr}="2"]) { background-color: #14161b !important; }
    html[${attr}="night"]:has(> body[${bgAttr}="1"]) { background-color: #1c1f26 !important; }
    html[${attr}="green"]:has(> body[${bgAttr}="2"]) { background-color: #cddcc4 !important; }
    html[${attr}="outdoor"]:has(> body[${bgAttr}="2"]) { background-color: #e6e6e6 !important; }
  `;

  const style = document.getElementById(styleId) || document.createElement('style');
  style.id = styleId;
  style.textContent = styleText;
  if (!style.isConnected) (document.head || document.documentElement).appendChild(style);

  // ---------- 颜色检测 ----------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE',
    'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'svg', 'IFRAME', 'OBJECT', 'EMBED', 'BR', 'HR']);

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

  // 该元素文字实际所处的背景是否是“浅色底”（白/浅灰/页面底色）
  function onLightBackground(el) {
    for (let node = el, depth = 0; node && node.nodeType === 1 && depth < 40; node = node.parentElement, depth++) {
      if (node.hasAttribute(bgAttr)) return true;
      if (node === document.documentElement) return true;
      const cs = getComputedStyle(node);
      const c = parseColor(cs.backgroundColor);
      if (c && c.a >= 0.5) return false; // 遇到了其它颜色的实底（如彩色按钮、深色栏），不动它
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && node !== el) return false;
    }
    return true;
  }

  function classify(el) {
    if (!el || el.nodeType !== 1 || SKIP.has(el.tagName)) return;
    if (el === document.documentElement) return;
    el.removeAttribute(bgAttr);
    el.removeAttribute(fgAttr);
    const cs = getComputedStyle(el);

    const tier = bgTier(parseColor(cs.backgroundColor));
    if (tier) el.setAttribute(bgAttr, String(tier));

    // 只处理直接含有文字的元素
    let hasText = false;
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.nodeValue.trim()) { hasText = true; break; }
    }
    if (!hasText && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) return;

    const fg = parseColor(cs.color);
    if (!fg) return;
    if (!tier && !onLightBackground(el)) return;
    const lum = luminance(fg);
    const sat = Math.max(fg.r, fg.g, fg.b) - Math.min(fg.r, fg.g, fg.b);
    if (lum < 0.72) el.setAttribute(fgAttr, sat < 60 ? 'gray' : 'dark');
  }

  // ---------- 分批扫描 + 监听新内容 ----------
  let queue = [];
  let head = 0;
  let scheduled = false;
  let enabled = false;

  function enqueueTree(root) {
    if (!root || root.nodeType !== 1) return;
    queue.push(root);
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) queue.push(all[i]);
    schedule();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(work);
  }

  function work() {
    scheduled = false;
    if (!enabled) { queue = []; head = 0; return; }
    const begin = performance.now();
    while (head < queue.length && performance.now() - begin < 12) {
      const el = queue[head++];
      if (el.isConnected) classify(el);
    }
    if (head >= queue.length) { queue = []; head = 0; }
    else schedule();
  }

  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') {
        r.addedNodes.forEach(n => enqueueTree(n));
      } else if (r.type === 'attributes' && r.target.nodeType === 1) {
        const el = r.target;
        if (el.getElementsByTagName('*').length < 400) enqueueTree(el);
        else { queue.push(el); schedule(); }
      }
    }
  });

  function start() {
    if (enabled) return;
    enabled = true;
    const begin = () => {
      if (!enabled) return;
      enqueueTree(document.body || document.documentElement);
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']
      });
    };
    if (document.body) begin();
    else document.addEventListener('DOMContentLoaded', begin, { once: true });
  }

  function stop() {
    enabled = false;
    observer.disconnect();
    queue = [];
    head = 0;
  }

  function apply(mode) {
    if (modeNames.has(mode)) {
      document.documentElement.setAttribute(attr, mode);
      start();
    } else {
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
