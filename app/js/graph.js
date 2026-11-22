/* Modèle de graphe : création, connexion, validation, sérialisation. */
(function (root) {
  'use strict';
  const BP = (root.BP = root.BP || {});

  let seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || 'n') + seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function newGraph(name) {
    return {
      format: 'blueprint-studio',
      version: 1,
      name: name || 'Sans titre',
      nodes: [],
      wires: []
    };
  }

  function nodeById(graph, id) {
    for (let i = 0; i < graph.nodes.length; i++) {
      if (graph.nodes[i].id === id) return graph.nodes[i];
    }
    return null;
  }

  function createNode(type, x, y) {
    const def = BP.DEFS[type];
    if (!def) throw new Error('Type de nœud inconnu : ' + type);
    const props = {};
    (def.props || []).forEach(function (p) { props[p.id] = p.def; });
    return { id: uid('n'), type: type, x: Math.round(x), y: Math.round(y), props: props };
  }

  function addNode(graph, type, x, y) {
    const node = createNode(type, x, y);
    graph.nodes.push(node);
    return node;
  }

  function removeNodes(graph, ids) {
    const set = new Set(ids);
    graph.nodes = graph.nodes.filter(function (n) { return !set.has(n.id); });
    graph.wires = graph.wires.filter(function (w) {
      return !set.has(w.from.node) && !set.has(w.to.node);
    });
  }

  function nextNode(graph, nodeId, pinId) {
    for (let i = 0; i < graph.wires.length; i++) {
      const w = graph.wires[i];
      if (w.from.node === nodeId && w.from.pin === pinId) return w.to.node;
    }
    return null;
  }

  function wireInto(graph, nodeId, pinId) {
    for (let i = 0; i < graph.wires.length; i++) {
      const w = graph.wires[i];
      if (w.to.node === nodeId && w.to.pin === pinId) return w;
    }
    return null;
  }

  /** Vérifie qu'une connexion est possible. */
  function canConnect(graph, from, to) {
    if (!from || !to) return { ok: false, reason: 'Connexion incomplète.' };
    if (from.node === to.node) return { ok: false, reason: 'Un nœud ne peut pas se connecter à lui-même.' };
    if (from.dir !== 'out' || to.dir !== 'in') return { ok: false, reason: 'Une liaison va d’une sortie vers une entrée.' };
    const start = nodeById(graph, from.node);
    const end = nodeById(graph, to.node);
    if (!start || !end) return { ok: false, reason: 'Nœud introuvable.' };
    const fromPin = BP.pinInfo(start, from.pin, 'out');
    const toPin = BP.pinInfo(end, to.pin, 'in');
    if (!fromPin || !toPin) return { ok: false, reason: 'Broche introuvable.' };
    const fromExec = fromPin.kind === BP.K.EXEC;
    const toExec = toPin.kind === BP.K.EXEC;
    if (fromExec !== toExec) {
      return { ok: false, reason: 'On ne peut pas relier un flux d’exécution à une valeur.' };
    }
    if (nextNode(graph, from.node, from.pin) === to.node) {
      return { ok: false, reason: 'Ces nœuds sont déjà reliés.' };
    }
    return { ok: true };
  }

  function connect(graph, from, to) {
    const check = canConnect(graph, from, to);
    if (!check.ok) return check;
    const start = nodeById(graph, from.node);
    const pin = BP.pinInfo(start, from.pin, 'out');
    if (pin && pin.kind !== BP.K.EXEC) {
      // une valeur ne peut alimenter qu'une seule entrée : on remplace la liaison existante
      graph.wires = graph.wires.filter(function (w) {
        return !(w.to.node === to.node && w.to.pin === to.pin);
      });
    } else {
      // un flux de sortie ne peut pointer que vers une seule entrée
      graph.wires = graph.wires.filter(function (w) {
        return !(w.from.node === from.node && w.from.pin === from.pin);
      });
    }
    graph.wires.push({
      id: uid('w'),
      from: { node: from.node, pin: from.pin },
      to: { node: to.node, pin: to.pin }
    });
    return { ok: true };
  }

  function removeWire(graph, wireId) {
    graph.wires = graph.wires.filter(function (w) { return w.id !== wireId; });
  }

  /** Toutes les variables déclarées (déclarations + paramètres de fonctions). */
  function declaredVariables(graph) {
    const names = new Set();
    graph.nodes.forEach(function (n) {
      if (n.type === 'var_decl') names.add(BP.sanitizeIdent(n.props.name, 'x'));
      if (n.type === 'array_decl') names.add(BP.sanitizeIdent(n.props.name, 'liste'));
      if (n.type === 'dict_decl') names.add(BP.sanitizeIdent(n.props.name, 'dico'));
      if (n.type === 'for_each') names.add(BP.sanitizeIdent(n.props.var, 'element'));
      if (n.type === 'for_range') names.add(BP.sanitizeIdent(n.props.var, 'i'));
      if (n.type === 'function_def') {
        BP.parseParams(n.props.params).forEach(function (p) { names.add(p.name); });
      }
    });
    return names;
  }

  function functionDefs(graph) {
    return graph.nodes.filter(function (n) { return n.type === 'function_def'; });
  }

  /** Nœuds qui modifient un tableau sur place : ils exigent une variable. */
  const MUTATING_ARRAY = ['array_push', 'array_set', 'array_insert', 'array_remove',
    'array_sort', 'array_reverse', 'array_clear'];

  /** Contrôles de cohérence affichés dans le panneau de diagnostics. */
  function validate(graph) {
    const problems = [];
    function add(level, message, nodeId) {
      problems.push({ level: level, message: message, nodeId: nodeId || null });
    }

    const starts = graph.nodes.filter(function (n) { return n.type === 'event_start'; });
    if (starts.length === 0) add('error', 'Aucun nœud « Début » : le programme n’a pas de point d’entrée.');
    if (starts.length > 1) add('warning', 'Plusieurs nœuds « Début » : seul le premier est utilisé.');

    const seenNames = new Set();
    functionDefs(graph).forEach(function (n) {
      const name = BP.sanitizeIdent(n.props.name, '');
      if (!name) add('error', 'Une fonction n’a pas de nom.', n.id);
      if (seenNames.has(name)) add('error', 'Deux fonctions portent le nom « ' + name + ' ».', n.id);
      seenNames.add(name);
      if (n.props.rettype !== 'void') {
        let hasReturn = false;
        graph.nodes.forEach(function (m) {
          if (m.type !== 'return_value') return;
          let cur = m.id;
          const guard = new Set();
          while (cur && !guard.has(cur)) {
            guard.add(cur);
            let prev = null;
            for (let i = 0; i < graph.wires.length; i++) {
              const w = graph.wires[i];
              if (w.to.node === cur) { prev = w.from.node; break; }
            }
            if (prev) cur = prev; else break;
            const src = nodeById(graph, cur);
            if (src && src.type === 'function_def' && src.id === n.id) { hasReturn = true; break; }
          }
        });
        if (!hasReturn) add('warning', 'La fonction « ' + name + ' » ne contient aucun nœud « Retourner ».', n.id);
      }
    });

    graph.nodes.forEach(function (n) {
      if (n.type === 'call_func' || n.type === 'call_stmt') {
        const name = BP.sanitizeIdent(n.props.name, '');
        if (name && !seenNames.has(name)) {
          add('error', 'Appel à la fonction inconnue « ' + name + ' ».', n.id);
        }
      }
      if (n.type === 'set_var' || n.type === 'get_var') {
        const name = BP.sanitizeIdent(n.props.name, '');
        if (name && !declaredVariables(graph).has(name)) {
          add('warning', 'La variable « ' + name + ' » n’est jamais déclarée (nœud « Déclarer variable »).', n.id);
        }
      }
      if (n.type === 'literal_number') {
        const raw = String(n.props.value).trim().replace(',', '.');
        if (raw !== '' && isNaN(Number(raw))) {
          add('error', '« ' + n.props.value + ' » n’est pas un nombre valide.', n.id);
        }
      }
      if (n.type === 'math' && n.props.op === '/' ) {
        // information utile : division entière en C# / C++
        const a = wireInto(graph, n.id, 'a');
        if (!a) return;
      }
      if (n.type === 'var_decl' || n.type === 'set_var' || n.type === 'get_var' ||
          n.type === 'function_def' || n.type === 'call_func') {
        // identifiants nettoyés silencieusement : rien à signaler
      }
    });

    graph.nodes.forEach(function (n) {
      if (!BP.DEFS[n.type]) return;
      BP.pinsOf(n).inputs.forEach(function (pin) {
        if (pin.kind !== BP.K.ARRAY) return;
        if (!wireInto(graph, n.id, pin.id)) {
          add('warning', '« ' + BP.DEFS[n.type].title +
            ' » n’a aucun tableau relié : un tableau vide sera utilisé.', n.id);
        }
      });
      if (MUTATING_ARRAY.indexOf(n.type) !== -1) {
        const wire = wireInto(graph, n.id, 'array');
        const src = wire ? nodeById(graph, wire.from.node) : null;
        if (src && src.type !== 'get_var') {
          add('warning', '« ' + BP.DEFS[n.type].title +
            ' » modifie un tableau : reliez une variable (« Lire variable »), sinon la modification est perdue.', n.id);
        }
      }
    });

    if (graph.nodes.length === 0) add('warning', 'Le graphique est vide.');
    return problems;
  }

  function clone(graph) {
    return JSON.parse(JSON.stringify(graph));
  }

  function serialize(graph) {
    return JSON.stringify({
      format: graph.format,
      version: graph.version,
      name: graph.name,
      nodes: graph.nodes.map(function (n) {
        return { id: n.id, type: n.type, x: n.x, y: n.y, props: n.props };
      }),
      wires: graph.wires
    }, null, 2);
  }

  function parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('Fichier illisible : ce n’est pas du JSON valide.');
    }
    if (!data || !Array.isArray(data.nodes)) {
      throw new Error('Fichier blueprint invalide (clé « nodes » manquante).');
    }
    const graph = newGraph(data.name || 'Sans titre');
    graph.nodes = data.nodes.map(function (n) {
      if (!BP.DEFS[n.type]) throw new Error('Type de nœud inconnu dans le fichier : ' + n.type);
      return {
        id: n.id || uid('n'),
        type: n.type,
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        props: Object.assign({}, n.props || {})
      };
    });
    graph.wires = (data.wires || []).filter(function (w) {
      return w && w.from && w.to && nodeById(graph, w.from.node) && nodeById(graph, w.to.node);
    }).map(function (w) {
      return { id: w.id || uid('w'), from: w.from, to: w.to };
    });
    return graph;
  }

  BP.model = {
    uid: uid,
    newGraph: newGraph,
    nodeById: nodeById,
    createNode: createNode,
    addNode: addNode,
    removeNodes: removeNodes,
    nextNode: nextNode,
    wireInto: wireInto,
    canConnect: canConnect,
    connect: connect,
    removeWire: removeWire,
    declaredVariables: declaredVariables,
    functionDefs: functionDefs,
    validate: validate,
    clone: clone,
    serialize: serialize,
    parse: parse
  };
})(typeof window !== 'undefined' ? window : globalThis);
