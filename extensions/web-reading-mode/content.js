(() => {
  const attr = 'data-wrm-mode';
  const styleId = 'wrm-global-style';
  const modeNames = new Set(['night', 'green', 'outdoor']);

  const styleText = `
    html[${attr}="night"] {
      color-scheme: dark !important;
      background: #111318 !important;
    }
    html[${attr}="night"] body {
      color: #e5e7eb !important;
      background: #111318 !important;
    }
    html[${attr}="night"] body * {
      color: #e5e7eb !important;
    }
    html[${attr}="night"] body :is(main, article, section, aside, nav, header, footer, div, p, li, td, th, blockquote, figure, form) {
      background-color: transparent !important;
    }
    html[${attr}="night"] body :is(a, a *, [role="link"]) {
      color: #9fc5ff !important;
    }
    html[${attr}="night"] body :is(button, input, select, textarea) {
      color-scheme: dark !important;
    }

    html[${attr}="green"] {
      color-scheme: light !important;
      background: #dce8d5 !important;
    }
    html[${attr}="green"] body {
      background-color: #dce8d5 !important;
    }
    html[${attr}="green"] body :is(main, article, section, aside, nav, header, footer, div, p, li, td, th, blockquote) {
      background-color: transparent !important;
    }

    html[${attr}="outdoor"] {
      color-scheme: light !important;
      background: #fff !important;
    }
    html[${attr}="outdoor"] body {
      color: #111 !important;
      background: #fff !important;
    }
    html[${attr}="outdoor"] body :is(main, article, section, aside, nav, header, footer, div, p, li, td, th, blockquote, figure, form) {
      background-color: transparent !important;
    }
    html[${attr}="outdoor"] body :is(a, a *, [role="link"]) {
      color: #0645ad !important;
    }
  `;

  const style = document.getElementById(styleId) || document.createElement('style');
  style.id = styleId;
  style.textContent = styleText;
  if (!style.isConnected) (document.head || document.documentElement).appendChild(style);

  function apply(mode) {
    if (modeNames.has(mode)) document.documentElement.setAttribute(attr, mode);
    else document.documentElement.removeAttribute(attr);
  }

  // The popup may reinject a newer version into an already-open tab.
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
