// 运行在网页自身环境：网页新建 Shadow DOM（如 B 站评论区）时通知阅读模式脚本，
// 让它马上给里面的文字换色。只发通知，不改变网页任何行为。
(() => {
  if (window.__wrmShadowHook) return;
  window.__wrmShadowHook = true;
  const original = Element.prototype.attachShadow;
  if (typeof original !== 'function') return;
  Element.prototype.attachShadow = function attachShadow(init) {
    const root = original.call(this, init);
    if (this.isConnected) {
      try {
        this.dispatchEvent(new Event('wrm-shadow-attached', { bubbles: true, composed: true }));
      } catch {}
    }
    return root;
  };
})();
