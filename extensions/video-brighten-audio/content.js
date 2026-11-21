(function () {
  var ORIGINAL_FILTER_ATTR = 'data-yl-gamma-original-filter';
  var level = 0;        // 画面提亮 0-100
  var volLevel = 0;     // 声音放大 0-100
  var auto = false;     // 自动拉平音量
  /* ---------------- 画面：0 档完全不加滤镜 ---------------- */

  /* ---------------- 声音：用户启用后使用 Web Audio 增益与压缩 ----------------
     移除快速噪声门：它会把底噪切成忽有忽无的抽吸声。自动拉平只压峰值，
     手动增强由独立增益节点控制，滑块 0-100 对应 0 至 +30 dB。 */
  var ctx = null;
  var graphs = new WeakMap();

  function dbToGain(db) { return Math.pow(10, db / 20); }
  function resume() { if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} } }

  function ensureAudio(v) {
    if (graphs.has(v)) return graphs.get(v);
    if (volLevel <= 0 && !auto) return null;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      var src = ctx.createMediaElementSource(v);
      var preGain = ctx.createGain();
      var comp = ctx.createDynamicsCompressor();
      var gain = ctx.createGain();
      src.connect(preGain);
      preGain.connect(comp);
      comp.connect(gain);
      gain.connect(ctx.destination);
      var g = { preGain: preGain, comp: comp, gain: gain };
      graphs.set(v, g);
      v.addEventListener('play', resume);
      resume();
      return g;
    } catch (e) { graphs.set(v, false); return false; }
  }

  function updateAudio(g) {
    if (!g || !ctx) return;
    var t = ctx.currentTime, c = g.comp;
    // 先把小音量信号抬起来，再由压缩器控制峰值；100 档提升约 24 dB。
    var db = volLevel <= 0 ? 0 : 24 * Math.pow(volLevel / 100, 0.7);
    g.preGain.gain.setTargetAtTime(dbToGain(db), t, 0.04);
    if (auto) {
      c.threshold.setTargetAtTime(-24, t, 0.08);
      c.knee.setTargetAtTime(12, t, 0.08);
      c.ratio.setTargetAtTime(3, t, 0.08);
      c.attack.setTargetAtTime(0.01, t, 0.08);
      c.release.setTargetAtTime(0.25, t, 0.08);
    } else {
      c.threshold.setTargetAtTime(0, t, 0.05);
      c.knee.setTargetAtTime(0, t, 0.05);
      c.ratio.setTargetAtTime(1, t, 0.05);
    }
    // 输出增益保持为 1，避免滑块增益重复叠加。
    g.gain.gain.setTargetAtTime(1, t, 0.04);
  }

  /* ---------------- 统一刷新 ---------------- */
  function apply() {
    var brightness = (1 + 1.5 * level / 100).toFixed(2);
    document.querySelectorAll('video').forEach(function (v) {
      // level 0: 不设置 filter，完全交还页面原有渲染；若之前加过插件滤镜则撤销。
      if (level === 0) {
        if (v.hasAttribute(ORIGINAL_FILTER_ATTR)) {
          var saved = v.getAttribute(ORIGINAL_FILTER_ATTR);
          if (saved) v.style.setProperty('filter', saved);
          else v.style.removeProperty('filter');
          v.removeAttribute(ORIGINAL_FILTER_ATTR);
        }
      } else {
        if (!v.hasAttribute(ORIGINAL_FILTER_ATTR)) {
          v.setAttribute(ORIGINAL_FILTER_ATTR, v.style.getPropertyValue('filter'));
        }
        v.style.setProperty('filter', 'brightness(' + brightness + ')', 'important');
      }
      var g = ensureAudio(v);
      if (g) updateAudio(g);
    });
    resume();
  }

  document.addEventListener('click', resume, true);
  document.addEventListener('keydown', resume, true);

  chrome.storage.local.get(['brightenLevel', 'volumeLevel', 'autoLevel'], function (r) {
    if (r && typeof r.brightenLevel === 'number') level = r.brightenLevel;
    if (r && typeof r.volumeLevel === 'number') volLevel = r.volumeLevel;
    auto = !!(r && r.autoLevel);
    apply();
    setInterval(apply, 1000);
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.brightenLevel) level = Number(changes.brightenLevel.newValue) || 0;
    if (changes.volumeLevel) volLevel = Number(changes.volumeLevel.newValue) || 0;
    if (changes.autoLevel) auto = !!changes.autoLevel.newValue;
    apply();
  });
})();
