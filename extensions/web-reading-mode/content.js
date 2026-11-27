(() => {
  const attr = 'data-wrm-mode';
  const bgAttr = 'data-wrm-bg';         // 1 = 白/近白底，2 = 浅灰底
  const brightAttr = 'data-wrm-bright'; // 亮色实底（如亮黄按钮），夜间保留原字色
  const darkAttr = 'data-wrm-dark';     // 深色实底，户外模式保留原字色
  const styleId = 'wrm-global-style';
  const modeNames = new Set(['night', 'green', 'outdoor']);

  // 夜间模式采用“CSS 默认全白 + 仅对亮色实底按钮做例外”，从根源杜绝黑底黑字。
  // 用 :not(#_w1#_w2#_w3) 提高选择器优先级，避免被网站自带的 !important 样式压过。
  const HI = ':not(#_w1#_w2#_w3)';
  const NIGHT_FG = `:not([${brightAttr}]):not([${brightAttr}] *)${HI}`;
  const OUTDOOR_FG = `:not([${darkAttr}]):not([${darkAttr}] *)${HI}`;

  const RULES = {
    night: [
      [`[${bgAttr}="1"]${HI}`, 'background-color: #1c1f26 !important; border-color: #333842 !important;'],
      [`[${bgAttr}="2"]${HI}`, 'background-color: #14161b !important; border-color: #333842 !important;'],
      [NIGHT_FG, 'color: #fff !important; -webkit-text-fill-color: #fff !important;'],
      [`:is([${brightAttr}], [${brightAttr}] *)${HI}`, '-webkit-text-fill-color: currentColor !important;'],
      ['::placeholder', 'color: #a0a6b0 !important; -webkit-text-fill-color: #a0a6b0 !important;']
    ],
    green: [
      [`[${bgAttr}="1"]${HI}`, 'background-color: #dce8d5 !important;'],
      [`[${bgAttr}="2"]${HI}`, 'background-color: #cddcc4 !important;']
    ],
    outdoor: [
      [`[${bgAttr}="1"]${HI}`, 'background-color: #fff !important;'],
      [`[${bgAttr}="2"]${HI}`, 'background-color: #e6e6e6 !important; border-color: #777 !important;'],
      [OUTDOOR_FG, 'color: #000 !important; -webkit-text-fill-color: #000 !important;'],
      [`:is([${darkAttr}], [${darkAttr}] *)${HI}`, '-webkit-text-fill-color: currentColor !important;']
    ]
  };

  const docCss = [
    `html[${attr}="night"], html[${attr}="night"] body { color-scheme: dark !important; background-color: #14161b !important; }`,
    `html[${attr}="green"] { color-scheme: light !important; background-color: #dce8d5 !important; }`,
    `html[${attr}="outdoor"] { color-scheme: light !important; background-color: #fff !important; }`,
    ...Object.entries(RULES).flatMap(([m, list]) => list.map(([sel, decl]) => `html[${attr}="${m}"] ${sel} { ${decl} }`)),
    `html[${attr}="night"]:has(> body[${bgAttr}="1"]) { background-color: #1c1f26 !important; }`,
    `html[${attr}="green"]:has(> body[${bgAttr}="2"]) { background-color: #cddcc4 !important; }`,
    `html[${attr}="outdoor"]:has(> body[${bgAttr}="2"]) { background-color: #e6e6e6 !important; }`
  ].join('\n');

  const shadowCssFor = m => (RULES[m] || []).map(([sel, decl]) => `${sel} { ${decl} }`).join('\n');

  const style = document.getElementById(styleId) || document.createElement('style');
  style.id = styleId;
  style.textContent = docCss;
  if (!style.isConnected) (document.head || document.documentElement).appendChild(style);

  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE',
    'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'svg', 'IFRAME', 'OBJECT', 'EMBED', 'BR', 'HR']);

  let mode = null;
  let enabled = false;

  function parseColor(v) {
    const m = v && v.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function shadowOf(el) {
    try {
      return (chrome.dom?.openOrClosedShadowRoot?.(el)) || el.shadowRoot || null;
    } catch {
      return el.shadowRoot || null;
    }
  }

  // 只检测元素自身背景色：白/浅灰底替换，亮色/深色实底做字色例外
  function classify(el, fresh) {
    if (!el || el.nodeType !== 1 || SKIP.has(el.tagName)) return;
    const sr = shadowOf(el);
    if (sr) registerRoot(sr);
    if (el === document.documentElement) return;
    if (!fresh && (el.hasAttribute(bgAttr) || el.hasAttribute(brightAttr) || el.hasAttribute(darkAttr))) return;
    if (fresh) {
      el.removeAttribute(bgAttr);
      el.removeAttribute(brightAttr);
      el.removeAttribute(darkAttr);
    }
    const c = parseColor(getComputedStyle(el).backgroundColor);
    if (!c || c.a < 0.5) return;
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    const sat = max - min;
    if (min >= 247 && sat <= 15) { el.setAttribute(bgAttr, '1'); return; }
    if (min >= 205 && sat <= 35) { el.setAttribute(bgAttr, '2'); return; }
    const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    if (lum >= 0.62) el.setAttribute(brightAttr, '1');
    else if (lum < 0.45) el.setAttribute(darkAttr, '1');
  }

  // ---------- Shadow DOM ----------
  let sheet = null;
  try { sheet = new CSSStyleSheet(); } catch {}
  let roots = new Set();
  let rootSeen = new WeakSet();

  function attachSheet(root) {
    if (sheet) {
      try {
        if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return;
      } catch { sheet = null; }
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
    if (sheet) { try { sheet.replaceSync(css); } catch {} }
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

  document.addEventListener('wrm-shadow-attached', e => {
    if (!enabled) return;
    const host = e.composedPath()[0];
    const sr = host?.nodeType === 1 && shadowOf(host);
    if (sr) registerRoot(sr);
  }, true);

  // ---------- 分批扫描 + 监听新内容 ----------
  let queue = [];
  let head = 0;
  let sweep = null;
  let sweepIdx = 0;
  let scheduled = false;

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

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(work);
  }

  function work() {
    scheduled = false;
    if (!enabled) { queue = []; head = 0; sweep = null; return; }
    const t0 = performance.now();
    while (head < queue.length && performance.now() - t0 < 12) {
      const el = queue[head++];
      if (el.isConnected) classify(el, true);
    }
    if (head >= queue.length) { queue = []; head = 0; }
    while (sweep && sweepIdx < sweep.length && performance.now() - t0 < 12) {
      const el = sweep[sweepIdx++];
      if (el.isConnected) classify(el, false);
    }
    if (sweep && sweepIdx >= sweep.length) sweep = null;
    if (head < queue.length || sweep) schedule();
  }

  function startSweep() {
    if (!enabled || sweep || document.hidden) return;
    const base = document.body || document.documentElement;
    const list = [base, ...base.getElementsByTagName('*')];
    for (const r of roots) {
      if (!r.host?.isConnected) { roots.delete(r); continue; }
      attachSheet(r);
      list.push(...r.querySelectorAll('*'));
    }
    sweep = list;
    sweepIdx = 0;
    schedule();
  }

  let sweepTimer = 0;
  const onScroll = () => {
    if (!enabled || sweepTimer) return;
    sweepTimer = setTimeout(() => { sweepTimer = 0; startSweep(); }, 250);
  };

  const OBSERVE = { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] };
  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') {
        r.addedNodes.forEach(n => { if (n.nodeType === 1) enqueueTree(n); });
      } else if (r.type === 'attributes' && r.target.nodeType === 1) {
        const el = r.target;
        if (el.getElementsByTagName('*').length < 400) enqueueTree(el);
        else { queue.push(el); schedule(); }
      }
    }
  });

  let interval = 0;

  function fullScan() {
    queue = []; head = 0; sweep = null;
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
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => { if (enabled) fullScan(); }, { once: true });
    }
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    interval = setInterval(startSweep, 2500);
  }

  function stop() {
    enabled = false;
    observer.disconnect();
    removeEventListener('scroll', onScroll, { capture: true });
    clearInterval(interval);
    clearTimeout(sweepTimer);
    sweepTimer = 0; queue = []; head = 0; sweep = null;
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
      else { updateShadowCss(); if (changed && document.body) fullScan(); }
    } else {
      mode = null;
      document.documentElement.removeAttribute(attr);
      stop();
    }
  }

  // 弹窗重复注入时先停掉旧实例
  window.__wrmStop?.();
  window.__wrmStop = stop;
  window.__wrmApply = apply;
  if (!window.__wrmListenerInstalled) {
    window.__wrmListenerInstalled = true;
    chrome.runtime.onMessage.addListener(m => { if (m?.type === 'SET_MODE') window.__wrmApply?.(m.mode); });
    chrome.storage.onChanged.addListener((c, a) => { if (a === 'local' && c.defaultMode) window.__wrmApply?.(c.defaultMode.newValue); });
  }

  chrome.storage.local.get('defaultMode').then(({ defaultMode }) => window.__wrmApply?.(defaultMode));
})();
