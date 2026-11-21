function bindSlider(sliderId, valId, key) {
  var s = document.getElementById(sliderId);
  var v = document.getElementById(valId);
  chrome.storage.local.get(key, function (r) {
    var n = (r && typeof r[key] === 'number') ? r[key] : 0;
    s.value = n;
    v.textContent = n;
  });
  s.addEventListener('input', function () {
    var n = Number(s.value);
    v.textContent = n;
    var o = {}; o[key] = n;
    chrome.storage.local.set(o);
  });
}
bindSlider('s1', 'v1', 'brightenLevel');
bindSlider('s2', 'v2', 'volumeLevel');

var auto = document.getElementById('auto');
chrome.storage.local.get('autoLevel', function (r) {
  auto.checked = !!(r && r.autoLevel);
});
auto.addEventListener('change', function () {
  chrome.storage.local.set({ autoLevel: auto.checked });
});
