var STATE = {
  mode: 'sticker',
  artboardW: 1000,
  artboardH: 1000,
  zoom: 1,
  showGuides: true,
  showSafeArea: true,
  snapEnabled: true,
  dieCutShape: 'none',
  safeMargin: 20,
  bleed: 10,
  dpi: 0,
  printReady: false,
  layersOpen: true,
};

var PRINT_SWATCHES = [
  '#000000','#ffffff','#1a1a2e','#0d1b2a',
  '#c0c0c0','#808080','#ff0000','#cc0000',
  '#0000ff','#0033cc','#00aa00','#007700',
  '#ffcc00','#ff6600','#ff00ff','#00ffff',
];

var canvas;

window.addEventListener('load', function() {
  canvas = new fabric.Canvas('logo-canvas', {
    width: STATE.artboardW,
    height: STATE.artboardH,
    backgroundColor: '#000000',
    preserveObjectStacking: true,
    selection: true,
  });

  buildSwatches();
  calcDPI();
  renderLayers();
  fitCanvasToWindow();

  canvas.on('selection:created', onSelect);
  canvas.on('selection:updated', onSelect);
  canvas.on('selection:cleared', onDeselect);
  canvas.on('object:modified', function() { _clearSnapLines(); renderLayers(); updateTransformFields(); applyContourCut(); calcDPI(); });
  canvas.on('object:moving', onObjectMoving);
  canvas.on('mouse:up', function() { _clearSnapLines(); calcDPI(); });
  canvas.on('object:scaling', function() { calcDPI(); });
  canvas.on('object:added', function() { renderLayers(); applyContourCut(); calcDPI(); });
  canvas.on('object:removed', function() { renderLayers(); applyContourCut(); calcDPI(); });

  document.addEventListener('keydown', handleKey);
  document.getElementById('img-upload').addEventListener('change', handleImageUpload);
  window.addEventListener('resize', fitCanvasToWindow);

  // Drag-and-drop onto upload zone and canvas wrapper
  var dropTargets = [
    document.getElementById('upload-zone'),
    document.querySelector('.canvas-wrapper'),
  ];
  dropTargets.forEach(function(el) {
    if (!el) return;
    el.addEventListener('dragover', function(e) {
      e.preventDefault();
      el.classList.add('pp-drop-active');
    });
    el.addEventListener('dragleave', function() {
      el.classList.remove('pp-drop-active');
    });
    el.addEventListener('drop', function(e) {
      e.preventDefault();
      el.classList.remove('pp-drop-active');
      var file = e.dataTransfer.files[0];
      if (file) handleImageUpload({ target: { files: [file], value: '' } });
    });
  });

  // Start in sticker mode — black canvas, contour cut ready
  setMode('sticker');
  canvas.setOverlayColor('rgba(255,255,255,0.03)', canvas.renderAll.bind(canvas));

  var saved = localStorage.getItem('pp_logo_project');
  if (saved) {
    try {
      canvas.loadFromJSON(JSON.parse(saved), function() {
        canvas.renderAll(); renderLayers(); calcDPI();
        toast('✦ Project restored');
      });
    } catch(e) {}
  }
});

/* ── ARTBOARD ── */
function setArtboard(w, h) {
  STATE.artboardW = w;
  STATE.artboardH = h;
  canvas.setWidth(w);
  canvas.setHeight(h);
  canvas.renderAll();
  document.getElementById('artboard-info').textContent     = w + ' × ' + h + ' px';
  document.getElementById('canvas-size-label').textContent = w + ' × ' + h + ' px';
  document.getElementById('pi-canvas').textContent         = w + ' × ' + h + ' px';
  document.querySelectorAll('.preset-btn').forEach(function(b) {
    b.classList.toggle('active', parseInt(b.dataset.size) === w);
  });
  applyZoom(STATE.zoom);
  calcDPI();
  toast('Artboard: ' + w + ' × ' + h + ' px');
}

function fitCanvasToWindow() {
  var outer  = document.getElementById('canvas-outer');
  var scaleX = (outer.clientWidth  - 80) / STATE.artboardW;
  var scaleY = (outer.clientHeight - 80) / STATE.artboardH;
  applyZoom(parseFloat(Math.min(scaleX, scaleY, 1).toFixed(2)));
}

/* ── ZOOM ── */
function applyZoom(z) {
  STATE.zoom = clamp(z, 0.05, 4);
  var wrapper = document.getElementById('canvas-wrapper');
  wrapper.style.transform = 'scale(' + STATE.zoom + ')';
  wrapper.style.transformOrigin = 'center center';
  document.getElementById('zoom-label').textContent = Math.round(STATE.zoom * 100) + '%';
}
function zoomIn()  { applyZoom(STATE.zoom + 0.1); }
function zoomOut() { applyZoom(STATE.zoom - 0.1); }
function zoomFit() { fitCanvasToWindow(); }

/* ── GUIDES ── */
function toggleGuides() {
  STATE.showGuides = document.getElementById('show-guides').checked;
  var d = STATE.showGuides ? 'block' : 'none';
  document.getElementById('guide-h').style.display = d;
  document.getElementById('guide-v').style.display = d;
}
function toggleSafeArea() {
  STATE.showSafeArea = document.getElementById('show-safearea').checked;
  document.getElementById('safe-area').style.display = STATE.showSafeArea ? 'block' : 'none';
}

/* ── MODE ── */
function setMode(mode) {
  STATE.mode = mode;
  document.querySelectorAll('.mode-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  var label = document.getElementById('diecut-mode-label');
  if (mode === 'sticker') {
    label.textContent = '— Sticker';
    canvas.setBackgroundColor('#000000', canvas.renderAll.bind(canvas));
    document.getElementById('cut-shape').value = 'contour';
    applyDieCut();
    setTimeout(applyContourCut, 100);
    toast('✦ Sticker Mode — transparent bg, contour cut on');
  } else {
    label.textContent = '— Logo';
    canvas.setBackgroundColor('#ffffff', canvas.renderAll.bind(canvas));
    document.getElementById('cut-shape').value = 'none';
    applyDieCut();
    // Remove any sticker cut line
    canvas.getObjects().filter(function(o) { return o.ppDieCut; }).forEach(function(o) { canvas.remove(o); });
    toast('✦ Logo Mode');
  }
  canvas.renderAll();
}

/* ── ADD TEXT ── */
function addText() {
  var t = new fabric.IText('LOGO TEXT', {
    left: STATE.artboardW / 2,
    top: STATE.artboardH / 2,
    originX: 'center', originY: 'center',
    fontFamily: 'Impact',
    fontSize: Math.round(STATE.artboardW * 0.1),
    fontWeight: 'bold',
    fill: '#000000',
    charSpacing: 40,
    _type: 'text',
  });
  canvas.add(t);
  canvas.setActiveObject(t);
  canvas.renderAll();
  toast('Text added — double-click to edit');
}

/* ── ADD SHAPE ── */
function addShape(type) {
  var cx = STATE.artboardW / 2;
  var cy = STATE.artboardH / 2;
  var s  = Math.round(STATE.artboardW * 0.25);
  var obj;
  var base = { left: cx, top: cy, originX: 'center', originY: 'center' };

  switch (type) {
    case 'rect':
      obj = new fabric.Rect(Object.assign({}, base, { width: s, height: s, fill: '#000000', _type: 'rect' }));
      break;
    case 'circle':
      obj = new fabric.Circle(Object.assign({}, base, { radius: s / 2, fill: '#000000', _type: 'circle' }));
      break;
    case 'rounded':
      obj = new fabric.Rect(Object.assign({}, base, { width: s, height: s, rx: 24, ry: 24, fill: '#000000', _type: 'rounded' }));
      break;
    case 'triangle':
      obj = new fabric.Triangle(Object.assign({}, base, { width: s, height: s, fill: '#000000', _type: 'triangle' }));
      break;
    case 'star':
      obj = new fabric.Polygon(starPoints(0, 0, s/2, s/4, 5), Object.assign({}, base, { fill: '#000000', _type: 'star' }));
      break;
    case 'hexagon':
      obj = new fabric.Polygon(polygonPoints(0, 0, s/2, 6), Object.assign({}, base, { fill: '#000000', _type: 'hexagon' }));
      break;
  }

  if (obj) {
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
    toast(type + ' added');
  }
}

/* ── IMAGE UPLOAD ── */
function triggerImageUpload() {
  document.getElementById('img-upload').click();
}

function handleImageUpload(e) {
  var file = e.target.files[0];
  if (!file) return;
  var allowed = ['image/png','image/jpeg','image/svg+xml','image/webp','image/gif'];
  if (!allowed.includes(file.type) && !file.name.toLowerCase().match(/\.(png|jpg|jpeg|svg|webp|gif)$/)) {
    toast('⚠ Please upload a PNG, JPG, SVG or WebP file');
    return;
  }
  if (file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml') {
    var reader = new FileReader();
    reader.onload = function(ev) {
      fabric.loadSVGFromString(ev.target.result, function(objs, opts) {
        var group = fabric.util.groupSVGElements(objs, opts);
        group.scaleToWidth(Math.round(STATE.artboardW * 0.4));
        group.set({ left: STATE.artboardW/2, top: STATE.artboardH/2, originX: 'center', originY: 'center', _type: 'svg' });
        canvas.add(group);
        canvas.setActiveObject(group);
        canvas.renderAll();
        toast('SVG placed');
      });
    };
    reader.readAsText(file);
  } else {
    var reader2 = new FileReader();
    reader2.onload = function(ev) {
      fabric.Image.fromURL(ev.target.result, function(img) {
        img.scaleToWidth(Math.round(STATE.artboardW * 0.4));
        img.set({ left: STATE.artboardW/2, top: STATE.artboardH/2, originX: 'center', originY: 'center', _type: 'image' });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
        toast('Image placed');
      }, { crossOrigin: 'anonymous' });
    };
    reader2.readAsDataURL(file);
  }
  if (e.target && e.target.value !== undefined) { try { e.target.value = ''; } catch(ex) {} }
}

/* ── SELECTION ── */
function onSelect() {
  var obj = canvas.getActiveObject();
  if (!obj) return;
  updateTransformFields();
  updateColorFields(obj);
  updateTextPanel(obj);
  renderLayers();
}

function onDeselect() {
  document.getElementById('text-panel').style.display = 'none';
  renderLayers();
}

function updateTransformFields() {
  var obj = canvas.getActiveObject();
  if (!obj) return;
  var b = obj.getBoundingRect();
  document.getElementById('tf-x').value = Math.round(obj.left);
  document.getElementById('tf-y').value = Math.round(obj.top);
  document.getElementById('tf-w').value = Math.round(b.width);
  document.getElementById('tf-h').value = Math.round(b.height);
  document.getElementById('tf-r').value = Math.round(obj.angle || 0);
  document.getElementById('obj-coords').textContent = 'X: ' + Math.round(obj.left) + '  Y: ' + Math.round(obj.top);
  document.getElementById('obj-dims').textContent   = 'W: ' + Math.round(b.width)  + '  H: ' + Math.round(b.height);
  document.getElementById('obj-rot').textContent    = 'R: ' + Math.round(obj.angle || 0) + '°';
}

function applyTransform(prop, val) {
  var obj = canvas.getActiveObject();
  if (!obj) return;
  val = parseFloat(val);
  if (isNaN(val)) return;
  if (prop === 'x') obj.set('left', val);
  else if (prop === 'y') obj.set('top', val);
  else if (prop === 'r') obj.set('angle', val);
  else if (prop === 'w') {
    var cw = obj.getBoundingRect().width;
    if (cw > 0) obj.scaleX = (obj.scaleX || 1) * (val / cw);
  } else if (prop === 'h') {
    var ch = obj.getBoundingRect().height;
    if (ch > 0) obj.scaleY = (obj.scaleY || 1) * (val / ch);
  }
  obj.setCoords();
  canvas.renderAll();
  updateTransformFields();
}

/* ── COLOR ── */
function updateColorFields(obj) {
  var fill   = typeof obj.fill   === 'string' ? obj.fill   : '#000000';
  var stroke = typeof obj.stroke === 'string' ? obj.stroke : '#000000';
  var sw = obj.strokeWidth || 0;
  var op = Math.round((obj.opacity || 1) * 100);

  document.getElementById('fill-color').value  = fill.startsWith('#')   ? fill   : '#000000';
  document.getElementById('fill-hex').value    = fill;
  document.getElementById('fill-preview').style.background   = fill;

  document.getElementById('stroke-color').value = stroke.startsWith('#') ? stroke : '#000000';
  document.getElementById('stroke-hex').value   = stroke;
  document.getElementById('stroke-preview').style.background = stroke;

  document.getElementById('stroke-width').value          = sw;
  document.getElementById('stroke-width-val').textContent = sw;
  document.getElementById('obj-opacity').value           = op;
  document.getElementById('obj-opacity-val').textContent  = op + '%';
}

function applyColor(type, val) {
  var obj = canvas.getActiveObject();
  if (!obj) return;
  if (type === 'fill') {
    obj.set('fill', val);
    document.getElementById('fill-preview').style.background = val;
    document.getElementById('fill-hex').value = val;
  } else {
    obj.set('stroke', val);
    document.getElementById('stroke-preview').style.background = val;
    document.getElementById('stroke-hex').value = val;
  }
  canvas.renderAll();
}

function applyHex(type, val) {
  if (!isValidHex(val)) return;
  applyColor(type, val);
  document.getElementById(type === 'fill' ? 'fill-color' : 'stroke-color').value = val;
}

function applyStrokeWidth(val) {
  var obj = canvas.getActiveObject();
  if (obj) { obj.set('strokeWidth', parseInt(val)); canvas.renderAll(); }
  document.getElementById('stroke-width-val').textContent = val;
}

function applyOpacity(val) {
  var obj = canvas.getActiveObject();
  if (obj) { obj.set('opacity', val / 100); canvas.renderAll(); }
  document.getElementById('obj-opacity-val').textContent = val + '%';
}

function buildSwatches() {
  var row = document.getElementById('swatch-row');
  PRINT_SWATCHES.forEach(function(color) {
    var s = document.createElement('div');
    s.className = 'swatch';
    s.style.background = color;
    s.title = color;
    if (color === '#ffffff') s.style.border = '1px solid rgba(255,255,255,0.25)';
    s.onclick = function() { applyColor('fill', color); };
    row.appendChild(s);
  });
}

/* ── TEXT ── */
function updateTextPanel(obj) {
  var isText = obj.type === 'i-text' || obj.type === 'text';
  document.getElementById('text-panel').style.display = isText ? 'flex' : 'none';
  if (!isText) return;
  document.getElementById('font-family').value    = obj.fontFamily || 'Impact';
  document.getElementById('font-size').value      = obj.fontSize   || 72;
  document.getElementById('font-weight').value    = obj.fontWeight || 'bold';
  var ls = Math.round((obj.charSpacing || 0) / 10);
  document.getElementById('letter-spacing').value = ls;
  document.getElementById('letter-spacing-val').textContent = ls;
  document.getElementById('line-height').value    = obj.lineHeight || 1.2;
  document.getElementById('line-height-val').textContent    = obj.lineHeight || 1.2;
  var isUpper = obj.text && obj.text === obj.text.toUpperCase() && obj.text.trim().length > 0;
  document.getElementById('uppercase-btn').classList.toggle('active', isUpper);
}

function applyTextProp(prop, val) {
  var obj = canvas.getActiveObject();
  if (!obj || (obj.type !== 'i-text' && obj.type !== 'text')) return;
  obj.set(prop, val);
  canvas.renderAll();
  if (prop === 'charSpacing') {
    var v = Math.round(val / 10);
    document.getElementById('letter-spacing').value = v;
    document.getElementById('letter-spacing-val').textContent = v;
  }
  if (prop === 'lineHeight') {
    document.getElementById('line-height').value = val;
    document.getElementById('line-height-val').textContent = val;
  }
}

function toggleUppercase() {
  var obj = canvas.getActiveObject();
  if (!obj || (obj.type !== 'i-text' && obj.type !== 'text')) return;
  var isUpper = obj.text === obj.text.toUpperCase();
  obj.set('text', isUpper ? obj.text.toLowerCase() : obj.text.toUpperCase());
  canvas.renderAll();
  document.getElementById('uppercase-btn').classList.toggle('active', !isUpper);
}

/* ── ARRANGE ── */
function bringForward()   { var o = canvas.getActiveObject(); if (o) { canvas.bringForward(o);  renderLayers(); } }
function sendBackward()   { var o = canvas.getActiveObject(); if (o) { canvas.sendBackwards(o); renderLayers(); } }
function bringToFront()   { var o = canvas.getActiveObject(); if (o) { canvas.bringToFront(o);  renderLayers(); } }
function sendToBack()     { var o = canvas.getActiveObject(); if (o) { canvas.sendToBack(o);    renderLayers(); } }

function flipH() {
  var obj = canvas.getActiveObject();
  if (!obj) return;
  obj.set('flipX', !obj.flipX);
  canvas.renderAll();
}

function duplicateObject() {
  var obj = canvas.getActiveObject();
  if (!obj) return;
  obj.clone(function(cloned) {
    cloned.set({ left: obj.left + 20, top: obj.top + 20, evented: true });
    canvas.add(cloned);
    canvas.setActiveObject(cloned);
    canvas.renderAll();
    renderLayers();
    toast('Duplicated');
  });
}

function deleteObject() {
  var obj = canvas.getActiveObject();
  if (!obj) return;
  if (obj.type === 'activeSelection') {
    obj.forEachObject(function(o) { canvas.remove(o); });
    canvas.discardActiveObject();
  } else {
    canvas.remove(obj);
  }
  canvas.renderAll();
  renderLayers();
}

function lockToggle() {
  var obj = canvas.getActiveObject();
  if (!obj) return;
  var locked = !obj.lockMovementX;
  obj.set({ lockMovementX: locked, lockMovementY: locked, lockScalingX: locked, lockScalingY: locked, lockRotation: locked });
  canvas.renderAll();
  document.getElementById('lock-btn').textContent = locked ? '🔒 Locked' : '🔓 Lock';
  toast(locked ? 'Object locked' : 'Object unlocked');
}

/* ── ALIGN ── */
function alignObj(dir) {
  var obj = canvas.getActiveObject();
  if (!obj) return;
  var W = STATE.artboardW, H = STATE.artboardH;
  var b = obj.getBoundingRect();
  if (dir === 'left')    obj.set('left', 0);
  if (dir === 'right')   obj.set('left', W - b.width);
  if (dir === 'top')     obj.set('top',  0);
  if (dir === 'bottom')  obj.set('top',  H - b.height);
  if (dir === 'centerH') obj.set('left', (W - b.width)  / 2);
  if (dir === 'centerV') obj.set('top',  (H - b.height) / 2);
  obj.setCoords();
  canvas.renderAll();
  updateTransformFields();
}

/* ── SNAP ENGINE ── */
// Snap threshold in canvas units
var SNAP_THRESHOLD = 8;

// Active guide lines drawn on canvas overlay
var _snapLines = [];

function _clearSnapLines() {
  _snapLines.forEach(function(l) { canvas.remove(l); });
  _snapLines = [];
}

function _drawSnapLine(x1, y1, x2, y2, color) {
  var line = new fabric.Line([x1, y1, x2, y2], {
    stroke: color || '#00eaff',
    strokeWidth: 0.5,
    strokeDashArray: [4, 3],
    selectable: false,
    evented: false,
    excludeFromExport: true,
    opacity: 0.7,
    _isSnapLine: true,
  });
  canvas.add(line);
  canvas.bringToFront(line);
  _snapLines.push(line);
}

function snapEngine(obj) {
  var W = STATE.artboardW, H = STATE.artboardH;
  var b = obj.getBoundingRect(true);
  var T = SNAP_THRESHOLD;

  // Edges and center of the moving object
  var oL = b.left,             oR = b.left + b.width;
  var oT = b.top,              oB = b.top  + b.height;
  var oCx = b.left + b.width  / 2;
  var oCy = b.top  + b.height / 2;

  var snapX = null, snapY = null;
  var lineColor = '#00eaff';

  // ── Artboard anchors (left, center, right / top, center, bottom) ──
  var artX = [0, W / 2, W];
  var artY = [0, H / 2, H];

  artX.forEach(function(ax) {
    if (snapX === null && Math.abs(oL  - ax) < T) snapX = ax - 0;
    if (snapX === null && Math.abs(oCx - ax) < T) snapX = ax - b.width / 2;
    if (snapX === null && Math.abs(oR  - ax) < T) snapX = ax - b.width;
  });
  artY.forEach(function(ay) {
    if (snapY === null && Math.abs(oT  - ay) < T) snapY = ay - 0;
    if (snapY === null && Math.abs(oCy - ay) < T) snapY = ay - b.height / 2;
    if (snapY === null && Math.abs(oB  - ay) < T) snapY = ay - b.height;
  });

  // ── Object-to-object snapping ──
  canvas.getObjects().forEach(function(other) {
    if (other === obj || other._isSnapLine || other._isSafeArea || other._isCutLine) return;
    var ob = other.getBoundingRect(true);
    var sL = ob.left,           sR = ob.left + ob.width;
    var sT = ob.top,            sB = ob.top  + ob.height;
    var sCx = ob.left + ob.width  / 2;
    var sCy = ob.top  + ob.height / 2;

    // X: left←→left, right←→right, left←→right, center←→center
    if (snapX === null) {
      if (Math.abs(oL  - sL)  < T) { snapX = sL;            lineColor = '#ff00ff'; }
      else if (Math.abs(oR  - sR)  < T) { snapX = sR  - b.width;  lineColor = '#ff00ff'; }
      else if (Math.abs(oL  - sR)  < T) { snapX = sR;            lineColor = '#ff00ff'; }
      else if (Math.abs(oR  - sL)  < T) { snapX = sL  - b.width;  lineColor = '#ff00ff'; }
      else if (Math.abs(oCx - sCx) < T) { snapX = sCx - b.width  / 2; lineColor = '#ff00ff'; }
    }
    // Y: top←→top, bottom←→bottom, top←→bottom, center←→center
    if (snapY === null) {
      if (Math.abs(oT  - sT)  < T) { snapY = sT;            lineColor = '#ff00ff'; }
      else if (Math.abs(oB  - sB)  < T) { snapY = sB  - b.height; lineColor = '#ff00ff'; }
      else if (Math.abs(oT  - sB)  < T) { snapY = sB;            lineColor = '#ff00ff'; }
      else if (Math.abs(oB  - sT)  < T) { snapY = sT  - b.height; lineColor = '#ff00ff'; }
      else if (Math.abs(oCy - sCy) < T) { snapY = sCy - b.height / 2; lineColor = '#ff00ff'; }
    }
  });

  // Apply snapped position
  if (snapX !== null) obj.set('left', snapX);
  if (snapY !== null) obj.set('top',  snapY);

  // Draw guide lines
  _clearSnapLines();
  var nb = obj.getBoundingRect(true);
  if (snapX !== null) {
    _drawSnapLine(nb.left + nb.width / 2, -50, nb.left + nb.width / 2, H + 50, lineColor);
  }
  if (snapY !== null) {
    _drawSnapLine(-50, nb.top + nb.height / 2, W + 50, nb.top + nb.height / 2, lineColor);
  }
}

function onObjectMoving(e) {
  if (!document.getElementById('snap-enabled').checked) {
    _clearSnapLines();
    calcDPI();
    return;
  }
  snapEngine(e.target);
  calcDPI();
}

/* ── DIE CUT ── */
/* ── CONTOUR DIE CUT ── */
/* Traces visible object bounds, builds convex hull, draws cyan cut line.
   No AI, no randomness — deterministic shape from pixel alpha. */
function applyContourCut() {
  if (STATE.mode !== 'sticker') return;

  // Remove old cut line
  var existing = canvas.getObjects().filter(function(o) { return o.ppDieCut; });
  existing.forEach(function(o) { canvas.remove(o); });

  var objects = canvas.getObjects().filter(function(o) { return o.visible && !o.ppDieCut; });
  if (!objects.length) return;

  // Merge to temp canvas for pixel sampling
  var tempEl = document.createElement('canvas');
  var ctx    = tempEl.getContext('2d');

  var bounds = objects.reduce(function(acc, obj) {
    var b = obj.getBoundingRect();
    return {
      left:   Math.min(acc.left,   b.left),
      top:    Math.min(acc.top,    b.top),
      right:  Math.max(acc.right,  b.left + b.width),
      bottom: Math.max(acc.bottom, b.top  + b.height),
    };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

  var w = Math.ceil(bounds.right  - bounds.left) || 1;
  var h = Math.ceil(bounds.bottom - bounds.top)  || 1;
  tempEl.width  = w;
  tempEl.height = h;

  objects.forEach(function(obj) {
    obj.clone(function(clone) {
      clone.set({ left: (obj.left - bounds.left), top: (obj.top - bounds.top) });
      clone.render(ctx);
    });
  });

  // Sample alpha every 3px for speed
  var imageData = ctx.getImageData(0, 0, w, h);
  var pixels    = imageData.data;
  var pts = [];
  for (var y = 0; y < h; y += 3) {
    for (var x = 0; x < w; x += 3) {
      if (pixels[(y * w + x) * 4 + 3] > 20) {
        pts.push({ x: x, y: y });
      }
    }
  }
  if (!pts.length) return;

  // Convex hull
  pts.sort(function(a, b) { return a.x === b.x ? a.y - b.y : a.x - b.x; });
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  var lower = [], upper = [];
  pts.forEach(function(p) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  });
  for (var i = pts.length - 1; i >= 0; i--) {
    var p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  var hull = lower.concat(upper);

  // Offset hull points outward by bleed padding
  var BLEED = window._presetBleed || 14;
  var cx = hull.reduce(function(s, p) { return s + p.x; }, 0) / hull.length;
  var cy = hull.reduce(function(s, p) { return s + p.y; }, 0) / hull.length;
  var expanded = hull.map(function(p) {
    var dx = p.x - cx, dy = p.y - cy;
    var len = Math.sqrt(dx*dx + dy*dy) || 1;
    return {
      x: p.x + bounds.left + (dx / len) * BLEED,
      y: p.y + bounds.top  + (dy / len) * BLEED,
    };
  });

  // Build SVG path
  var d = 'M ' + expanded[0].x + ' ' + expanded[0].y;
  for (var j = 1; j < expanded.length; j++) {
    d += ' L ' + expanded[j].x + ' ' + expanded[j].y;
  }
  d += ' Z';

  var outline = new fabric.Path(d, {
    fill:        'transparent',
    stroke:      '#00eaff',
    strokeWidth: 2,
    selectable:  false,
    evented:     false,
    ppDieCut:    true,
  });

  canvas.add(outline);
  outline.sendToBack();
  canvas.renderAll();
}

function applyDieCut() {
  STATE.dieCutShape = document.getElementById('cut-shape').value;
  STATE.safeMargin  = parseInt(document.getElementById('safe-margin').value);
  STATE.bleed       = parseInt(document.getElementById('bleed-size').value);
  document.getElementById('safe-margin-val').textContent = STATE.safeMargin + 'px';
  document.getElementById('bleed-val').textContent       = STATE.bleed + 'px';

  var shapes = {
    none:    '<span>No cut selected</span>',
    contour: '<div class="cut-contour"></div>',
    circle:  '<div class="cut-circle"></div>',
    square:  '<div class="cut-square"></div>',
    rounded: '<div class="cut-rounded"></div>',
  };
  document.getElementById('diecut-preview').innerHTML = shapes[STATE.dieCutShape] || '<span>No cut selected</span>';

  var sa = document.getElementById('safe-area');
  var m  = STATE.safeMargin;
  sa.style.top = m + 'px'; sa.style.left = m + 'px';
  sa.style.right = m + 'px'; sa.style.bottom = m + 'px';
  sa.style.borderRadius = STATE.dieCutShape === 'circle' ? '50%' : STATE.dieCutShape === 'rounded' ? '12%' : '0';
}

/* ── DPI ENGINE ── */
function calcDPI() {
  var iw = parseFloat(document.getElementById('inches-w').value) || 3;
  var ih = parseFloat(document.getElementById('inches-h').value) || 3;

  // Measure actual design bounds — ignore snap lines, safe area overlay, cut line
  var objs = canvas ? canvas.getObjects().filter(function(o) {
    return o.visible && !o._isSnapLine && !o._isSafeArea && !o._isCutLine;
  }) : [];

  var pxW, pxH;
  if (objs.length > 0) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    objs.forEach(function(o) {
      var b = o.getBoundingRect(true);
      minX = Math.min(minX, b.left);
      minY = Math.min(minY, b.top);
      maxX = Math.max(maxX, b.left + b.width);
      maxY = Math.max(maxY, b.top  + b.height);
    });
    pxW = maxX - minX;
    pxH = maxY - minY;
  } else {
    pxW = STATE.artboardW;
    pxH = STATE.artboardH;
  }

  var dpi = Math.round(Math.min(pxW / iw, pxH / ih));
  STATE.dpi        = dpi;
  STATE.printReady = dpi >= 300;

  var numEl    = document.getElementById('dpi-number');
  var outEl    = document.getElementById('pi-output');
  var statusEl = document.getElementById('dpi-status');
  var displayEl= document.getElementById('dpi-display');
  var badgeEl  = document.getElementById('dpi-badge');
  var exportBtn     = document.getElementById('export-btn');
  var exportBlocked = document.getElementById('export-blocked');

  if (numEl)  numEl.textContent  = dpi;
  if (outEl)  outEl.textContent  = iw + ' × ' + ih + ' in';

  if (dpi >= 300) {
    if (statusEl)  statusEl.textContent = '✦ Print Ready';
    if (displayEl) displayEl.className  = 'dpi-display';
    if (badgeEl) { badgeEl.className = 'dpi-badge ready'; badgeEl.textContent = dpi + ' DPI ✓'; }
    if (exportBtn)     exportBtn.disabled = false;
    if (exportBlocked) exportBlocked.style.display = 'none';
  } else if (dpi >= 150) {
    if (statusEl)  statusEl.textContent = '⚠ Low — Scale Up';
    if (displayEl) displayEl.className  = 'dpi-display warn';
    if (badgeEl) { badgeEl.className = 'dpi-badge warn'; badgeEl.textContent = dpi + ' DPI ⚠'; }
    if (exportBtn)     exportBtn.disabled = true;
    if (exportBlocked) exportBlocked.style.display = 'block';
  } else {
    if (statusEl)  statusEl.textContent = '✕ Too Low';
    if (displayEl) displayEl.className  = 'dpi-display warn';
    if (badgeEl) { badgeEl.className = 'dpi-badge bad'; badgeEl.textContent = dpi + ' DPI ✕'; }
    if (exportBtn)     exportBtn.disabled = true;
    if (exportBlocked) exportBlocked.style.display = 'block';
  }
}

/* ── EXPORT ── */
function exportDesign() {
  if (!STATE.printReady) { toast('⚠ Cannot export — DPI below 300'); return; }

  var fmt     = document.querySelector('input[name="export-fmt"]:checked').value;
  var name    = document.getElementById('export-name').value || 'my-logo';
  var withCut = document.getElementById('export-diecut').checked;

  if (fmt === 'svg') {
    var blob = new Blob([canvas.toSVG()], { type: 'image/svg+xml' });
    downloadBlob(blob, name + '.svg');
    toast('✦ SVG exported');
    return;
  }

  var origBg = canvas.backgroundColor;
  if (fmt === 'transparent') canvas.backgroundColor = null;

  var dcOverlay = null;
  if (withCut && STATE.dieCutShape !== 'none') {
    var m = STATE.safeMargin;
    var opts = {
      left: m, top: m,
      width: STATE.artboardW - m * 2, height: STATE.artboardH - m * 2,
      fill: 'transparent', stroke: '#ff0000', strokeWidth: 3,
      strokeDashArray: [10, 5], selectable: false, evented: false,
    };
    if (STATE.dieCutShape === 'circle') {
      dcOverlay = new fabric.Ellipse(Object.assign({}, opts, { rx: opts.width/2, ry: opts.height/2 }));
    } else {
      var rx = STATE.dieCutShape === 'rounded' ? 30 : 0;
      dcOverlay = new fabric.Rect(Object.assign({}, opts, { rx: rx, ry: rx }));
    }
    canvas.add(dcOverlay);
    canvas.renderAll();
  }

  var dataURL = canvas.toDataURL({ format: 'png', quality: 1, multiplier: 1 });

  if (dcOverlay) canvas.remove(dcOverlay);
  canvas.backgroundColor = origBg;
  canvas.renderAll();

  downloadDataURL(dataURL, name + '.png');
  toast('✦ ' + STATE.artboardW + '×' + STATE.artboardH + 'px — ' + STATE.dpi + ' DPI');
}

/* ── FINISH WITH PRINTPATH ── */
/* Fast print-ready pass: centers, snaps to safe alignment,
   normalises placement, bumps canvas to safe print base.
   No AI, no randomness — deterministic print prep. */
function fastFinish() {
  var btn = document.getElementById('fast-finish-btn');

  // Guard: nothing to work with
  if (!canvas.getObjects().length) {
    toast('Add something first');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Optimising…'; }

  try {
    var MIN_PX = 2400; // safer print base
    var SAFE_PADDING = 0.9; // 90% of safe area — prevents over-shrink

    // 1. Bump canvas to print-quality size if needed
    if (STATE.artboardW < MIN_PX || STATE.artboardH < MIN_PX) {
      var scale = Math.ceil(MIN_PX / Math.min(STATE.artboardW, STATE.artboardH));
      var newW = STATE.artboardW * scale;
      var newH = STATE.artboardH * scale;
      canvas.getObjects().forEach(function(obj) {
        obj.set({
          left:   obj.left   * scale,
          top:    obj.top    * scale,
          scaleX: (obj.scaleX || 1) * scale,
          scaleY: (obj.scaleY || 1) * scale,
        });
        obj.setCoords();
      });
      STATE.artboardW = newW;
      STATE.artboardH = newH;
      canvas.setWidth(newW);
      canvas.setHeight(newH);
      var wInput = document.getElementById('artboard-w');
      var hInput = document.getElementById('artboard-h');
      if (wInput) wInput.value = newW;
      if (hInput) hInput.value = newH;
    }

    // 2. Collect visible, non-guide objects only
    var objs = canvas.getObjects().filter(function(o) {
      return o.visible && o.id !== 'pp-watermark' && o._type !== 'guide';
    });
    if (!objs.length) { _fastFinishDone(btn); return; }

    // 3. Center collective bounding box on artboard
    var sel = new fabric.ActiveSelection(objs, { canvas: canvas });
    canvas.setActiveObject(sel);
    var cW = STATE.artboardW;
    var cH = STATE.artboardH;
    sel.set({ left: cW / 2, top: cH / 2, originX: 'center', originY: 'center' });

    // 4. Scale down if bleeding outside safe area, with padding buffer
    var margin = STATE.safeMargin || 20;
    var maxW = (cW - margin * 2) * SAFE_PADDING;
    var maxH = (cH - margin * 2) * SAFE_PADDING;
    var bw = sel.getScaledWidth();
    var bh = sel.getScaledHeight();
    if (bw > maxW || bh > maxH) {
      var fitScale = Math.min(maxW / bw, maxH / bh);
      sel.set({ scaleX: (sel.scaleX || 1) * fitScale, scaleY: (sel.scaleY || 1) * fitScale });
      sel.set({ left: cW / 2, top: cH / 2 }); // re-center after scale
    }

    sel.setCoords();
    canvas.discardActiveObject();

    // 5. Snap position only (not scale) to integer pixel grid
    canvas.getObjects().forEach(function(obj) {
      obj.left = Math.round(obj.left);
      obj.top  = Math.round(obj.top);
      obj.setCoords();
    });

    canvas.renderAll();
    renderLayers();
    calcDPI();

    _fastFinishDone(btn);
  } catch(e) {
    console.warn('[PrintPath] fastFinish error:', e);
    if (btn) { btn.disabled = false; btn.textContent = '✦ Finish with PrintPath'; }
  }
}

function _fastFinishDone(btn) {
  if (btn) { btn.disabled = false; btn.textContent = '✦ Finish with PrintPath'; }
  toast('Optimized by PrintPath');
}

/* ── SAVE / LOAD / RESET ── */
function saveProject() {
  localStorage.setItem('pp_logo_project', JSON.stringify(canvas.toJSON(['_type','_label'])));
  toast('✦ Project saved');
}

function loadProject() {
  var saved = localStorage.getItem('pp_logo_project');
  if (!saved) { toast('No saved project found'); return; }
  canvas.loadFromJSON(JSON.parse(saved), function() {
    canvas.renderAll(); renderLayers(); calcDPI();
    toast('✦ Project loaded');
  });
}

function resetProject() {
  if (!confirm('Reset canvas? This cannot be undone.')) return;
  canvas.clear();
  canvas.backgroundColor = STATE.mode === 'sticker' ? null : '#ffffff';
  canvas.renderAll();
  renderLayers();
  toast('Canvas reset');
}

function exportJSON() {
  var blob = new Blob([JSON.stringify(canvas.toJSON(['_type','_label','ppDieCut']), null, 2)], { type: 'application/json' });
  downloadBlob(blob, (document.getElementById('export-name').value || 'my-logo') + '.json');
  toast('✦ Project exported');
}

/* ── EXPORT PRINT SVG (ART + CUT PATH) ── */
/* Exports artwork + magenta contour cut line in one SVG.
   Magenta (#FF00FF) is the industry standard cut colour for
   Illustrator, Cricut, Roland, and most RIP software. */
function exportPrintSVG() {
  var objects = canvas.getObjects();
  if (!objects.length) { toast('⚠ Nothing to export'); return; }

  var name = document.getElementById('export-name').value || 'printpath-export';
  var hasCut = objects.some(function(o) { return o.ppDieCut; });
  if (!hasCut) { toast('⚠ No cut path — run Finish with PrintPath first'); }

  // Build SVG via a temp StaticCanvas so we don't touch the live canvas
  var exportCanvas = new fabric.StaticCanvas(null, {
    width:  canvas.width,
    height: canvas.height,
  });

  var total  = objects.length;
  var clones = [];
  var done   = 0;

  objects.forEach(function(obj) {
    obj.clone(function(clone) {
      clone.set({ selectable: false, evented: false });

      if (obj.ppDieCut) {
        // Industry-standard magenta cut line
        clone.set({
          stroke:      '#FF00FF',
          strokeWidth: 1,
          fill:        'transparent',
        });
      }

      clones.push({ order: canvas.getObjects().indexOf(obj), clone: clone });
      done++;

      if (done === total) {
        // Preserve layer order
        clones.sort(function(a, b) { return a.order - b.order; });
        clones.forEach(function(item) { exportCanvas.add(item.clone); });

        var svg = exportCanvas.toSVG({ suppressPreamble: false });
        var blob = new Blob([svg], { type: 'image/svg+xml' });
        downloadBlob(blob, name + '-print.svg');
        toast('✦ Print SVG exported — cut path included');
      }
    }, ['ppDieCut']);
  });
}

function importJSONClick() { document.getElementById('import-json-input').click(); }

/* ── SPLIT EXPORT (ART FILE + CUT FILE SEPARATELY) ── */
function exportSplitSVG() {
  var objects = canvas.getObjects();
  if (!objects.length) { toast('⚠ Nothing to export'); return; }

  var name = document.getElementById('export-name').value || 'printpath';
  var hasCut = objects.some(function(o) { return o.ppDieCut; });
  if (!hasCut) { toast('⚠ No cut path — run Finish with PrintPath first'); return; }

  var W = canvas.width, H = canvas.height;
  var artCanvas = new fabric.StaticCanvas(null, { width: W, height: H });
  var cutCanvas = new fabric.StaticCanvas(null, { width: W, height: H });

  var total = objects.length, done = 0;

  objects.forEach(function(obj) {
    obj.clone(function(clone) {
      clone.set({ selectable: false, evented: false });
      if (obj.ppDieCut) {
        clone.set({ stroke: '#FF00FF', strokeWidth: 1, fill: 'transparent' });
        cutCanvas.add(clone);
      } else {
        artCanvas.add(clone);
      }
      done++;
      if (done === total) {
        var artSVG = artCanvas.toSVG();
        var cutSVG = cutCanvas.toSVG();
        downloadBlob(new Blob([artSVG], { type: 'image/svg+xml' }), name + '-art.svg');
        // slight delay so browser allows both downloads
        setTimeout(function() {
          downloadBlob(new Blob([cutSVG], { type: 'image/svg+xml' }), name + '-cut.svg');
        }, 300);
        toast('✦ Art + Cut files exported');
      }
    }, ['ppDieCut']);
  });
}

/* ── PDF EXPORT ── */
function exportPDF() {
  if (!window.jspdf) { toast('⚠ PDF library not loaded yet — try again'); return; }
  var name = document.getElementById('export-name').value || 'printpath';
  var dataURL = canvas.toDataURL({ format: 'png', multiplier: 3 });
  var jsPDF = window.jspdf.jsPDF;
  var pdf = new jsPDF({
    orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [canvas.width, canvas.height],
  });
  pdf.addImage(dataURL, 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save(name + '.pdf');
  toast('✦ PDF exported');
}

/* ── SHOP PRESETS ── */
var SHOP_PRESETS = {
  default:   { bleed: 14, safeMargin: 20 },
  vinylShop: { bleed: 20, safeMargin: 30 },
  dtgShop:   { bleed: 8,  safeMargin: 15 },
};

function applyShopPreset(name) {
  var p = SHOP_PRESETS[name];
  if (!p) return;
  STATE.safeMargin = p.safeMargin;
  // Re-run contour cut with new bleed baked into applyContourCut's BLEED var
  window._presetBleed = p.bleed;
  applyContourCut();
  toast('✦ Preset: ' + name);
}

function importJSON(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      canvas.loadFromJSON(JSON.parse(ev.target.result), function() {
        canvas.renderAll(); renderLayers(); calcDPI();
        toast('✦ Project imported');
      });
    } catch(err) { toast('⚠ Invalid project file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/* ── LAYERS ── */
function renderLayers() {
  var list   = document.getElementById('layers-list');
  var objs   = canvas.getObjects();
  var active = canvas.getActiveObject();
  list.innerHTML = '';

  if (!objs.length) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:10px;padding:8px 0">No objects yet</div>';
    return;
  }

  var iconMap = { 'i-text':'T', text:'T', rect:'▬', circle:'●', rounded:'▢',
                  triangle:'▲', star:'★', hexagon:'⬡', image:'⊕', svg:'⊕', group:'⊞' };

  var reversed = objs.slice().reverse();
  reversed.forEach(function(obj) {
    var type  = obj._type || obj.type || 'object';
    var label = obj._label ||
      ((type === 'i-text' || type === 'text') ? '"' + (obj.text || '').slice(0,14) + '"' : type);

    var item = document.createElement('div');
    item.className = 'layer-item' + (active === obj ? ' selected' : '');
    item.innerHTML =
      '<div class="layer-thumb">' + (iconMap[type] || '◆') + '</div>' +
      '<div class="layer-name" title="' + label + '">' + label + '</div>' +
      '<div class="layer-actions">' +
        '<button class="layer-act vis-btn" title="Toggle visibility">' + (obj.visible === false ? '◌' : '◉') + '</button>' +
        '<button class="layer-act del-btn" title="Delete">✕</button>' +
      '</div>';

    item.querySelector('.vis-btn').onclick = function(ev) {
      ev.stopPropagation();
      obj.set('visible', obj.visible === false ? true : false);
      canvas.renderAll(); renderLayers();
    };
    item.querySelector('.del-btn').onclick = function(ev) {
      ev.stopPropagation();
      canvas.remove(obj); canvas.renderAll(); renderLayers();
    };
    item.onclick = function() {
      canvas.setActiveObject(obj); canvas.renderAll(); onSelect();
    };
    list.appendChild(item);
  });
}

function toggleLayersDrawer() {
  STATE.layersOpen = !STATE.layersOpen;
  document.getElementById('layers-list').style.display = STATE.layersOpen ? 'flex' : 'none';
  document.querySelector('.layers-toggle').textContent  = STATE.layersOpen ? '▼' : '▲';
}

/* ── KEYBOARD ── */
function handleKey(e) {
  var tag = document.activeElement.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.metaKey || e.ctrlKey) {
    if (e.key === 'd') { e.preventDefault(); duplicateObject(); }
    if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
    if (e.key === '-') { e.preventDefault(); zoomOut(); }
    if (e.key === '0') { e.preventDefault(); zoomFit(); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') deleteObject();
  if (e.key === 'Escape') closeShopUpgrade();
}

/* ══════════════════════════════════════════════════════════════
   SHOP PLAN SYSTEM
   ──────────────────────────────────────────────────────────────
   Users always get full frictionless access.
   The tool gets MORE POWERFUL based on the shop's level.
   Zero locks, zero modals, zero friction for users.

   Level  Price    What it unlocks
   1      free     Basic editor (default)
   2      $29/mo   Resize + scale tools
   3      $59/mo   Color adjust + CMYK
   4      $99/mo   Die-cut + sticker mode
   5      $149/mo  Full pro — all tools
══════════════════════════════════════════════════════════════ */

var currentShop = {
  id:        new URLSearchParams(window.location.search).get('shopId') || 'demo',
  planLevel: 1,
  name:      '',
};

var isAdminMode = window.location.search.includes('admin=true');

function hasLevel(required) {
  return currentShop.planLevel >= required;
}

async function loadShopPlan() {
  try {
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      var snap = await firebase.firestore().doc('shops/' + currentShop.id).get();
      if (snap.exists) {
        var data = snap.data();
        currentShop.planLevel = Number(data.planLevel) || 1;
        currentShop.name      = data.name || '';
      }
    } else {
      var stored = localStorage.getItem('pp_shop_' + currentShop.id);
      if (stored) {
        var parsed = JSON.parse(stored);
        currentShop.planLevel = Number(parsed.planLevel) || 1;
        currentShop.name      = parsed.name || '';
      }
    }
  } catch(e) {
    console.warn('[PrintPath] Could not load shop plan:', e);
  }
  applyShopLevel();
}

function applyShopLevel() {
  var level = currentShop.planLevel;

  // Watermark only on unpaid level-1 shops
  var wm = document.getElementById('pp-watermark');
  if (wm) wm.style.display = (level >= 2) ? 'none' : 'block';

  // Admin upgrade button
  var adminBtn = document.getElementById('shop-admin-btn');
  if (adminBtn) {
    adminBtn.style.display = isAdminMode ? 'block' : 'none';
    var labels = ['', '$29/mo', '$59/mo', '$99/mo', '$149/mo'];
    adminBtn.textContent = level < 5
      ? '✦ Upgrade Shop — ' + labels[level]
      : '✦ Full Pro Active';
  }
}

// ── SHOP UPGRADE MODAL (admin only) ──
function showShopUpgrade() {
  var modal = document.getElementById('shop-upgrade-modal');
  if (!modal) return;
  var level = currentShop.planLevel;
  var tiers = [
    { price: '$29/mo',  label: 'Level 2 — Resize & Scale', tier: 2 },
    { price: '$59/mo',  label: 'Level 3 — Color Tools',    tier: 3 },
    { price: '$99/mo',  label: 'Level 4 — Die-Cut & Print',tier: 4 },
    { price: '$149/mo', label: 'Level 5 — Full Pro',       tier: 5 },
  ];
  var next = tiers[Math.min(level - 1, tiers.length - 1)];
  var heading = modal.querySelector('.shop-up-heading');
  var btnEl   = modal.querySelector('.shop-up-btn');
  if (heading && next) heading.textContent = next.label;
  if (btnEl   && next) { btnEl.textContent = 'Upgrade — ' + next.price; btnEl.dataset.tier = next.tier; }
  modal.classList.remove('hidden');
}

function closeShopUpgrade() {
  var modal = document.getElementById('shop-upgrade-modal');
  if (modal) modal.classList.add('hidden');
}

async function upgradeShop(tierOverride) {
  var btn  = document.querySelector('.shop-up-btn');
  var tier = tierOverride || (btn && parseInt(btn.dataset.tier)) || (currentShop.planLevel + 1);
  if (btn) { btn.textContent = 'Redirecting…'; btn.disabled = true; }
  try {
    var res  = await fetch('/.netlify/functions/create-shop-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId: currentShop.id, tier: tier }),
    });
    var data = await res.json();
    if (data.url) { window.location = data.url; return; }
    throw new Error('No checkout URL');
  } catch(e) {
    toast('⚠ Could not start checkout — try again');
    if (btn) { btn.textContent = 'Upgrade Shop'; btn.disabled = false; }
  }
}

(function checkShopReturn() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('shop_pro') === 'success') {
    var tier = parseInt(params.get('tier')) || (currentShop.planLevel + 1);
    currentShop.planLevel = tier;
    localStorage.setItem('pp_shop_' + currentShop.id, JSON.stringify(currentShop));
    history.replaceState(null, '', window.location.pathname + (isAdminMode ? '?admin=true&shopId=' + currentShop.id : ''));
    applyShopLevel();
    toast('✦ Shop upgraded to Level ' + tier + ' — new tools active');
  }
})();

loadShopPlan();
