(function () {
  var ORIGINAL_FILTER_ATTR = 'data-yl-gamma-original-filter';
  var FILTER_ID = 'yl-shadow-lift-filter';
  var level = 0;        // 画面提亮 0-100
  var volLevel = 0;     // 声音放大 0-100
  var auto = false;     // 自动拉平音量

  /* ================= 画面：暗部提亮曲线 =================
     旧版用 CSS brightness() —— 它是把所有像素整体乘一个倍数，
     亮的地方会先“爆白”（刺眼、画面变样），暗处却提得不多。
     新版和播放器的 Gamma 调节同原理：用一条亮度曲线，
     黑的地方往上抬得多、亮的地方几乎不动，白色永远还是白色，不会过曝。
     曲线：y = x + a·x·(1-x)²  —— 只抬暗部和中间调，纯黑保持够黑，不会发灰。 */
  var svgRoot = null;
  var funcs = null;
  var satNode = null;

  function curveTable(t) {
    var a = 2.8 * t;           // 提亮强度（a < 3 保证曲线单调，不会出现颜色反转）
    var pts = [];
    for (var i = 0; i <= 32; i++) {
      var x = i / 32;
      var y = x + a * x * (1 - x) * (1 - x);
      pts.push(Math.min(1, y).toFixed(4));
    }
    return pts.join(' ');
  }

  function ensureFilter() {
    if (svgRoot && svgRoot.isConnected) return;
    var NS = 'http://www.w3.org/2000/svg';
    svgRoot = document.createElementNS(NS, 'svg');
    svgRoot.setAttribute('aria-hidden', 'true');
    svgRoot.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
    var filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', FILTER_ID);
    filter.setAttribute('color-interpolation-filters', 'sRGB'); // 按画面原本的亮度编码来调，和播放器一致
    var transfer = document.createElementNS(NS, 'feComponentTransfer');
    funcs = ['feFuncR', 'feFuncG', 'feFuncB'].map(function (name) {
      var f = document.createElementNS(NS, name);
      f.setAttribute('type', 'table');
      transfer.appendChild(f);
      return f;
    });
    // 提亮后颜色会变淡，稍微补一点饱和度
    satNode = document.createElementNS(NS, 'feColorMatrix');
    satNode.setAttribute('type', 'saturate');
    filter.appendChild(transfer);
    filter.appendChild(satNode);
    svgRoot.appendChild(filter);
    (document.body || document.documentElement).appendChild(svgRoot);
  }

  var lastLevel = -1;
  function updateFilter() {
    ensureFilter();
    if (level === lastLevel) return;
    lastLevel = level;
    var t = level / 100;
    var table = curveTable(t);
    funcs.forEach(function (f) { f.setAttribute('tableValues', table); });
    satNode.setAttribute('values', (1 + 0.25 * t).toFixed(3));
  }

  function applyVideoFilter(v) {
    if (level === 0) {
      if (v.hasAttribute(ORIGINAL_FILTER_ATTR)) {
        var saved = v.getAttribute(ORIGINAL_FILTER_ATTR);
        if (saved) v.style.setProperty('filter', saved);
        else v.style.removeProperty('filter');
        v.removeAttribute(ORIGINAL_FILTER_ATTR);
      }
      return;
    }
    if (!v.hasAttribute(ORIGINAL_FILTER_ATTR)) {
      v.setAttribute(ORIGINAL_FILTER_ATTR, v.style.getPropertyValue('filter'));
    }
    var want = 'url("#' + FILTER_ID + '")';
    if (v.style.getPropertyValue('filter') !== want) v.style.setProperty('filter', want, 'important');
  }

  /* ================= 声音：增益 + 人声清晰 + 限幅器 =================
     旧版只是把音量乘大，但网页视频本身通常已经接近满幅，
     再放大就直接“削顶”（破音），听起来并没有更响。
     新版：先放大 → 稍微突出人声频段 → 用限幅器把峰值压在安全线以下。
     这样小声的部分真正被抬上来，整体响度明显变大，又不会破音。 */
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
      var leveler = ctx.createDynamicsCompressor(); // 自动拉平：压缩忽大忽小
      var levelerGain = ctx.createGain();           // 拉平后的补偿
      var preGain = ctx.createGain();               // 声音放大
      var voice = ctx.createBiquadFilter();         // 人声清晰
      var limiter = ctx.createDynamicsCompressor(); // 限幅，防破音
      var out = ctx.createGain();
      voice.type = 'peaking';
      voice.frequency.value = 2800;
      voice.Q.value = 0.8;
      voice.gain.value = 0;
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      src.connect(leveler);
      leveler.connect(levelerGain);
      levelerGain.connect(preGain);
      preGain.connect(voice);
      voice.connect(limiter);
      limiter.connect(out);
      out.connect(ctx.destination);
      var g = { leveler: leveler, levelerGain: levelerGain, preGain: preGain, voice: voice, limiter: limiter, out: out };
      graphs.set(v, g);
      v.addEventListener('play', resume);
      resume();
      return g;
    } catch (e) { graphs.set(v, false); return false; }
  }

  function updateAudio(g) {
    if (!g || !ctx) return;
    var t = ctx.currentTime, c = g.leveler;
    var x = volLevel / 100;
    // 0-100 → 0 ~ +24 dB。分贝本身就符合人耳感受，前半段也能明显听出变化。
    var db = volLevel <= 0 ? 0 : 24 * Math.pow(x, 0.85);
    g.preGain.gain.setTargetAtTime(dbToGain(db), t, 0.03);
    g.voice.gain.setTargetAtTime(4 * x, t, 0.05);
    if (auto) {
      c.threshold.setTargetAtTime(-30, t, 0.08);
      c.knee.setTargetAtTime(10, t, 0.08);
      c.ratio.setTargetAtTime(4, t, 0.08);
      c.attack.setTargetAtTime(0.01, t, 0.08);
      c.release.setTargetAtTime(0.3, t, 0.08);
      g.levelerGain.gain.setTargetAtTime(dbToGain(8), t, 0.08);
    } else {
      c.threshold.setTargetAtTime(0, t, 0.05);
      c.knee.setTargetAtTime(0, t, 0.05);
      c.ratio.setTargetAtTime(1, t, 0.05);
      g.levelerGain.gain.setTargetAtTime(1, t, 0.05);
    }
  }

  /* ================= 统一刷新 ================= */
  function apply() {
    var videos = document.querySelectorAll('video');
    if (level > 0 && videos.length) updateFilter();
    videos.forEach(function (v) {
      applyVideoFilter(v);
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
