/* Application : interface, palette, onglets de langage, fichiers et raccourcis. */
(function () {
  'use strict';
  const BP = window.BP;
  const P = BP.model;

  const KEYWORDS = {
    python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'and', 'or', 'not',
      'import', 'from', 'as', 'class', 'pass', 'True', 'False', 'None', 'range', 'print', 'str', 'int'],
    csharp: ['using', 'namespace', 'class', 'static', 'void', 'public', 'private', 'int', 'double',
      'string', 'bool', 'var', 'new', 'if', 'else', 'for', 'while', 'return', 'true', 'false', 'null',
      'Console', 'WriteLine', 'Main', 'args'],
    cpp: ['include', 'using', 'namespace', 'std', 'int', 'double', 'string', 'bool', 'void', 'auto',
      'const', 'if', 'else', 'for', 'while', 'return', 'true', 'false', 'nullptr', 'cout', 'cin',
      'endl', 'main']
  };

  const state = {
    lang: 'python',
    path: null,
    dirty: false
  };

  const dom = {};
  let editor = null;
  let refreshTimer = null;
  let suppressDirty = false;
  let toastTimer = null;
  let draftTimer = null;

  const desktop = window.desktop || null;

  /* ------------------------------------------------------------- utilitaires */

  function q(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function span(cls, text) {
    return '<span class="t-' + cls + '">' + esc(text) + '</span>';
  }

  function highlight(src, lang) {
    const kws = KEYWORDS[lang] || KEYWORDS.python;
    let out = '';
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '"') {
        let j = i + 1;
        while (j < src.length) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '"') { j++; break; }
          j++;
        }
        out += span('str', src.slice(i, j));
        i = j;
        continue;
      }
      if (c === '/' && src[i + 1] === '/') { out += span('com', src.slice(i)); break; }
      if (c === '#') {
        out += span(lang === 'python' ? 'com' : 'pre', src.slice(i));
        break;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < src.length && /\w/.test(src[j])) j++;
        const word = src.slice(i, j);
        out += kws.indexOf(word) !== -1 ? span('kw', word) : esc(word);
        i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        let j = i + 1;
        while (j < src.length && /[0-9.]/.test(src[j])) j++;
        out += span('num', src.slice(i, j));
        i = j;
        continue;
      }
      out += esc(c);
      i++;
    }
    return out;
  }

  function isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function toast(message, duration) {
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.classList.remove('show'); }, duration || 2600);
  }

  /* ------------------------------------------------------ accès fichiers */

  const api = {
    openFile: function () {
      if (desktop) return desktop.openFile();
      return new Promise(function (resolve) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = function () {
          const file = input.files && input.files[0];
          if (!file) return resolve(null);
          const reader = new FileReader();
          reader.onload = function () {
            resolve({ path: null, name: file.name, content: String(reader.result) });
          };
          reader.readAsText(file);
        };
        input.click();
      });
    },
    readFile: function (filePath) {
      if (desktop) return desktop.readFile(filePath);
      return Promise.resolve({ error: 'Ouverture de fichier indisponible dans le navigateur.' });
    },
    saveFile: function (payload) {
      if (desktop) return desktop.saveFile(payload);
      download(payload.content, (payload.name || 'graphique') + '.blueprint.json');
      return Promise.resolve({ path: (payload.name || 'graphique') + '.blueprint.json', local: true });
    },
    saveFileAs: function (payload) {
      if (desktop) return desktop.saveFileAs(payload);
      download(payload.content, (payload.name || 'graphique') + '.blueprint.json');
      return Promise.resolve({ path: (payload.name || 'graphique') + '.blueprint.json', local: true });
    },
    exportCode: function (payload) {
      if (desktop) return desktop.exportCode(payload);
      const name = (payload.name || 'programme').replace(/[^\w\- ]+/g, '_');
      download(payload.content, name + '.' + payload.ext);
      return Promise.resolve({ path: name + '.' + payload.ext, local: true });
    },
    confirmUnsaved: function () {
      if (desktop) return desktop.confirmUnsaved();
      const ok = window.confirm('Le graphique contient des modifications non enregistrées. Continuer ?');
      return Promise.resolve(ok ? 'discard' : 'cancel');
    }
  };

  /* ---------------------------------------------- brouillon (sécurité plantage) */

  function scheduleDraft() {
    if (!desktop || !desktop.saveDraft) return;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(pushDraft, 5000);
  }

  function pushDraft() {
    draftTimer = null;
    if (!desktop || !desktop.saveDraft) return;
    if (!state.dirty) { desktop.clearDraft().catch(function () {}); return; }
    const graph = editor.getGraph();
    desktop.saveDraft({ content: P.serialize(graph), name: graph.name, path: state.path })
      .catch(function () { /* brouillon non critique */ });
  }

  function clearDraft() {
    if (!desktop || !desktop.clearDraft) return;
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    desktop.clearDraft().catch(function () {});
  }

  async function offerRecovery() {
    if (!desktop || !desktop.readDraft) return;
    let draft = null;
    try {
      draft = await desktop.readDraft();
    } catch (err) {
      return;
    }
    if (!draft) return;
    let recover = false;
    try {
      recover = await desktop.promptRecovery(draft.savedAt);
    } catch (err) {
      recover = false;
    }
    if (!recover) { desktop.clearDraft(); return; }
    try {
      const graph = P.parse(draft.content);
      suppressDirty = true;
      editor.setGraph(graph);
      suppressDirty = false;
      state.path = null;
      setDirty(true);
      refresh();
      toast('Graphique récupéré — pensez à l’enregistrer.', 6000);
    } catch (err) {
      desktop.clearDraft();
      toast('Brouillon illisible : il a été ignoré.', 5000);
    }
  }

  function download(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ------------------------------------------------------------- interface */

  function init() {
    ['viewport', 'paletteList', 'search', 'langTabs', 'code', 'problems', 'toast',
      'zoomLabel', 'statusNodes', 'statusWires', 'statusProblems', 'filename',
      'exampleSelect', 'toolbar'].forEach(function (id) { dom[id] = q(id); });

    editor = new BP.Editor(dom.viewport, {
      onChange: onGraphChange,
      onZoom: updateZoom,
      onNotice: toast,
      onRequestSearch: function () { dom.search.focus(); }
    });

    buildPalette();
    buildTabs();
    buildExamples();
    bindToolbar();
    bindKeys();
    bindDesktop();

    const first = BP.EXAMPLES[0];
    loadExample(first.id);
    updateZoom(editor.zoom);
    offerRecovery();

    // point d'accès utilisé par les outils de diagnostic et les tests
    window.bpStudio = { editor: editor, state: state, refresh: refresh, loadExample: loadExample };
  }

  function buildPalette() {
    const list = dom.paletteList;
    list.innerHTML = '';
    BP.CATEGORIES.forEach(function (cat) {
      const types = Object.keys(BP.DEFS).filter(function (t) { return BP.DEFS[t].category === cat; });
      if (!types.length) return;
      const group = document.createElement('div');
      group.className = 'pal-group';
      group.dataset.cat = cat;

      const head = document.createElement('button');
      head.className = 'pal-cat';
      head.innerHTML = '<span class="chev">▾</span><span>' + esc(cat) + '</span>';
      head.addEventListener('click', function () { group.classList.toggle('collapsed'); });

      const items = document.createElement('div');
      items.className = 'pal-items';
      types.forEach(function (type) {
        const def = BP.DEFS[type];
        const btn = document.createElement('button');
        btn.className = 'pal-item';
        btn.draggable = true;
        btn.dataset.type = type;
        btn.title = def.desc || def.title;
        btn.innerHTML = '<span class="pal-dot" style="background:' + def.accent + '"></span>' +
          '<span class="pal-title">' + esc(def.title) + '</span>';
        btn.addEventListener('click', function () { editor.addNodeAtCenter(type); });
        btn.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('application/x-bp-node', type);
          e.dataTransfer.effectAllowed = 'copy';
        });
        items.appendChild(btn);
      });

      group.appendChild(head);
      group.appendChild(items);
      list.appendChild(group);
    });

    dom.search.addEventListener('input', function () {
      const term = dom.search.value.trim().toLowerCase();
      list.querySelectorAll('.pal-group').forEach(function (group) {
        let visible = 0;
        group.querySelectorAll('.pal-item').forEach(function (btn) {
          const def = BP.DEFS[btn.dataset.type];
          const hay = (def.title + ' ' + (def.desc || '') + ' ' + def.category).toLowerCase();
          const match = !term || hay.indexOf(term) !== -1;
          btn.style.display = match ? '' : 'none';
          if (match) visible++;
        });
        group.style.display = visible ? '' : 'none';
        if (term) group.classList.remove('collapsed');
      });
    });
  }

  function buildTabs() {
    dom.langTabs.innerHTML = '';
    BP.LANGS.forEach(function (lang) {
      const btn = document.createElement('button');
      btn.className = 'tab' + (lang.id === state.lang ? ' active' : '');
      btn.dataset.lang = lang.id;
      btn.textContent = lang.label;
      btn.addEventListener('click', function () { setLang(lang.id); });
      dom.langTabs.appendChild(btn);
    });
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    dom.langTabs.appendChild(spacer);

    const copy = document.createElement('button');
    copy.className = 'mini';
    copy.textContent = 'Copier';
    copy.title = 'Copier le code affiché';
    copy.addEventListener('click', copyCode);
    dom.langTabs.appendChild(copy);

    const exp = document.createElement('button');
    exp.className = 'mini';
    exp.textContent = 'Exporter';
    exp.title = 'Enregistrer le code généré dans un fichier';
    exp.addEventListener('click', function () { exportCode(); });
    dom.langTabs.appendChild(exp);
  }

  function buildExamples() {
    const select = dom.exampleSelect;
    select.innerHTML = '<option value="">Exemples…</option>';
    BP.EXAMPLES.forEach(function (ex) {
      const opt = document.createElement('option');
      opt.value = ex.id;
      opt.textContent = ex.name;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () {
      const id = select.value;
      select.value = '';
      if (id) loadExample(id);
    });
  }

  function bindToolbar() {
    dom.toolbar.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      runAction(btn.dataset.action);
    });
  }

  function runAction(action) {
    switch (action) {
      case 'new': newGraph(); break;
      case 'open': openGraph(); break;
      case 'save': saveGraph(false); break;
      case 'save-as': saveGraph(true); break;
      case 'export': exportCode(); break;
      case 'undo': editor.undo(); break;
      case 'redo': editor.redo(); break;
      case 'delete': editor.deleteSelection(); break;
      case 'select-all': editor.selectAll(); break;
      case 'zoom-in': editor.zoomBy(1.2); break;
      case 'zoom-out': editor.zoomBy(1 / 1.2); break;
      case 'fit': editor.fitView(); break;
      default: break;
    }
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isTyping()) return;
        if (editor.deleteSelection()) e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a' && !isTyping()) {
        e.preventDefault();
        editor.selectAll();
        return;
      }
      if (e.key === 'Escape') {
        editor.selection.clear();
        editor.selectedWire = null;
        editor.updateSelection();
        editor.renderWires();
        return;
      }
      // Repli navigateur : le menu natif gère déjà ces raccourcis dans l'application de bureau.
      if (!desktop && mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo(); else editor.undo();
        return;
      }
      if (!desktop && mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        editor.redo();
      }
    });
  }

  function bindDesktop() {
    if (!desktop) return;
    desktop.onMenu(function (action) {
      if (action && action.indexOf('example:') === 0) {
        loadExample(action.slice('example:'.length));
      } else {
        runAction(action);
      }
    });
    desktop.onCloseRequest(function () { handleCloseRequest(); });
    if (desktop.onOpenPath) desktop.onOpenPath(function (filePath) { openPath(filePath); });
  }

  async function handleCloseRequest() {
    if (!state.dirty) {
      await flushDraft();
      desktop.close();
      return;
    }
    const answer = await api.confirmUnsaved();
    if (answer === 'cancel') return;
    if (answer === 'save') {
      const ok = await saveGraph(false);
      if (!ok) return;
    } else if (desktop && desktop.clearDraft) {
      await desktop.clearDraft();
    }
    await flushDraft();
    desktop.close();
  }

  /* Ferme proprement : annule la sauvegarde différée et efface le brouillon. */
  async function flushDraft() {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    if (desktop && desktop.clearDraft) await desktop.clearDraft();
  }

  /* ---------------------------------------------------------------- code */

  function setLang(lang) {
    state.lang = lang;
    dom.langTabs.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.lang === lang);
    });
    refresh();
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refresh();
    }, 70);
  }

  function refresh() {
    const result = BP.diagnose(editor.getGraph(), state.lang);
    renderCode(result.code);
    renderProblems(result.problems);
    updateStatus(result.problems);
  }

  function renderCode(code) {
    const lines = code.split('\n');
    dom.code.innerHTML = lines.map(function (line, index) {
      return '<div class="line"><span class="ln">' + (index + 1) + '</span>' +
        '<span class="lc">' + (highlight(line, state.lang) || '&nbsp;') + '</span></div>';
    }).join('');
    dom.code.dataset.raw = code;
  }

  function renderProblems(problems) {
    if (!problems.length) {
      dom.problems.innerHTML = '<div class="prob ok">✓ Aucun problème détecté</div>';
      return;
    }
    dom.problems.innerHTML = problems.map(function (p) {
      const icon = p.level === 'error' ? '✕' : '⚠';
      return '<button class="prob ' + p.level + '" data-node="' + esc(p.nodeId || '') + '">' +
        '<span class="prob-icon">' + icon + '</span><span>' + esc(p.message) + '</span></button>';
    }).join('');
    dom.problems.querySelectorAll('.prob[data-node]').forEach(function (btn) {
      const id = btn.dataset.node;
      if (!id) return;
      btn.addEventListener('click', function () { focusNode(id); });
    });
  }

  function focusNode(id) {
    const node = P.nodeById(editor.getGraph(), id);
    if (!node) return;
    editor.selection = new Set([id]);
    editor.updateSelection();
    const rect = editor.viewport.getBoundingClientRect();
    editor.pan.x = rect.width / 2 - (node.x + 110) * editor.zoom;
    editor.pan.y = rect.height / 2 - (node.y + 40) * editor.zoom;
    editor.applyView();
  }

  function updateStatus(problems) {
    const graph = editor.getGraph();
    dom.statusNodes.textContent = graph.nodes.length + (graph.nodes.length > 1 ? ' nœuds' : ' nœud');
    dom.statusWires.textContent = graph.wires.length + (graph.wires.length > 1 ? ' liaisons' : ' liaison');
    if (problems) {
      const errors = problems.filter(function (p) { return p.level === 'error'; }).length;
      const warnings = problems.length - errors;
      dom.statusProblems.className = 'status-problems ' + (errors ? 'bad' : (warnings ? 'warn' : 'ok'));
      dom.statusProblems.textContent = errors
        ? errors + ' erreur' + (errors > 1 ? 's' : '')
        : (warnings ? warnings + ' avertissement' + (warnings > 1 ? 's' : '') : 'Aucun problème');
    }
    const name = graph.name || 'Sans titre';
    dom.filename.textContent = name + (state.dirty ? ' •' : '');
    dom.filename.title = state.path || 'Non enregistré';
    document.title = name + (state.dirty ? ' •' : '') + ' — Blueprint Studio';
    if (desktop) desktop.setTitle(document.title);
  }

  function updateZoom(z) {
    if (dom.zoomLabel) dom.zoomLabel.textContent = Math.round(z * 100) + ' %';
  }

  function onGraphChange() {
    if (!suppressDirty) {
      setDirty(true);
      scheduleDraft();
    }
    updateStatus();
    scheduleRefresh();
  }

  function setDirty(value) {
    state.dirty = value;
    updateStatus();
  }

  /* ------------------------------------------------------------- fichiers */

  async function confirmDiscard() {
    if (!state.dirty) return true;
    const answer = await api.confirmUnsaved();
    if (answer === 'cancel') return false;
    if (answer === 'save') return await saveGraph(false);
    return true;
  }

  async function newGraph() {
    if (!(await confirmDiscard())) return;
    suppressDirty = true;
    const graph = P.newGraph('Sans titre');
    P.addNode(graph, 'event_start', 120, 120);
    editor.setGraph(graph);
    suppressDirty = false;
    state.path = null;
    setDirty(false);
    clearDraft();
    refresh();
    toast('Nouveau graphique');
  }

  async function openGraph() {
    if (!(await confirmDiscard())) return;
    const res = await api.openFile();
    if (!res) return;
    applyOpened(res);
  }

  /* Ouverture par le menu « Ouvrir récemment » ou par double-clic sur un fichier. */
  async function openPath(filePath) {
    if (!filePath) return;
    const res = await api.readFile(filePath);
    if (!res) return;
    if (res.error) { toast(res.error, 5200); return; }
    if (!(await confirmDiscard())) return;
    applyOpened(res);
  }

  function applyOpened(res) {
    if (!res) return;
    if (res.error) { toast(res.error, 5200); return; }
    try {
      const graph = P.parse(res.content);
      if (!graph.name || graph.name === 'Sans titre') {
        const base = (res.path || res.name || '').split(/[\\/]/).pop() || '';
        graph.name = base.replace(/\.blueprint\.json$/i, '').replace(/\.json$/i, '') || 'Sans titre';
      }
      suppressDirty = true;
      editor.setGraph(graph);
      suppressDirty = false;
      state.path = res.path || null;
      setDirty(false);
      clearDraft();
      refresh();
      toast('Ouvert : ' + graph.name);
    } catch (err) {
      toast('Fichier ignoré : ' + err.message, 5200);
    }
  }

  async function saveGraph(asNew) {
    const graph = editor.getGraph();
    const content = P.serialize(graph);
    const payload = { path: asNew ? null : state.path, content: content, name: graph.name };
    const res = asNew ? await api.saveFileAs(payload) : await api.saveFile(payload);
    if (!res) return false;
    if (res.error) { toast(res.error, 5200); return false; }
    if (res.path) state.path = res.path;
    setDirty(false);
    if (!graph.name || graph.name === 'Sans titre') {
      const base = (res.path || '').split(/[\\/]/).pop() || '';
      const guess = base.replace(/\.blueprint\.json$/i, '').replace(/\.json$/i, '');
      if (guess) { graph.name = guess; setDirty(false); }
    }
    clearDraft();
    toast('Graphique enregistré');
    return true;
  }

  async function exportCode() {
    const graph = editor.getGraph();
    const info = BP.LANGS.filter(function (l) { return l.id === state.lang; })[0];
    const result = BP.diagnose(graph, state.lang);
    const errors = result.problems.filter(function (p) { return p.level === 'error'; });
    if (errors.length) {
      toast('Export possible, mais ' + errors.length + ' erreur(s) à corriger dans le graphique.');
    }
    const base = result.suggestedName ||
      (graph.name || 'programme').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'programme';
    const res = await api.exportCode({
      content: result.code,
      lang: state.lang,
      ext: info.ext,
      name: base
    });
    if (res && res.error) toast(res.error, 5200);
    else if (res && res.path) toast('Code ' + info.label + ' exporté : ' + res.path);
  }

  async function copyCode() {
    const code = dom.code.dataset.raw || '';
    try {
      await navigator.clipboard.writeText(code);
      toast('Code copié dans le presse-papiers');
    } catch (err) {
      const area = document.createElement('textarea');
      area.value = code;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      toast('Code copié dans le presse-papiers');
    }
  }

  function loadExample(id) {
    const example = BP.EXAMPLES.filter(function (e) { return e.id === id; })[0];
    if (!example) return;
    const graph = JSON.parse(JSON.stringify(example.graph));
    suppressDirty = true;
    editor.setGraph(graph);
    suppressDirty = false;
    state.path = null;
    setDirty(false);
    clearDraft();
    refresh();
    toast('Exemple : ' + example.name);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
