var STATE = {
  mode: 'logo',
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
    backgroundColor: '#ffffff',
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
  canvas.on('object:modified', function() { renderLayers(); updateTransformFields(); });
  canvas.on('object:moving', onObjectMoving);
  canvas.on('object:added', renderLayers);
  canvas.on('object:removed', renderLayers);

  document.addEventListener('keydown', handleKey);
  document.getElementById('img-upload').addEventListener('change', handleImageUpload);
  window.addEventListener('resize', fitCanvasToWindow);

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
  if (mode === 'sticker' && !requirePro('Sticker Mode')) return;
  STATE.mode = mode;
  document.querySelectorAll('.mode-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  var label = document.getElementById('diecut-mode-label');
  if (mode === 'sticker') {
    label.textContent = '— Sticker';
    canvas.backgroundColor = null;
    document.getElementById('cut-shape').value = 'contour';
    applyDieCut();
    toast('✦ Sticker Mode — transparent bg, contour cut on');
  } else {
    label.textContent = '— Logo';
    canvas.backgroundColor = '#ffffff';
    document.getElementById('cut-shape').value = 'none';
    applyDieCut();
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
  if (file.name.toLowerCase().endsWith('.svg')) {
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
      });
    };
    reader2.readAsDataURL(file);
  }
  e.target.value = '';
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

/* ── SNAP ── */
function onObjectMoving(e) {
  if (!document.getElementById('snap-enabled').checked) return;
  var obj  = e.target;
  var cx   = STATE.artboardW / 2, cy = STATE.artboardH / 2;
  var b    = obj.getBoundingRect();
  var SNAP = 10;
  if (Math.abs(obj.left + b.width/2  - cx) < SNAP) obj.set('left', cx - b.width/2);
  if (Math.abs(obj.top  + b.height/2 - cy) < SNAP) obj.set('top',  cy - b.height/2);
  if (Math.abs(obj.left)                   < SNAP) obj.set('left', 0);
  if (Math.abs(obj.top)                    < SNAP) obj.set('top',  0);
  if (Math.abs(obj.left + b.width  - STATE.artboardW) < SNAP) obj.set('left', STATE.artboardW - b.width);
  if (Math.abs(obj.top  + b.height - STATE.artboardH) < SNAP) obj.set('top',  STATE.artboardH - b.height);
}

/* ── DIE CUT ── */
function applyDieCut() {
  STATE.dieCutShape = document.getElementById('cut-shape').value;
  if (STATE.dieCutShape !== 'none' && !requirePro('Die-Cut Shape')) {
    document.getElementById('cut-shape').value = 'none';
    STATE.dieCutShape = 'none';
  }
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

/* ── DPI ── */
function calcDPI() {
  var iw  = parseFloat(document.getElementById('inches-w').value) || 3;
  var ih  = parseFloat(document.getElementById('inches-h').value) || 3;
  var dpi = Math.round(Math.min(STATE.artboardW / iw, STATE.artboardH / ih));
  STATE.dpi        = dpi;
  STATE.printReady = dpi >= 300;

  document.getElementById('dpi-number').textContent  = dpi;
  document.getElementById('pi-output').textContent   = iw + ' × ' + ih + ' in';

  if (STATE.printReady) {
    document.getElementById('dpi-status').textContent  = '✦ Print Ready';
    document.getElementById('dpi-display').className   = 'dpi-display';
    document.getElementById('dpi-badge').className     = 'dpi-badge ready';
    document.getElementById('dpi-badge').textContent   = dpi + ' DPI ✓';
    document.getElementById('export-btn').disabled     = false;
    document.getElementById('export-blocked').style.display = 'none';
  } else {
    document.getElementById('dpi-status').textContent  = '⚠ Below 300 DPI';
    document.getElementById('dpi-display').className   = 'dpi-display warn';
    document.getElementById('dpi-badge').className     = 'dpi-badge warn';
    document.getElementById('dpi-badge').textContent   = dpi + ' DPI ✗';
    document.getElementById('export-btn').disabled     = true;
    document.getElementById('export-blocked').style.display = 'block';
  }
}

/* ── EXPORT ── */
function exportDesign() {
  if (!requirePro('Export')) return;
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
  var blob = new Blob([JSON.stringify(canvas.toJSON(['_type','_label']), null, 2)], { type: 'application/json' });
  downloadBlob(blob, (document.getElementById('export-name').value || 'my-logo') + '.json');
  toast('✦ Project exported');
}

function importJSONClick() { document.getElementById('import-json-input').click(); }

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
  if (e.key === 'Escape') closeUpgrade();
}

/* ── UPGRADE MODAL ── */
var currentUser = {
  plan: localStorage.getItem('pp_plan') || 'free',
};

function updateWatermark() {
  var wm   = document.getElementById('pp-watermark');
  var hint = document.getElementById('pp-export-hint');
  if (!wm) return;
  if (currentUser.plan === 'pro') {
    wm.style.display = 'none';
    if (hint) hint.classList.add('hidden');
  } else {
    wm.style.display = 'block';
    if (hint) hint.classList.remove('hidden');
  }
}

// Run on load
updateWatermark();

function requirePro(featureName) {
  if (currentUser.plan === 'pro') return true;
  toast('\u2665 Pro tool \u2014 unlock to continue');
  setTimeout(function() { showUpgradeModal(featureName); }, 600);
  return false;
}

function showUpgradeModal(featureName) {
  var modal = document.getElementById('upgrade-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  // Highlight which feature they tried to use
  if (featureName) {
    var sub = modal.querySelector('.pp-up-sub');
    if (sub) sub.textContent = '\u201c' + featureName + '\u201d requires Pro. Unlock to continue.';
  }
}

function closeUpgrade() {
  var modal = document.getElementById('upgrade-modal');
  if (modal) modal.classList.add('hidden');
}

async function upgradeToPro() {
  var btn = document.querySelector('.pp-up-btn');
  if (btn) { btn.textContent = 'Redirecting\u2026'; btn.disabled = true; }
  try {
    var res  = await fetch('/create-subscription');
    var data = await res.json();
    if (data.url) {
      window.location = data.url;
    } else {
      toast('\u26a0 Could not start checkout \u2014 try again');
      if (btn) { btn.textContent = 'Unlock Pro \u2014 $29/mo'; btn.disabled = false; }
    }
  } catch(e) {
    toast('\u26a0 Network error \u2014 try again');
    if (btn) { btn.textContent = 'Unlock Pro \u2014 $29/mo'; btn.disabled = false; }
  }
}

// Check for successful upgrade return
(function checkProReturn() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('pro') === 'success') {
    currentUser.plan = 'pro';
    localStorage.setItem('pp_plan', 'pro');
    toast('\u2726 Pro unlocked \u2014 all tools available');
    history.replaceState(null, '', window.location.pathname);
    updateWatermark();
  }
})();
