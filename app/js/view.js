/* Vue interactive : canvas infini, nœuds déplaçables, câblage, zoom, sélection. */
(function (root) {
  'use strict';
  const BP = (root.BP = root.BP || {});
  const P = BP.model;

  const HEADER_H = 30;
  const ROW_H = 24;
  const PROP_H = 30;
  const PAD = 8;
  const NODE_W = 226;
  const SNAP = 8;
  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 2.2;

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function snap(v) { return Math.round(v / SNAP) * SNAP; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function Editor(viewport, callbacks) {
    this.viewport = viewport;
    this.cb = callbacks || {};
    this.graph = P.newGraph();
    this.pan = { x: 80, y: 70 };
    this.zoom = 1;
    this.selection = new Set();
    this.selectedWire = null;
    this.geoms = new Map();
    this.dragState = null;
    this.dragPoint = null;
    this.history = [];
    this.future = [];
    this.zTop = 10;
    this._build();
  }

  /* --------------------------------------------------------------- montage */

  Editor.prototype._build = function () {
    const vp = this.viewport;
    vp.classList.add('bp-viewport');
    vp.innerHTML =
      '<div class="bp-world">' +
      '<svg class="bp-wires" xmlns="http://www.w3.org/2000/svg"></svg>' +
      '<div class="bp-layer"></div>' +
      '</div>';
    this.world = vp.querySelector('.bp-world');
    this.svg = vp.querySelector('.bp-wires');
    this.layer = vp.querySelector('.bp-layer');

    vp.addEventListener('pointerdown', this._onDown.bind(this));
    vp.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    vp.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    vp.addEventListener('dblclick', this._onDblClick.bind(this));
    vp.addEventListener('dragover', function (e) {
      if (e.dataTransfer && e.dataTransfer.types.indexOf('application/x-bp-node') !== -1) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    vp.addEventListener('drop', this._onDrop.bind(this));

    this.layer.addEventListener('input', this._onControlInput.bind(this));
    this.layer.addEventListener('change', this._onControlChange.bind(this));

    document.addEventListener('pointermove', this._onMove.bind(this));
    document.addEventListener('pointerup', this._onUp.bind(this));
    this.applyView();
  };

  Editor.prototype._onDown = function (e) {
    if (e.button === 2) return;
    const target = e.target;
    const pinEl = target.closest ? target.closest('.pin') : null;
    const nodeEl = target.closest ? target.closest('.node') : null;
    const wireEl = target.closest ? target.closest('[data-wire]') : null;

    if (pinEl && nodeEl) {
      e.preventDefault();
      e.stopPropagation();
      this.dragState = {
        type: 'wire',
        pin: { node: nodeEl.dataset.id, pin: pinEl.dataset.pin, dir: pinEl.dataset.dir },
        before: this.stateString()
      };
      this.dragPoint = this.toWorld(e.clientX, e.clientY);
      this.renderWires();
      return;
    }

    if (nodeEl) {
      const id = nodeEl.dataset.id;
      const control = target.closest('input,select,textarea,button');
      if (e.shiftKey) {
        if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
      } else if (!this.selection.has(id)) {
        this.selection.clear();
        this.selection.add(id);
      }
      this.selectedWire = null;
      this.updateSelection();
      nodeEl.style.zIndex = String(this.zTop++);
      if (!control) {
        e.preventDefault();
        const orig = new Map();
        this.selection.forEach(function (nid) {
          const n = P.nodeById(this.graph, nid);
          if (n) orig.set(nid, { x: n.x, y: n.y });
        }, this);
        this.dragState = {
          type: 'node',
          start: this.toWorld(e.clientX, e.clientY),
          orig: orig,
          before: this.stateString(),
          moved: false
        };
      }
      return;
    }

    if (wireEl) {
      this.selectedWire = wireEl.dataset.wire;
      this.selection.clear();
      this.updateSelection();
      this.renderWires();
      this.emitSelection();
      return;
    }

    // fond vide
    this.selection.clear();
    this.selectedWire = null;
    this.updateSelection();
    this.renderWires();
    this.emitSelection();
    e.preventDefault();
    this.dragState = {
      type: 'pan',
      clientX: e.clientX,
      clientY: e.clientY,
      pan: { x: this.pan.x, y: this.pan.y }
    };
  };

  Editor.prototype._onMove = function (e) {
    const d = this.dragState;
    if (!d) return;
    if (d.type === 'pan') {
      this.pan.x = d.pan.x + (e.clientX - d.clientX);
      this.pan.y = d.pan.y + (e.clientY - d.clientY);
      this.applyView();
      return;
    }
    if (d.type === 'node') {
      const w = this.toWorld(e.clientX, e.clientY);
      const dx = w.x - d.start.x;
      const dy = w.y - d.start.y;
      d.orig.forEach(function (pos, id) {
        const node = P.nodeById(this.graph, id);
        if (!node) return;
        const nx = snap(pos.x + dx);
        const ny = snap(pos.y + dy);
        if (nx !== node.x || ny !== node.y) d.moved = true;
        node.x = nx;
        node.y = ny;
        const el = this.nodeEl(id);
        if (el) {
          el.style.left = nx + 'px';
          el.style.top = ny + 'px';
        }
      }, this);
      if (d.moved) {
        this.renderWires();
        this.cb.onGesture && this.cb.onGesture();
      }
      return;
    }
    if (d.type === 'wire') {
      this.dragPoint = this.toWorld(e.clientX, e.clientY);
      this.renderWires();
    }
  };

  Editor.prototype._onUp = function (e) {
    const d = this.dragState;
    if (!d) return;
    this.dragState = null;

    if (d.type === 'node') {
      this.dragPoint = null;
      if (d.moved) {
        this.pushState(d.before);
        this.emit();
      }
      return;
    }

    if (d.type === 'wire') {
      const targetEl = document.elementFromPoint(e.clientX, e.clientY);
      const pinEl = targetEl && targetEl.closest ? targetEl.closest('.pin') : null;
      const nodeEl = pinEl && pinEl.closest('.node');
      this.dragPoint = null;

      if (pinEl && nodeEl) {
        const other = { node: nodeEl.dataset.id, pin: pinEl.dataset.pin, dir: pinEl.dataset.dir };
        const from = d.pin.dir === 'out' ? d.pin : other;
        const to = d.pin.dir === 'out' ? other : d.pin;
        if (from.dir === 'out' && to.dir === 'in' && from.node !== to.node) {
          const check = P.canConnect(this.graph, from, to);
          if (check.ok) {
            this.pushState(d.before);
            P.connect(this.graph, from, to);
            this.render();
            this.emit();
          } else {
            this.cb.onNotice && this.cb.onNotice(check.reason);
            this.renderWires();
          }
        } else {
          this.renderWires();
        }
      } else {
        this.renderWires();
      }
      return;
    }
  };

  Editor.prototype._onWheel = function (e) {
    e.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;
    const wx = (rx - this.pan.x) / this.zoom;
    const wy = (ry - this.pan.y) / this.zoom;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) return;
    this.zoom = next;
    this.pan.x = rx - wx * this.zoom;
    this.pan.y = ry - wy * this.zoom;
    this.applyView();
    this.cb.onZoom && this.cb.onZoom(this.zoom);
  };

  Editor.prototype._onDblClick = function (e) {
    if (e.target.closest && e.target.closest('.node')) return;
    this.cb.onRequestSearch && this.cb.onRequestSearch();
  };

  Editor.prototype._onDrop = function (e) {
    const type = e.dataTransfer && e.dataTransfer.getData('application/x-bp-node');
    if (!type) return;
    e.preventDefault();
    const w = this.toWorld(e.clientX, e.clientY);
    this.addNode(type, w.x - NODE_W / 2, w.y - 20);
  };

  /* ----------------------------------------------------------- propriétés */

  Editor.prototype._onControlInput = function (e) {
    const field = e.target;
    if (!field.dataset || !field.dataset.prop) return;
    const nodeEl = field.closest('.node');
    if (!nodeEl) return;
    const node = P.nodeById(this.graph, nodeEl.dataset.id);
    if (!node) return;
    node.props[field.dataset.prop] = field.value;
    this.emit();
  };

  Editor.prototype._onControlChange = function (e) {
    const field = e.target;
    if (!field.dataset || !field.dataset.prop) return;
    const nodeEl = field.closest('.node');
    if (!nodeEl) return;
    const node = P.nodeById(this.graph, nodeEl.dataset.id);
    if (!node) return;
    const dynamic = field.dataset.prop === 'params' || field.dataset.prop === 'args';
    if (dynamic) {
      this.render();
    }
    this.emit();
  };

  /* ---------------------------------------------------------------- vue */

  Editor.prototype.applyView = function () {
    this.world.style.transform = 'translate(' + this.pan.x + 'px,' + this.pan.y + 'px) scale(' + this.zoom + ')';
    const size = 24 * this.zoom;
    this.viewport.style.backgroundSize = size + 'px ' + size + 'px, ' + size + 'px ' + size + 'px';
    this.viewport.style.backgroundPosition = this.pan.x + 'px ' + this.pan.y + 'px';
  };

  Editor.prototype.toWorld = function (clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.pan.x) / this.zoom,
      y: (clientY - rect.top - this.pan.y) / this.zoom
    };
  };

  Editor.prototype._geom = function (node) {
    const def = BP.defOf(node);
    if (def.noPins) {
      const w = def.fixedWidth || 300;
      const h = def.fixedHeight || 150;
      return { w: w, h: h, rows: 0, pos: {} };
    }
    const pins = BP.pinsOf(node);
    const rows = Math.max(pins.inputs.length, pins.outputs.length);
    const propsH = (def.props || []).length * PROP_H;
    const w = NODE_W;
    const h = HEADER_H + rows * ROW_H + (propsH ? propsH + PAD : PAD);
    const pos = {};
    pins.inputs.forEach(function (p, i) {
      pos['in:' + p.id] = { x: 0, y: HEADER_H + i * ROW_H + ROW_H / 2 };
    });
    pins.outputs.forEach(function (p, i) {
      pos['out:' + p.id] = { x: w, y: HEADER_H + i * ROW_H + ROW_H / 2 };
    });
    return { w: w, h: h, rows: rows, pos: pos, pins: pins };
  };

  Editor.prototype.nodeEl = function (id) {
    return this.layer.querySelector('.node[data-id="' + id + '"]');
  };

  Editor.prototype.render = function () {
    this.computeGeoms();
    this.renderWires();
    const layer = this.layer;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    this.graph.nodes.forEach(function (node) {
      layer.appendChild(this._buildNode(node));
    }, this);
    this.updateSelection();
  };

  Editor.prototype.computeGeoms = function () {
    this.geoms = new Map();
    this.graph.nodes.forEach(function (n) {
      this.geoms.set(n.id, this._geom(n));
    }, this);
  };

  Editor.prototype._buildNode = function (node) {
    const def = BP.defOf(node);
    const g = this.geoms.get(node.id) || this._geom(node);
    const el = document.createElement('div');
    el.className = 'node' + (def.noPins ? ' note' : '');
    el.dataset.id = node.id;
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.style.width = g.w + 'px';
    el.style.height = g.h + 'px';
    el.style.setProperty('--accent', def.accent || '#888');

    const html = [];
    html.push(
      '<div class="nhead"><span class="dot"></span><span class="ntitle">' + esc(def.title) +
      '</span><span class="nbadge">' + esc(node.type === 'event_start' ? 'entrée' : '') + '</span></div>'
    );

    if (!def.noPins) {
      const pins = g.pins || BP.pinsOf(node);
      html.push('<div class="prow-wrap">');
      pins.inputs.forEach(function (p, i) {
        html.push(
          '<div class="prow in" style="top:' + (HEADER_H + i * ROW_H) + 'px">' +
          '<span class="pin k-' + p.kind + '" data-dir="in" data-pin="' + esc(p.id) + '" data-kind="' + p.kind + '"></span>' +
          (p.label ? '<span class="plabel">' + esc(p.label) + '</span>' : '') +
          '</div>'
        );
      });
      pins.outputs.forEach(function (p, i) {
        html.push(
          '<div class="prow out" style="top:' + (HEADER_H + i * ROW_H) + 'px">' +
          (p.label ? '<span class="plabel">' + esc(p.label) + '</span>' : '') +
          '<span class="pin k-' + p.kind + '" data-dir="out" data-pin="' + esc(p.id) + '" data-kind="' + p.kind + '"></span>' +
          '</div>'
        );
      });
      html.push('</div>');
    }

    const props = def.props || [];
    if (props.length) {
      if (def.noPins) {
        html.push('<div class="nprops note-props">');
        props.forEach(function (p) {
          html.push('<textarea data-prop="' + esc(p.id) + '" spellcheck="false">' +
            esc(node.props[p.id]) + '</textarea>');
        });
        html.push('</div>');
      } else {
        html.push('<div class="nprops" style="top:' + (HEADER_H + g.rows * ROW_H) + 'px">');
        props.forEach(function (p) {
          const value = node.props[p.id] == null ? '' : node.props[p.id];
          html.push('<label class="prop"><span>' + esc(p.label) + '</span>');
          if (p.control === 'select') {
            html.push('<select data-prop="' + esc(p.id) + '">');
            (p.options || []).forEach(function (opt) {
              html.push('<option value="' + esc(opt) + '"' + (String(value) === String(opt) ? ' selected' : '') + '>' +
                esc(opt) + '</option>');
            });
            html.push('</select>');
          } else {
            html.push('<input type="text" spellcheck="false" data-prop="' + esc(p.id) + '" value="' + esc(value) + '">');
          }
          html.push('</label>');
        });
        html.push('</div>');
      }
    }

    el.innerHTML = html.join('');
    return el;
  };

  Editor.prototype.updateSelection = function () {
    const sel = this.selection;
    this.layer.querySelectorAll('.node').forEach(function (el) {
      el.classList.toggle('selected', sel.has(el.dataset.id));
    });
    this.emitSelection();
  };

  Editor.prototype.endpoint = function (ref, dir) {
    const node = P.nodeById(this.graph, ref.node);
    if (!node) return null;
    const g = this.geoms.get(node.id);
    if (!g) return null;
    const p = g.pos[dir + ':' + ref.pin];
    if (!p) return null;
    return { x: node.x + p.x, y: node.y + p.y };
  };

  Editor.prototype.pinKind = function (ref, dir) {
    const node = P.nodeById(this.graph, ref.node);
    if (!node) return BP.K.ANY;
    const pin = BP.pinInfo(node, ref.pin, dir);
    return pin ? pin.kind : BP.K.ANY;
  };

  Editor.prototype.wirePath = function (a, b) {
    const dx = Math.max(40, Math.min(180, Math.abs(b.x - a.x) * 0.55));
    return 'M ' + a.x + ' ' + a.y + ' C ' + (a.x + dx) + ' ' + a.y + ', ' +
      (b.x - dx) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
  };

  Editor.prototype.renderWires = function () {
    const parts = [];
    this.graph.wires.forEach(function (w) {
      const a = this.endpoint(w.from, 'out');
      const b = this.endpoint(w.to, 'in');
      if (!a || !b) return;
      const kind = this.pinKind(w.from, 'out');
      const cls = 'wire k-' + kind + (this.selectedWire === w.id ? ' sel' : '');
      const d = this.wirePath(a, b);
      parts.push('<path class="wire-hit" data-wire="' + esc(w.id) + '" d="' + d + '"></path>');
      parts.push('<path class="' + cls + '" data-wire="' + esc(w.id) + '" d="' + d + '"></path>');
    }, this);

    if (this.dragState && this.dragState.type === 'wire' && this.dragPoint) {
      const pin = this.dragState.pin;
      const anchor = this.endpoint(pin, pin.dir);
      if (anchor) {
        const a = pin.dir === 'out' ? anchor : this.dragPoint;
        const b = pin.dir === 'out' ? this.dragPoint : anchor;
        parts.push('<path class="wire temp" d="' + this.wirePath(a, b) + '"></path>');
      }
    }
    this.svg.innerHTML = parts.join('');
  };

  /* ----------------------------------------------------------- actions */

  Editor.prototype.emit = function () {
    this.cb.onChange && this.cb.onChange(this.graph);
  };

  Editor.prototype.emitSelection = function () {
    this.cb.onSelection && this.cb.onSelection(this.selection, this.selectedWire);
  };

  Editor.prototype.stateString = function () {
    return JSON.stringify({ nodes: this.graph.nodes, wires: this.graph.wires });
  };

  Editor.prototype.pushState = function (state) {
    this.history.push(state || this.stateString());
    if (this.history.length > 120) this.history.shift();
    this.future.length = 0;
  };

  Editor.prototype.applyState = function (state) {
    const data = JSON.parse(state);
    this.graph.nodes = data.nodes;
    this.graph.wires = data.wires;
    this.selection = new Set();
    this.selectedWire = null;
    this.render();
    this.emit();
  };

  Editor.prototype.undo = function () {
    if (!this.history.length) return false;
    this.future.push(this.stateString());
    this.applyState(this.history.pop());
    return true;
  };

  Editor.prototype.redo = function () {
    if (!this.future.length) return false;
    this.history.push(this.stateString());
    this.applyState(this.future.pop());
    return true;
  };

  Editor.prototype.addNode = function (type, x, y) {
    this.pushState();
    const node = P.addNode(this.graph, type, snap(x), snap(y));
    this.selection = new Set([node.id]);
    this.selectedWire = null;
    this.render();
    this.emit();
    return node;
  };

  Editor.prototype.addNodeAtCenter = function (type) {
    const rect = this.viewport.getBoundingClientRect();
    const c = this.toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const g = this._geom({ type: type, props: {} });
    const node = this.addNode(type, c.x - g.w / 2, c.y - g.h / 2);
    this.ensureVisible(node);
    return node;
  };

  Editor.prototype.ensureVisible = function (node) {
    const rect = this.viewport.getBoundingClientRect();
    const sx = node.x * this.zoom + this.pan.x;
    const sy = node.y * this.zoom + this.pan.y;
    const margin = 80;
    if (sx < margin || sy < margin || sx > rect.width - margin || sy > rect.height - margin) {
      this.pan.x = rect.width / 2 - (node.x + 110) * this.zoom;
      this.pan.y = rect.height / 2 - (node.y + 60) * this.zoom;
      this.applyView();
    }
  };

  Editor.prototype.deleteSelection = function () {
    const graph = this.graph;
    const ids = Array.from(this.selection).filter(function (id) {
      const n = P.nodeById(graph, id);
      return n && n.type !== 'event_start';
    });
    const wire = this.selectedWire;
    if (!ids.length && !wire) return false;
    this.pushState();
    if (ids.length) P.removeNodes(this.graph, ids);
    if (wire) P.removeWire(this.graph, wire);
    this.selection = new Set();
    this.selectedWire = null;
    this.render();
    this.emit();
    return true;
  };

  Editor.prototype.selectAll = function () {
    this.graph.nodes.forEach(function (n) { this.selection.add(n.id); }, this);
    this.updateSelection();
  };

  Editor.prototype.setGraph = function (graph, opts) {
    this.graph = graph;
    this.selection = new Set();
    this.selectedWire = null;
    this.history = [];
    this.future = [];
    this.render();
    if (!opts || opts.fit !== false) this.fitView();
    this.emit();
  };

  Editor.prototype.getGraph = function () { return this.graph; };

  Editor.prototype.zoomBy = function (factor) {
    const rect = this.viewport.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const wx = (cx - rect.left - this.pan.x) / this.zoom;
    const wy = (cy - rect.top - this.pan.y) / this.zoom;
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.pan.x = (cx - rect.left) - wx * this.zoom;
    this.pan.y = (cy - rect.top) - wy * this.zoom;
    this.applyView();
    this.cb.onZoom && this.cb.onZoom(this.zoom);
  };

  Editor.prototype.setZoom = function (z) {
    this.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.applyView();
    this.cb.onZoom && this.cb.onZoom(this.zoom);
  };

  Editor.prototype.fitView = function () {
    const rect = this.viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!this.graph.nodes.length) {
      this.pan = { x: 80, y: 70 };
      this.zoom = 1;
      this.applyView();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.graph.nodes.forEach(function (n) {
      const g = this._geom(n);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + g.w);
      maxY = Math.max(maxY, n.y + g.h);
    }, this);
    const pad = 60;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const zoom = clamp(Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h), 0.35, 1.15);
    this.zoom = zoom;
    this.pan.x = (rect.width - w * zoom) / 2 - minX * zoom;
    this.pan.y = (rect.height - h * zoom) / 2 - minY * zoom;
    this.applyView();
    this.cb.onZoom && this.cb.onZoom(this.zoom);
  };

  BP.Editor = Editor;
})(typeof window !== 'undefined' ? window : globalThis);
