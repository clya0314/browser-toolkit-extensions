const buttons = [...document.querySelectorAll('.mode')];
const status = document.querySelector('#status');
const tabPromise = chrome.tabs.query({ active: true, currentWindow: true });

function setActive(mode) {
  buttons.forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  status.textContent = mode ? '此模式已应用到当前网页' : '仅更改网页显示，可随时复原';
}

async function apply(mode) {
  const [tab] = await tabPromise;
  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    status.textContent = 'Chrome 内置页面不支持修改';
    return;
  }
  try {
    const stored = await chrome.storage.local.get(null);
    const legacyKeys = Object.keys(stored).filter(key => key.startsWith('site:'));
    if (legacyKeys.length) await chrome.storage.local.remove(legacyKeys);
    if (mode === 'off') await chrome.storage.local.remove('defaultMode');
    else await chrome.storage.local.set({ defaultMode: mode });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'SET_MODE', mode });
    setActive(mode === 'off' ? null : mode);
  } catch (error) {
    status.textContent = '应用失败，请刷新网页后重试';
    console.error('网页阅读模式应用失败', error);
  }
}

buttons.forEach(button => button.addEventListener('click', () => apply(button.dataset.mode)));
document.querySelector('#reset').addEventListener('click', () => apply('off'));

tabPromise.then(async ([tab]) => {
  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    status.textContent = 'Chrome 内置页面不支持修改';
    buttons.forEach(button => button.disabled = true);
    return;
  }
  const saved = await chrome.storage.local.get('defaultMode');
  setActive(saved.defaultMode || null);
});
