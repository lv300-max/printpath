function toast(msg, duration) {
  duration = duration || 2400;
  var el = document.getElementById('pp-toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(function() { el.classList.remove('show'); }, duration);
}

function starPoints(cx, cy, outerR, innerR, points) {
  var pts = [];
  for (var i = 0; i < points * 2; i++) {
    var angle = (Math.PI / points) * i - Math.PI / 2;
    var r = i % 2 === 0 ? outerR : innerR;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

function polygonPoints(cx, cy, r, sides) {
  var pts = [];
  for (var i = 0; i < sides; i++) {
    var angle = (2 * Math.PI / sides) * i - Math.PI / 2;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

function isValidHex(h) {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(h);
}

function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

function downloadDataURL(dataURL, filename) {
  var a = document.createElement('a');
  a.href = dataURL; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function() { document.body.removeChild(a); }, 300);
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}
