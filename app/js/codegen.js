/* Génération de code Python / C# / C++ à partir du graphe. */
(function (root) {
  'use strict';
  const BP = (root.BP = root.BP || {});
  const P = BP.model;

  const LANGS = [
    { id: 'python', label: 'Python', ext: 'py', comment: '#', runnable: true },
    { id: 'csharp', label: 'C#', ext: 'cs', comment: '//', runnable: false },
    { id: 'cpp', label: 'C++', ext: 'cpp', comment: '//', runnable: false },
    { id: 'unity', label: 'Unity', ext: 'cs', comment: '//', runnable: false }
  ];
  BP.LANGS = LANGS;

  /* Nom de classe MonoBehaviour : Unity impose le même nom pour le script et sa
     classe, on le déduit donc du nom du graphique (sans accents ni espaces). */
  function unityClassName(name) {
    const plain = String(name == null ? '' : name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const words = plain.split(/[^A-Za-z0-9]+/).filter(Boolean);
    let ident = words.map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join('');
    if (!ident) return 'BlueprintScript';
    if (!/^[A-Za-z_]/.test(ident)) ident = 'Blueprint' + ident;
    return ident;
  }
  BP.unityClassName = unityClassName;

  function quote(value) {
    return JSON.stringify(String(value == null ? '' : value));
  }

  function Generator(graph, lang) {
    this.graph = graph;
    this.lang = lang || 'python';
    this.problems = [];
    this.stack = new Set();
    this.needs = new Set();
    /* champs [SerializeField] générés pour les nœuds de saisie (cible Unity) */
    this.unityFields = [];
    this.unityIoWarned = false;
    this.unityWait = false;
  }

  Generator.prototype.isPy = function () { return this.lang === 'python'; };
  Generator.prototype.isCs = function () { return this.lang === 'csharp' || this.lang === 'unity'; };
  Generator.prototype.isUnity = function () { return this.lang === 'unity'; };

  /* Unity n'écrit pas dans une console : Debug.Log va dans la Console de l'éditeur. */
  Generator.prototype.logLine = function (value) {
    return this.isUnity() ? 'Debug.Log(' + value + ');' : 'Console.WriteLine(' + value + ');';
  };

  Generator.prototype.unityClass = function () {
    return unityClassName(this.graph && this.graph.name);
  };

  /* Sous Unity, un chemin relatif part du dossier de sauvegarde du jeu
     (Application.persistentDataPath) et non du dossier de travail. */
  Generator.prototype.filePath = function (expression) {
    return this.isUnity() ? 'BpChemin(' + expression + ')' : expression;
  };

  /* Unity n'a pas de console d'entrée : chaque nœud de saisie devient un champ
     sérialisé, réglable dans l'Inspector, ce qui est la façon idiomatique de
     fournir une valeur à un script. */
  Generator.prototype.unityIo = function (node) {
    if (!this.isUnity() || this.unityIoWarned) return;
    this.unityIoWarned = true;
    this.problem('warning', 'Sous Unity, les chemins relatifs partent de Application.persistentDataPath ; les fichiers ne fonctionnent pas sur la cible WebGL.', node && node.id);
  };

  Generator.prototype.unityField = function (node, type, fallback) {
    for (let i = 0; i < this.unityFields.length; i++) {
      if (this.unityFields[i].node === node.id) return this.unityFields[i].name;
    }
    const name = 'bp_entree_' + BP.sanitizeIdent(node.id, 'valeur');
    const prompt = String((node.props && node.props.prompt) || fallback || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/"/g, '\\"');
    this.unityFields.push({ node: node.id, name: name, type: type, prompt: prompt });
    return name;
  };
  Generator.prototype.isCpp = function () { return this.lang === 'cpp'; };
  Generator.prototype.indent = function (n) { return '    '.repeat(n); };

  Generator.prototype.problem = function (level, message, nodeId) {
    this.problems.push({ level: level, message: message, nodeId: nodeId || null });
  };

  /* Bibliothèque d'aide ajoutée au fichier généré seulement si elle est utilisée. */
  Generator.prototype.need = function (key) { this.needs.add(key); };

  Generator.prototype.node = function (id) { return P.nodeById(this.graph, id); };
  Generator.prototype.nextOf = function (node, pin) { return P.nextNode(this.graph, node.id, pin); };

  /* ------------------------------------------------------------------ types */

  Generator.prototype.mapType = function (type) {
    if (this.isPy()) return '';
    if (type === 'string') return 'string';
    return type || 'int';
  };

  Generator.prototype.nullLiteral = function () {
    return this.isPy() ? 'None' : (this.isCs() ? 'null' : 'nullptr');
  };

  Generator.prototype.boolText = function (value) {
    const on = value === true || value === 'true' || value === 'vrai';
    if (this.isPy()) return on ? 'True' : 'False';
    return on ? 'true' : 'false';
  };

  Generator.prototype.literal = function (def) {
    if (def === undefined || def === null || def === '') return this.nullLiteral();
    if (def === 'true' || def === 'false') return this.boolText(def === 'true');
    return String(def);
  };

  Generator.prototype.numberLiteral = function (value) {
    let raw = String(value == null ? '' : value).trim().replace(/\s/g, '').replace(',', '.');
    if (raw === '') return '0';
    const n = Number(raw);
    if (!isFinite(n)) return '0';
    return String(raw);
  };

  Generator.prototype.defaultInit = function (type) {
    if (this.isPy()) {
      if (type === 'bool') return 'False';
      if (type === 'string') return '""';
      if (type === 'double') return '0.0';
      return '0';
    }
    if (type === 'bool') return 'false';
    if (type === 'string') return '""';
    if (type === 'double') return '0.0';
    return '0';
  };

  /* ------------------------------------------------------------ expressions */

  Generator.prototype.expr = function (node, pinId) {
    const wire = P.wireInto(this.graph, node.id, pinId);
    if (!wire) {
      const pin = BP.pinInfo(node, pinId, 'in');
      if (pin && pin.kind === BP.K.ARRAY) return this.arrayLiteral('');
      return this.literal(pin ? pin.def : null);
    }
    return this.valueExpr(wire.from.node, wire.from.pin);
  };

  /* ------------------------------------------------------------- tableaux */

  /** "3, bonjour, true" -> liste d'éléments typés. */
  Generator.prototype.arrayInfo = function (text) {
    const raw = String(text == null ? '' : text)
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    const items = raw.map(function (s) {
      const quoted = (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') ||
        (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'");
      if (quoted && s.length >= 2) return { kind: 'string', text: s.slice(1, -1) };
      if (/^(true|false|vrai|faux)$/i.test(s)) {
        return { kind: 'bool', text: /^(true|vrai)$/i.test(s) };
      }
      if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: 'number', text: s };
      return { kind: 'string', text: s };
    });

    let type = 'int';
    if (items.length) {
      if (items.every(function (i) { return i.kind === 'bool'; })) type = 'bool';
      else if (items.every(function (i) { return i.kind === 'number'; })) {
        type = items.some(function (i) { return i.text.indexOf('.') !== -1; }) ? 'double' : 'int';
      } else type = 'string';
    }
    return { items: items, type: type };
  };

  Generator.prototype.arrayLiteral = function (text) {
    const info = this.arrayInfo(text);
    const type = info.type;
    const parts = info.items.map(function (item) {
      if (type === 'string') {
        return quote(item.kind === 'bool' ? (item.text ? 'true' : 'false') : item.text);
      }
      if (type === 'bool') return this.boolText(item.text);
      return item.text;
    }, this);

    if (this.isPy()) return '[' + parts.join(', ') + ']';
    if (parts.length === 0) {
      if (this.isCs()) { this.need('list'); return 'new List<int>()'; }
      this.need('vector');
      return 'vector<int>()';
    }
    if (this.isCs()) {
      this.need('list');
      return 'new List<' + type + '> { ' + parts.join(', ') + ' }';
    }
    this.need('vector');
    return 'vector<' + type + '>{' + parts.join(', ') + '}';
  };

  /** Noms des variables déclarées comme tableaux (pour connaître leur type). */
  Generator.prototype.arrayVars = function () {
    if (!this._arrayVars) {
      const names = new Set();
      this.graph.nodes.forEach(function (n) {
        if (n.type === 'array_decl') names.add(BP.sanitizeIdent(n.props.name, 'liste'));
      });
      this._arrayVars = names;
    }
    return this._arrayVars;
  };

  /** Type des éléments des tableaux déclarés (« Déclarer tableau »). */
  Generator.prototype.arrayTypes = function () {
    if (!this._arrayTypes) {
      const types = new Map();
      this.graph.nodes.forEach(function (n) {
        if (n.type !== 'array_decl') return;
        const element = BP.VAL_TYPES.indexOf(n.props.etype) === -1 ? 'int' : n.props.etype;
        types.set(BP.sanitizeIdent(n.props.name, 'liste'), element);
      });
      this._arrayTypes = types;
    }
    return this._arrayTypes;
  };

  /** Type des éléments du tableau relié à une entrée de boucle, si connu. */
  Generator.prototype.arrayElementTypeOf = function (node, pinId) {
    const wire = P.wireInto(this.graph, node.id, pinId);
    if (!wire) return null;
    const src = this.node(wire.from.node);
    if (!src || src.type !== 'get_var') return null;
    return this.arrayTypes().get(BP.sanitizeIdent(src.props.name, 'liste')) || null;
  };

  /** Noms des variables déclarées comme dictionnaires. */
  Generator.prototype.dictVars = function () {
    if (!this._dictVars) {
      const names = new Set();
      this.graph.nodes.forEach(function (n) {
        if (n.type === 'dict_decl') names.add(BP.sanitizeIdent(n.props.name, 'dico'));
      });
      this._dictVars = names;
    }
    return this._dictVars;
  };

  /** Types de clés et de valeurs des dictionnaires déclarés. */
  Generator.prototype.dictTypes = function () {
    if (!this._dictTypes) {
      const types = new Map();
      this.graph.nodes.forEach(function (n) {
        if (n.type !== 'dict_decl') return;
        types.set(BP.sanitizeIdent(n.props.name, 'dico'), {
          key: BP.VAL_TYPES.indexOf(n.props.ktype) === -1 ? 'string' : n.props.ktype,
          value: BP.VAL_TYPES.indexOf(n.props.vtype) === -1 ? 'int' : n.props.vtype
        });
      });
      this._dictTypes = types;
    }
    return this._dictTypes;
  };

  /** Types d'un dictionnaire relié à une broche (via « Lire variable »). */
  Generator.prototype.dictInfoOf = function (node, pinId) {
    const wire = P.wireInto(this.graph, node.id, pinId);
    if (!wire) return null;
    const src = this.node(wire.from.node);
    if (!src || src.type !== 'get_var') return null;
    return this.dictTypes().get(BP.sanitizeIdent(src.props.name, 'dico')) || null;
  };

  /** Valeur par défaut d'un type, pour « Lire dans le dictionnaire ». */
  Generator.prototype.defaultOf = function (type) {
    if (type === 'string') return '""';
    if (type === 'bool') return this.isPy() ? 'False' : 'false';
    if (type === 'double') return '0.0';
    return '0';
  };

  /** Type de la broche de sortie reliée à une entrée (null si rien n'est relié). */
  Generator.prototype.pinKindOf = function (node, pinId) {
    const wire = P.wireInto(this.graph, node.id, pinId);
    if (!wire) return null;
    const src = this.node(wire.from.node);
    if (!src) return null;
    if (src.type === 'get_var' && this.dictVars().has(BP.sanitizeIdent(src.props.name, 'x'))) {
      return BP.K.DICT;
    }
    if (src.type === 'get_var' && this.arrayVars().has(BP.sanitizeIdent(src.props.name, 'x'))) {
      return BP.K.ARRAY;
    }
    const pin = BP.pinInfo(src, wire.from.pin, 'out');
    return pin ? pin.kind : null;
  };

  Generator.prototype.valueExpr = function (nodeId, pinId) {
    const node = this.node(nodeId);
    if (!node) return '0';
    const key = nodeId + ':' + pinId;
    if (this.stack.has(key)) {
      this.problem('error', 'Cycle détecté dans une liaison de données.', nodeId);
      return this.nullLiteral();
    }
    this.stack.add(key);
    const result = this.rawValue(node, pinId);
    this.stack.delete(key);
    return result;
  };

  Generator.prototype.rawValue = function (node, pinId) {
    switch (node.type) {
      case 'literal_number':
        return this.numberLiteral(node.props.value);
      case 'literal_string':
        return quote(node.props.value);
      case 'literal_bool':
        return this.boolText(String(node.props.value) === 'true');
      case 'get_var':
        return BP.sanitizeIdent(node.props.name, 'x');
      case 'math': {
        const a = this.expr(node, 'a');
        const b = this.expr(node, 'b');
        const op = ['+', '-', '*', '/', '%'].indexOf(node.props.op) === -1 ? '+' : node.props.op;
        return '(' + a + ' ' + op + ' ' + b + ')';
      }
      case 'compare': {
        const a = this.expr(node, 'a');
        const b = this.expr(node, 'b');
        const op = ['==', '!=', '<', '>', '<=', '>='].indexOf(node.props.op) === -1 ? '==' : node.props.op;
        return '(' + a + ' ' + op + ' ' + b + ')';
      }
      case 'format': {
        const a = this.expr(node, 'a');
        const b = this.expr(node, 'b');
        /* En C++, deux littéraux ne peuvent pas être additionnés : on force un std::string. */
        if (this.isCpp()) return '(string(' + a + ') + ' + b + ')';
        return '(' + a + ' + ' + b + ')';
      }
      case 'call_func': {
        const name = BP.sanitizeIdent(node.props.name, 'fonction');
        const args = BP.parseArgs(node.props.args).map(function (argName) {
          return this.expr(node, 'arg:' + argName);
        }, this);
        return name + '(' + args.join(', ') + ')';
      }
      case 'array_new':
        return this.arrayLiteral(node.props.items);
      case 'array_length': {
        const arr = this.expr(node, 'array');
        if (this.isPy()) return 'len(' + arr + ')';
        if (this.isCs()) { this.need('list'); return arr + '.Count'; }
        this.need('vector');
        return '(int)(' + arr + '.size())';
      }
      case 'array_get': {
        const arr = this.expr(node, 'array');
        const index = this.expr(node, 'index');
        if (this.isPy() || this.isCs()) return arr + '[' + index + ']';
        /* .at() lève std::out_of_range au lieu de lire hors du tableau. */
        return arr + '.at(static_cast<std::size_t>((int)(' + index + ')))';
      }
      case 'input_text': {
        const invite = quote(node.props.prompt);
        if (this.isUnity()) return this.unityField(node, 'string', 'Texte');
        if (this.isPy()) return 'input(' + invite + ')';
        if (this.isCs()) { this.need('saisie'); return 'BpLireSaisie(' + invite + ')'; }
        this.need('saisie');
        return 'bp_lire_saisie(' + invite + ')';
      }
      case 'input_number': {
        const invite = quote(node.props.prompt);
        /* Unity ne sérialise pas double : le champ est un float, converti à l'usage. */
        if (this.isUnity()) return '((double)' + this.unityField(node, 'float', 'Nombre') + ')';
        this.need('nombre');
        if (this.isPy()) return 'bp_lire_nombre(' + invite + ')';
        if (this.isCs()) return 'BpLireNombre(' + invite + ')';
        return 'bp_lire_nombre(' + invite + ')';
      }
      case 'file_read': {
        const chemin = this.expr(node, 'path');
        this.need('lireFichier');
        if (this.isPy()) return 'bp_lire_fichier(' + chemin + ')';
        if (this.isUnity()) {
          this.need('io');
          this.unityIo(node);
          return 'BpLireFichier(BpChemin(' + chemin + '))';
        }
        if (this.isCs()) { this.need('io'); return 'BpLireFichier(' + chemin + ')'; }
        this.need('fstream');
        this.need('sstream');
        return 'bp_lire_fichier(' + chemin + ')';
      }
      case 'dict_get': {
        const dict = this.expr(node, 'dict');
        const key = this.expr(node, 'key');
        const info = this.dictInfoOf(node, 'dict');
        if (this.isPy()) return dict + '.get(' + key + ', ' + this.defaultOf(info ? info.value : 'int') + ')';
        this.need('dictGet');
        if (this.isCs()) return 'BpLireDico(' + dict + ', ' + key + ')';
        this.need('unordered_map');
        return 'bp_lire_dico(' + dict + ', ' + key + ')';
      }
      case 'dict_has': {
        const dict = this.expr(node, 'dict');
        const key = this.expr(node, 'key');
        if (this.isPy()) return '(' + key + ' in ' + dict + ')';
        if (this.isCs()) return dict + '.ContainsKey(' + key + ')';
        this.need('unordered_map');
        return '(' + dict + '.find(' + key + ') != ' + dict + '.end())';
      }
      case 'dict_len': {
        const dict = this.expr(node, 'dict');
        if (this.isPy()) return 'len(' + dict + ')';
        if (this.isCs()) return dict + '.Count';
        this.need('unordered_map');
        return '(int)(' + dict + '.size())';
      }
      case 'random_number': {
        const a = this.expr(node, 'min');
        const b = this.expr(node, 'max');
        if (this.isPy()) {
          this.need('random');
          return 'random.randint(int(' + a + '), int(' + b + '))';
        }
        this.need('hasard');
        if (this.isCs()) return 'BpAleatoire((int)(' + a + '), (int)(' + b + '))';
        return 'bp_aleatoire((int)(' + a + '), (int)(' + b + '))';
      }
      case 'power': {
        const a = this.expr(node, 'a');
        const b = this.expr(node, 'b');
        if (this.isPy()) return '(' + a + ' ** ' + b + ')';
        if (this.isCs()) return 'Math.Pow(' + a + ', ' + b + ')';
        this.need('cmath');
        return 'pow(' + a + ', ' + b + ')';
      }
      case 'sqrt': {
        const v = this.expr(node, 'value');
        if (this.isPy()) { this.need('math'); return 'math.sqrt(' + v + ')'; }
        if (this.isCs()) return 'Math.Sqrt(' + v + ')';
        this.need('cmath');
        return 'sqrt(' + v + ')';
      }
      case 'absolute': {
        const v = this.expr(node, 'value');
        if (this.isPy()) return 'abs(' + v + ')';
        if (this.isCs()) return 'Math.Abs(' + v + ')';
        this.need('cmath');
        this.need('cstdlib');
        return 'abs(' + v + ')';
      }
      case 'rounding': {
        const v = this.expr(node, 'value');
        const mode = ['round', 'floor', 'ceil'].indexOf(node.props.op) === -1 ? 'round' : node.props.op;
        if (this.isPy()) {
          if (mode === 'round') return 'round(' + v + ')';
          this.need('math');
          return 'math.' + mode + '(' + v + ')';
        }
        if (this.isCs()) {
          return 'Math.' + (mode === 'round' ? 'Round' : (mode === 'floor' ? 'Floor' : 'Ceiling')) + '(' + v + ')';
        }
        this.need('cmath');
        return mode + '(' + v + ')';
      }
      case 'round_n': {
        const v = this.expr(node, 'value');
        const n = this.expr(node, 'decimals');
        if (this.isPy()) return 'round(' + v + ', int(' + n + '))';
        if (this.isCs()) return 'Math.Round(' + v + ', (int)(' + n + '))';
        this.need('arrondir');
        return 'bp_arrondir(' + v + ', (int)(' + n + '))';
      }
      case 'minmax': {
        const a = this.expr(node, 'a');
        const b = this.expr(node, 'b');
        const fn = node.props.op === 'max' ? 'max' : 'min';
        if (this.isPy()) return fn + '(' + a + ', ' + b + ')';
        if (this.isCs()) return 'Math.' + (fn === 'max' ? 'Max' : 'Min') + '(' + a + ', ' + b + ')';
        this.need('algorithm');
        return fn + '(' + a + ', ' + b + ')';
      }
      case 'pi':
        return '3.141592653589793';
      case 'logic': {
        const a = this.expr(node, 'a');
        const b = this.expr(node, 'b');
        if (this.isPy()) return '(' + a + (node.props.op === 'ou' ? ' or ' : ' and ') + b + ')';
        return '(' + a + (node.props.op === 'ou' ? ' || ' : ' && ') + b + ')';
      }
      case 'not': {
        const v = this.expr(node, 'value');
        return this.isPy() ? '(not ' + v + ')' : '(!(' + v + '))';
      }
      case 'array_contains': {
        const arr = this.expr(node, 'array');
        const value = this.expr(node, 'value');
        if (this.isPy()) return '(' + value + ' in ' + arr + ')';
        if (this.isCs()) return arr + '.Contains(' + value + ')';
        this.need('contient');
        return 'bp_contient(' + arr + ', ' + value + ')';
      }
      case 'array_index_of': {
        const arr = this.expr(node, 'array');
        const value = this.expr(node, 'value');
        if (this.isCs()) return arr + '.IndexOf(' + value + ')';
        this.need('indice');
        return 'bp_indice(' + arr + ', ' + value + ')';
      }
      case 'array_sum': {
        const arr = this.expr(node, 'array');
        if (this.isPy()) return 'sum(' + arr + ')';
        if (this.isCs()) { this.need('linq'); return arr + '.Sum()'; }
        this.need('somme');
        return 'bp_somme(' + arr + ')';
      }
      case 'text_length': {
        const t = this.expr(node, 'text');
        if (this.isPy()) return 'len(' + t + ')';
        if (this.isCs()) return t + '.Length';
        this.need('texteUnicode');
        return '(int)(bp_taille_texte(' + t + '))';
      }
      case 'text_case': {
        const t = this.expr(node, 'text');
        const upper = node.props.op !== 'minuscules';
        if (this.isPy()) return t + (upper ? '.upper()' : '.lower()');
        if (this.isCs()) return t + (upper ? '.ToUpper()' : '.ToLower()');
        this.need('casse');
        return (upper ? 'bp_majuscules(' : 'bp_minuscules(') + t + ')';
      }
      case 'text_replace': {
        const t = this.expr(node, 'text');
        const from = this.expr(node, 'search');
        const to = this.expr(node, 'replacement');
        if (this.isPy()) return t + '.replace(' + from + ', ' + to + ')';
        if (this.isCs()) return t + '.Replace(' + from + ', ' + to + ')';
        this.need('remplacer');
        return 'bp_remplacer(' + t + ', ' + from + ', ' + to + ')';
      }
      case 'text_contains': {
        const t = this.expr(node, 'text');
        const needle = this.expr(node, 'search');
        if (this.isPy()) return '(' + needle + ' in ' + t + ')';
        if (this.isCs()) return t + '.Contains(' + needle + ')';
        this.need('contientTexte');
        return 'bp_contient_texte(' + t + ', ' + needle + ')';
      }
      case 'text_substring': {
        const t = this.expr(node, 'text');
        const start = this.expr(node, 'start');
        const length = this.expr(node, 'length');
        this.need('sousTexte');
        if (this.isPy()) return 'bp_sous_texte(' + t + ', int(' + start + '), int(' + length + '))';
        if (this.isCs()) return 'BpSousTexte(' + t + ', (int)(' + start + '), (int)(' + length + '))';
        return 'bp_sous_texte(' + t + ', (int)(' + start + '), (int)(' + length + '))';
      }
      case 'text_split': {
        const t = this.expr(node, 'text');
        const sep = this.expr(node, 'separator');
        if (this.isPy()) return t + '.split(' + sep + ')';
        if (this.isCs()) {
          this.need('list');
          return 'new List<string>(' + t + '.Split(new string[] { ' + sep + ' }, StringSplitOptions.None))';
        }
        this.need('decouper');
        return 'bp_decouper(' + t + ', ' + sep + ')';
      }
      case 'text_join': {
        const arr = this.expr(node, 'array');
        const sep = this.expr(node, 'separator');
        /* str() sur chaque élément : un tableau de nombres doit aussi pouvoir être joint */
        if (this.isPy()) return sep + '.join(map(str, ' + arr + '))';
        if (this.isCs()) return 'string.Join(' + sep + ', ' + arr + ')';
        this.need('joindre');
        return 'bp_joindre(' + arr + ', ' + sep + ')';
      }
      case 'to_int': {
        const v = this.expr(node, 'value');
        this.need('versNombre');
        if (this.isPy()) return 'int(bp_vers_nombre(' + v + '))';
        if (this.isCs()) return '(int)BpVersNombre(' + v + ')';
        return '(int)bp_vers_nombre(' + v + ')';
      }
      case 'to_double': {
        const v = this.expr(node, 'value');
        this.need('versNombre');
        if (this.isPy()) return 'bp_vers_nombre(' + v + ')';
        if (this.isCs()) return 'BpVersNombre(' + v + ')';
        return 'bp_vers_nombre(' + v + ')';
      }
      case 'to_string': {
        const v = this.expr(node, 'value');
        if (this.isPy()) return 'str(' + v + ')';
        if (this.isCs()) return 'Convert.ToString(' + v + ', System.Globalization.CultureInfo.InvariantCulture)';
        this.need('texte');
        return 'bp_texte(' + v + ')';
      }
      case 'file_exists': {
        const p = this.expr(node, 'path');
        if (this.isPy()) { this.need('os'); return 'os.path.exists(' + p + ')'; }
        if (this.isCs()) { this.need('io'); return 'File.Exists(' + p + ')'; }
        this.need('fichierExiste');
        return 'bp_fichier_existe(' + p + ')';
      }
      case 'now_text': {
        if (this.isPy()) { this.need('datetime'); return 'datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")'; }
        if (this.isCs()) return 'DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss")';
        this.need('maintenant');
        return 'bp_maintenant()';
      }
      default:
        return this.nullLiteral();
    }
  };

  /* -------------------------------------------------------- flux exécutable */

  Generator.prototype.collect = function (startId, indent) {
    const out = [];
    if (startId) this.emitExec(startId, indent, out);
    return out;
  };

  Generator.prototype.emitExec = function (startId, indent, out) {
    let cur = startId;
    const guard = new Set();
    while (cur) {
      if (guard.has(cur)) {
        this.problem('error', 'Boucle infinie dans le flux d’exécution (le graphe revient sur un nœud déjà visité).', cur);
        return;
      }
      guard.add(cur);
      const node = this.node(cur);
      if (!node) return;
      const emitter = this['st_' + node.type];
      if (!emitter) {
        this.problem('error', 'Ce nœud ne produit pas d’instruction exécutable : ' + (BP.defOf(node).title || node.type), cur);
        return;
      }
      cur = emitter.call(this, node, indent, out);
    }
  };

  Generator.prototype.st_event_start = function (node) {
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_comment = function () {
    return null;
  };

  Generator.prototype.st_print = function (node, indent, out) {
    const kind = this.pinKindOf(node, 'value');
    const value = this.expr(node, 'value');
    if (kind === BP.K.ARRAY && !this.isPy()) {
      if (this.isCs()) {
        out.push(this.indent(indent) + this.logLine('"[" + string.Join(", ", ' + value + ') + "]"'));
      } else {
        this.need('afficheTableau');
        out.push(this.indent(indent) + 'bp_afficher_tableau(' + value + ');');
      }
      return this.nextOf(node, 'out');
    }
    if (this.isPy()) out.push(this.indent(indent) + 'print(' + value + ')');
    else if (this.isCs()) out.push(this.indent(indent) + this.logLine(value));
    else {
      /* bp_texte unifie booléens (True/False), décimaux et textes. */
      this.need('texte');
      out.push(this.indent(indent) + 'cout << bp_texte(' + value + ') << endl;');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_print_inline = function (node, indent, out) {
    const kind = this.pinKindOf(node, 'value');
    const value = this.expr(node, 'value');
    if (this.isUnity()) {
      this.problem('warning', 'Unity n’a pas de sortie sans retour à la ligne : « Afficher sans retour » apparaît comme une ligne de la Console.', node.id);
    }
    if (kind === BP.K.ARRAY && !this.isPy()) {
      if (this.isCs()) {
        const joined = '"[" + string.Join(", ", ' + value + ') + "]"';
        out.push(this.indent(indent) + (this.isUnity() ? 'Debug.Log(' + joined + ');' : 'Console.Write(' + joined + ');'));
      } else {
        this.need('afficheTableau');
        out.push(this.indent(indent) + 'bp_afficher_tableau(' + value + ', false);');
      }
      return this.nextOf(node, 'out');
    }
    if (this.isPy()) out.push(this.indent(indent) + 'print(' + value + ', end="")');
    else if (this.isCs()) out.push(this.indent(indent) + (this.isUnity() ? 'Debug.Log(' + value + ');' : 'Console.Write(' + value + ');'));
    else {
      this.need('texte');
      out.push(this.indent(indent) + 'cout << bp_texte(' + value + ') << flush;');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_wait = function (node, indent, out) {
    const seconds = this.expr(node, 'seconds');
    if (this.isUnity()) {
      /* Coroutine : le jeu continue de tourner pendant l'attente. */
      this.unityWait = true;
      out.push(this.indent(indent) + 'yield return new WaitForSeconds((float)(' + seconds + '));');
      return this.nextOf(node, 'out');
    }
    if (this.isPy()) {
      this.need('time');
      out.push(this.indent(indent) + 'time.sleep(' + seconds + ')');
    } else if (this.isCs()) {
      this.need('threading');
      if (this.isUnity()) {
        this.problem('warning', '« Attendre » utilise Thread.Sleep : cela bloque le fil principal Unity (aucune image pendant l’attente).', node.id);
      }
      out.push(this.indent(indent) + 'Thread.Sleep((int)((' + seconds + ') * 1000));');
    } else {
      this.need('thread');
      this.need('chrono');
      out.push(this.indent(indent) + 'this_thread::sleep_for(chrono::milliseconds((int)((' + seconds + ') * 1000)));');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_array_push = function (node, indent, out) {
    const arr = this.expr(node, 'array');
    const value = this.expr(node, 'value');
    if (this.isPy()) out.push(this.indent(indent) + arr + '.append(' + value + ')');
    else if (this.isCs()) out.push(this.indent(indent) + arr + '.Add(' + value + ');');
    else out.push(this.indent(indent) + arr + '.push_back(' + value + ');');
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_array_set = function (node, indent, out) {
    const arr = this.expr(node, 'array');
    const index = this.expr(node, 'index');
    const value = this.expr(node, 'value');
    if (this.isPy()) {
      out.push(this.indent(indent) + arr + '[int(' + index + ')] = ' + value);
    } else if (this.isCs()) {
      out.push(this.indent(indent) + arr + '[(int)(' + index + ')] = ' + value + ';');
    } else {
      out.push(this.indent(indent) + arr + '.at(static_cast<std::size_t>((int)(' + index + '))) = ' + value + ';');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_array_insert = function (node, indent, out) {
    const arr = this.expr(node, 'array');
    const index = this.expr(node, 'index');
    const value = this.expr(node, 'value');
    if (this.isPy()) out.push(this.indent(indent) + arr + '.insert(int(' + index + '), ' + value + ')');
    else if (this.isCs()) out.push(this.indent(indent) + arr + '.Insert((int)(' + index + '), ' + value + ');');
    else out.push(this.indent(indent) + arr + '.insert(' + arr + '.begin() + (int)(' + index + '), ' + value + ');');
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_array_remove = function (node, indent, out) {
    const arr = this.expr(node, 'array');
    const index = this.expr(node, 'index');
    if (this.isPy()) out.push(this.indent(indent) + 'del ' + arr + '[int(' + index + ')]');
    else if (this.isCs()) out.push(this.indent(indent) + arr + '.RemoveAt((int)(' + index + '));');
    else out.push(this.indent(indent) + arr + '.erase(' + arr + '.begin() + (int)(' + index + '));');
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_array_sort = function (node, indent, out) {
    const arr = this.expr(node, 'array');
    if (this.isPy()) out.push(this.indent(indent) + arr + '.sort()');
    else if (this.isCs()) out.push(this.indent(indent) + arr + '.Sort();');
    else {
      this.need('algorithm');
      out.push(this.indent(indent) + 'sort(' + arr + '.begin(), ' + arr + '.end());');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_array_reverse = function (node, indent, out) {
    const arr = this.expr(node, 'array');
    if (this.isPy()) out.push(this.indent(indent) + arr + '.reverse()');
    else if (this.isCs()) out.push(this.indent(indent) + arr + '.Reverse();');
    else {
      this.need('algorithm');
      out.push(this.indent(indent) + 'reverse(' + arr + '.begin(), ' + arr + '.end());');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_array_clear = function (node, indent, out) {
    const arr = this.expr(node, 'array');
    out.push(this.indent(indent) + arr + (this.isCs() ? '.Clear()' : '.clear()') + (this.isPy() ? '' : ';'));
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_file_write = function (node, indent, out) {
    const chemin = this.expr(node, 'path');
    const contenu = this.expr(node, 'content');
    this.need('ecrireFichier');
    if (this.isPy()) {
      out.push(this.indent(indent) + 'bp_ecrire_fichier(' + chemin + ', ' + contenu + ')');
    } else if (this.isCs()) {
      this.need('io');
      if (this.isUnity()) this.unityIo(node);
      out.push(this.indent(indent) + 'BpEcrireFichier(' + this.filePath(chemin) + ', ' + contenu + ');');
    } else {
      this.need('fstream');
      out.push(this.indent(indent) + 'bp_ecrire_fichier(' + chemin + ', ' + contenu + ');');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_file_append = function (node, indent, out) {
    const chemin = this.expr(node, 'path');
    const contenu = this.expr(node, 'content');
    this.need('ajouterFichier');
    if (this.isPy()) {
      out.push(this.indent(indent) + 'bp_ajouter_fichier(' + chemin + ', ' + contenu + ')');
    } else if (this.isCs()) {
      this.need('io');
      if (this.isUnity()) this.unityIo(node);
      out.push(this.indent(indent) + 'BpAjouterFichier(' + this.filePath(chemin) + ', ' + contenu + ');');
    } else {
      this.need('fstream');
      out.push(this.indent(indent) + 'bp_ajouter_fichier(' + chemin + ', ' + contenu + ');');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_file_delete = function (node, indent, out) {
    const chemin = this.expr(node, 'path');
    this.need('supprimerFichier');
    if (this.isPy()) {
      this.need('os');
      out.push(this.indent(indent) + 'bp_supprimer_fichier(' + chemin + ')');
    } else if (this.isCs()) {
      this.need('io');
      if (this.isUnity()) this.unityIo(node);
      out.push(this.indent(indent) + 'BpSupprimerFichier(' + this.filePath(chemin) + ');');
    } else {
      out.push(this.indent(indent) + 'bp_supprimer_fichier(' + chemin + ');');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_dict_decl = function (node, indent, out) {
    const name = BP.sanitizeIdent(node.props.name, 'dico');
    const info = this.dictTypes().get(name) || { key: 'string', value: 'int' };
    if (this.isPy()) {
      out.push(this.indent(indent) + name + ' = {}');
    } else if (this.isCs()) {
      this.need('list');
      out.push(this.indent(indent) + 'Dictionary<' + this.mapType(info.key) + ', ' +
        this.mapType(info.value) + '> ' + name + ' = new Dictionary<' +
        this.mapType(info.key) + ', ' + this.mapType(info.value) + '>();');
    } else {
      this.need('unordered_map');
      out.push(this.indent(indent) + 'unordered_map<' + info.key + ', ' + info.value +
        '> ' + name + ';');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_dict_set = function (node, indent, out) {
    const dict = this.expr(node, 'dict');
    const key = this.expr(node, 'key');
    const value = this.expr(node, 'value');
    out.push(this.indent(indent) + dict + '[' + key + '] = ' + value + (this.isPy() ? '' : ';'));
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_array_decl = function (node, indent, out) {
    const name = BP.sanitizeIdent(node.props.name, 'liste');
    const type = BP.VAL_TYPES.indexOf(node.props.etype) === -1 ? 'int' : node.props.etype;
    if (this.isPy()) {
      out.push(this.indent(indent) + name + ' = []');
    } else if (this.isCs()) {
      this.need('list');
      out.push(this.indent(indent) + 'List<' + this.mapType(type) + '> ' + name + ' = new List<' + type + '>();');
    } else {
      this.need('vector');
      out.push(this.indent(indent) + 'vector<' + type + '> ' + name + ';');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_var_decl = function (node, indent, out) {
    const name = BP.sanitizeIdent(node.props.name, 'x');
    const type = BP.VAL_TYPES.indexOf(node.props.vtype) === -1 ? 'int' : node.props.vtype;
    if (this.isPy()) {
      out.push(this.indent(indent) + name + ' = ' + this.defaultInit(type));
    } else {
      out.push(this.indent(indent) + this.mapType(type) + ' ' + name + ' = ' + this.defaultInit(type) + ';');
    }
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_set_var = function (node, indent, out) {
    const name = BP.sanitizeIdent(node.props.name, 'x');
    const value = this.expr(node, 'value');
    out.push(this.indent(indent) + name + ' = ' + value + (this.isPy() ? '' : ';'));
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_inc_var = function (node, indent, out) {
    const name = BP.sanitizeIdent(node.props.name, 'x');
    const op = ['+=', '-=', '*=', '/='].indexOf(node.props.op) === -1 ? '+=' : node.props.op;
    const amount = this.expr(node, 'amount');
    out.push(this.indent(indent) + name + ' ' + op + ' ' + amount + (this.isPy() ? '' : ';'));
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_break_loop = function (node, indent, out) {
    out.push(this.indent(indent) + 'break' + (this.isPy() ? '' : ';'));
    return null;
  };

  Generator.prototype.st_continue_loop = function (node, indent, out) {
    out.push(this.indent(indent) + 'continue' + (this.isPy() ? '' : ';'));
    return null;
  };

  Generator.prototype.st_call_stmt = function (node, indent, out) {
    const name = BP.sanitizeIdent(node.props.name, 'fonction');
    const args = BP.parseArgs(node.props.args).map(function (argName) {
      return this.expr(node, 'arg:' + argName);
    }, this);
    out.push(this.indent(indent) + name + '(' + args.join(', ') + ')' + (this.isPy() ? '' : ';'));
    return this.nextOf(node, 'out');
  };

  Generator.prototype.st_return_value = function (node, indent, out) {
    const value = this.expr(node, 'value');
    out.push(this.indent(indent) + 'return ' + value + (this.isPy() ? '' : ';'));
    return null;
  };

  Generator.prototype.st_branch = function (node, indent, out) {
    const cond = this.expr(node, 'cond');
    const bodyId = this.nextOf(node, 'true');
    const elseId = this.nextOf(node, 'false');

    if (this.isPy()) {
      out.push(this.indent(indent) + 'if ' + cond + ':');
      const body = this.collect(bodyId, indent + 1);
      if (body.length) out.push.apply(out, body);
      else out.push(this.indent(indent + 1) + 'pass');
      const other = this.collect(elseId, indent + 1);
      if (other.length) {
        out.push(this.indent(indent) + 'else:');
        out.push.apply(out, other);
      }
    } else {
      out.push(this.indent(indent) + 'if (' + cond + ')');
      out.push(this.indent(indent) + '{');
      out.push.apply(out, this.collect(bodyId, indent + 1));
      out.push(this.indent(indent) + '}');
      const other = this.collect(elseId, indent + 1);
      if (other.length) {
        out.push(this.indent(indent) + 'else');
        out.push(this.indent(indent) + '{');
        out.push.apply(out, other);
        out.push(this.indent(indent) + '}');
      }
    }
    return null;
  };

  Generator.prototype.st_for_range = function (node, indent, out) {
    const count = this.expr(node, 'count');
    const v = BP.sanitizeIdent(node.props.var, 'i');
    const bodyId = this.nextOf(node, 'body');

    if (this.isPy()) {
      out.push(this.indent(indent) + 'for ' + v + ' in range(' + count + '):');
      const body = this.collect(bodyId, indent + 1);
      if (body.length) out.push.apply(out, body);
      else out.push(this.indent(indent + 1) + 'pass');
    } else {
      out.push(this.indent(indent) +
        'for (int ' + v + ' = 0; ' + v + ' < ' + count + '; ' + v + '++)');
      out.push(this.indent(indent) + '{');
      out.push.apply(out, this.collect(bodyId, indent + 1));
      out.push(this.indent(indent) + '}');
    }
    return this.nextOf(node, 'done');
  };

  Generator.prototype.st_while_loop = function (node, indent, out) {
    const cond = this.expr(node, 'cond');
    const bodyId = this.nextOf(node, 'body');

    if (this.isPy()) {
      out.push(this.indent(indent) + 'while ' + cond + ':');
      const body = this.collect(bodyId, indent + 1);
      if (body.length) out.push.apply(out, body);
      else out.push(this.indent(indent + 1) + 'pass');
    } else {
      out.push(this.indent(indent) + 'while (' + cond + ')');
      out.push(this.indent(indent) + '{');
      out.push.apply(out, this.collect(bodyId, indent + 1));
      out.push(this.indent(indent) + '}');
    }
    return this.nextOf(node, 'done');
  };

  Generator.prototype.st_for_each = function (node, indent, out) {
    const arr = this.expr(node, 'array');
    const v = BP.sanitizeIdent(node.props.var, 'element');
    const bodyId = this.nextOf(node, 'body');

    if (this.isPy()) {
      out.push(this.indent(indent) + 'for ' + v + ' in ' + arr + ':');
      const body = this.collect(bodyId, indent + 1);
      if (body.length) out.push.apply(out, body);
      else out.push(this.indent(indent + 1) + 'pass');
    } else {
      if (this.isCs()) {
        out.push(this.indent(indent) + 'foreach (var ' + v + ' in ' + arr + ')');
      } else {
        /* vector<bool> renvoie un proxy : on type la variable quand c'est possible. */
        const element = this.arrayElementTypeOf(node, 'array');
        out.push(this.indent(indent) + (element
          ? 'for (' + this.mapType(element) + ' ' + v + ' : ' + arr + ')'
          : 'for (const auto& ' + v + ' : ' + arr + ')'));
      }
      out.push(this.indent(indent) + '{');
      out.push.apply(out, this.collect(bodyId, indent + 1));
      out.push(this.indent(indent) + '}');
    }
    return this.nextOf(node, 'done');
  };

  Generator.prototype.st_function_def = function () {
    return null;
  };

  /* --------------------------------------------------------- bibliothèques */

  Generator.prototype.pyHelpers = function () {
    const blocks = [];
    if (this.needs.has('nombre')) {
      blocks.push([
        'def bp_lire_nombre(invite):',
        '    while True:',
        '        try:',
        '            return float(input(invite))',
        '        except ValueError:',
        '            invite = "Nombre invalide, reessayez : "'
      ]);
    }
    if (this.needs.has('lireFichier')) {
      blocks.push([
        'def bp_lire_fichier(chemin):',
        '    try:',
        '        with open(chemin, "r", encoding="utf-8") as fichier:',
        '            return fichier.read()',
        '    except OSError:',
        '        print("Fichier illisible : " + chemin)',
        '        return ""'
      ]);
    }
    if (this.needs.has('ecrireFichier')) {
      blocks.push([
        'def bp_ecrire_fichier(chemin, contenu):',
        '    try:',
        '        with open(chemin, "w", encoding="utf-8") as fichier:',
        '            fichier.write(contenu)',
        '        return True',
        '    except OSError:',
        '        print("Fichier non enregistrable : " + chemin)',
        '        return False'
      ]);
    }
    if (this.needs.has('ajouterFichier')) {
      blocks.push([
        'def bp_ajouter_fichier(chemin, contenu):',
        '    try:',
        '        with open(chemin, "a", encoding="utf-8") as fichier:',
        '            fichier.write(contenu)',
        '        return True',
        '    except OSError:',
        '        print("Fichier non enregistrable : " + chemin)',
        '        return False'
      ]);
    }
    if (this.needs.has('supprimerFichier')) {
      this.need('os');
      blocks.push([
        'def bp_supprimer_fichier(chemin):',
        '    try:',
        '        if os.path.exists(chemin):',
        '            os.remove(chemin)',
        '        return True',
        '    except OSError:',
        '        print("Fichier non supprimable : " + chemin)',
        '        return False'
      ]);
    }
    if (this.needs.has('versNombre')) {
      blocks.push([
        'def bp_vers_nombre(valeur):',
        '    try:',
        '        return float(valeur)',
        '    except (TypeError, ValueError):',
        '        return 0.0'
      ]);
    }
    if (this.needs.has('indice')) {
      blocks.push([
        'def bp_indice(tableau, valeur):',
        '    try:',
        '        return tableau.index(valeur)',
        '    except ValueError:',
        '        return -1'
      ]);
    }
    if (this.needs.has('sousTexte')) {
      blocks.push([
        'def bp_sous_texte(texte, debut, longueur):',
        '    debut = int(debut)',
        '    longueur = int(longueur)',
        '    if debut < 0:',
        '        debut = 0',
        '    if longueur < 0:',
        '        longueur = 0',
        '    return texte[debut:debut + longueur]'
      ]);
    }
    return blocks;
  };

  Generator.prototype.csHelpers = function () {
    const blocks = [];
    if (this.needs.has('dictGet')) {
      this.need('list');
      blocks.push([
        '    // Valeur associee a une cle, ou valeur par defaut du type.',
        '    static TV BpLireDico<TK, TV>(Dictionary<TK, TV> dico, TK cle)',
        '    {',
        '        TV valeur;',
        '        return dico.TryGetValue(cle, out valeur) ? valeur : default(TV);',
        '    }'
      ]);
    }
    if (this.needs.has('saisie')) {
      blocks.push([
        '    static string BpLireSaisie(string invite)',
        '    {',
        '        if (invite != "") Console.Write(invite);',
        '        return Console.ReadLine() ?? "";',
        '    }'
      ]);
    }
    if (this.needs.has('nombre')) {
      blocks.push([
        '    static double BpLireNombre(string invite)',
        '    {',
        '        if (invite != "") Console.Write(invite);',
        '        while (true)',
        '        {',
        '            double valeur;',
        '            if (double.TryParse(Console.ReadLine() ?? "", out valeur)) return valeur;',
        '            Console.Write("Nombre invalide, reessayez : ");',
        '        }',
        '    }'
      ]);
    }
    if (this.needs.has('lireFichier')) {
      this.need('io');
      blocks.push([
        '    static string BpLireFichier(string chemin)',
        '    {',
        '        try',
        '        {',
        '            return File.ReadAllText(chemin);',
        '        }',
        '        catch (Exception e)',
        '        {',
        '            Console.WriteLine("Fichier illisible : " + chemin + " (" + e.Message + ")");',
        '            return "";',
        '        }',
        '    }'
      ]);
    }
    if (this.needs.has('ecrireFichier')) {
      this.need('io');
      blocks.push([
        '    static void BpEcrireFichier(string chemin, string contenu)',
        '    {',
        '        try',
        '        {',
        '            File.WriteAllText(chemin, contenu);',
        '        }',
        '        catch (Exception e)',
        '        {',
        '            Console.WriteLine("Fichier non enregistrable : " + chemin + " (" + e.Message + ")");',
        '        }',
        '    }'
      ]);
    }
    if (this.needs.has('ajouterFichier')) {
      this.need('io');
      blocks.push([
        '    static void BpAjouterFichier(string chemin, string contenu)',
        '    {',
        '        try',
        '        {',
        '            File.AppendAllText(chemin, contenu);',
        '        }',
        '        catch (Exception e)',
        '        {',
        '            Console.WriteLine("Fichier non enregistrable : " + chemin + " (" + e.Message + ")");',
        '        }',
        '    }'
      ]);
    }
    if (this.needs.has('supprimerFichier')) {
      this.need('io');
      blocks.push([
        '    static void BpSupprimerFichier(string chemin)',
        '    {',
        '        try',
        '        {',
        '            if (File.Exists(chemin)) File.Delete(chemin);',
        '        }',
        '        catch (Exception e)',
        '        {',
        '            Console.WriteLine("Fichier non supprimable : " + chemin + " (" + e.Message + ")");',
        '        }',
        '    }'
      ]);
    }
    if (this.needs.has('hasard')) {
      blocks.push([
        '    static readonly Random BpHasard = new Random();',
        '',
        '    static int BpAleatoire(int min, int max)',
        '    {',
        '        if (max < min) return min;',
        '        return BpHasard.Next(min, max + 1);',
        '    }'
      ]);
    }
    if (this.needs.has('versNombre')) {
      blocks.push([
        '    static double BpVersNombre(string texte)',
        '    {',
        '        double valeur;',
        '        if (double.TryParse(texte, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out valeur)) return valeur;',
        '        return 0.0;',
        '    }',
        '',
        '    static double BpVersNombre(double valeur)',
        '    {',
        '        return valeur;',
        '    }'
      ]);
    }
    if (this.needs.has('sousTexte')) {
      blocks.push([
        '    static string BpSousTexte(string texte, int debut, int longueur)',
        '    {',
        '        if (debut < 0) debut = 0;',
        '        if (debut > texte.Length) debut = texte.Length;',
        '        if (longueur < 0) longueur = 0;',
        '        if (debut + longueur > texte.Length) longueur = texte.Length - debut;',
        '        return texte.Substring(debut, longueur);',
        '    }'
      ]);
    }
    return blocks;
  };

  Generator.prototype.cppHelpers = function () {
    const blocks = [];
    if (this.needs.has('dictGet')) {
      this.need('unordered_map');
      blocks.push([
        'template <typename K, typename V, typename C>',
        'V bp_lire_dico(const unordered_map<K, V>& dico, const C& cle)',
        '{',
        '    auto it = dico.find(cle);',
        '    return it == dico.end() ? V() : it->second;',
        '}'
      ]);
    }

    /* Dépendances entre aides, résolues avant l'assemblage des blocs. */
    if (this.needs.has('texte') || this.needs.has('joindre') || this.needs.has('afficheTableau')) {
      this.need('nombreTexte');
    }
    if (this.needs.has('joindre') || this.needs.has('afficheTableau')) this.need('texte');
    if (this.needs.has('sousTexte')) this.need('texteUnicode');

    /* Représentation la plus courte d'un décimal (comme Python et C#). */
    if (this.needs.has('nombreTexte')) {
      this.need('charconv');
      blocks.push([
        'string bp_nombre_texte(double valeur)',
        '{',
        '    char tampon[64];',
        '    to_chars_result resultat = to_chars(tampon, tampon + sizeof(tampon), valeur);',
        '    return string(tampon, resultat.ptr);',
        '}'
      ]);
    }
    if (this.needs.has('texte')) {
      this.need('sstream');
      this.need('nombreTexte');
      blocks.push([
        'template <typename T>',
        'string bp_texte(const T& valeur)',
        '{',
        '    ostringstream flux;',
        '    flux << valeur;',
        '    return flux.str();',
        '}',
        '',
        'string bp_texte(double valeur)',
        '{',
        '    return bp_nombre_texte(valeur);',
        '}',
        '',
        'string bp_texte(bool valeur)',
        '{',
        '    return valeur ? "True" : "False";',
        '}'
      ]);
    }
    if (this.needs.has('afficheTableau')) {
      this.need('vector');
      this.need('texte');
      blocks.push([
        'template <typename T>',
        'void bp_afficher_tableau(const vector<T>& tableau, bool saut = true)',
        '{',
        '    cout << "[";',
        '    for (size_t i = 0; i < tableau.size(); i++)',
        '    {',
        '        if (i > 0) cout << ", ";',
        '        cout << bp_texte(tableau[i]);',
        '    }',
        '    cout << "]";',
        '    if (saut) cout << endl;',
        '}'
      ]);
    }
    if (this.needs.has('saisie')) {
      blocks.push([
        'string bp_lire_saisie(const string& invite)',
        '{',
        '    if (!invite.empty()) cout << invite;',
        '    string ligne;',
        '    getline(cin, ligne);',
        '    return ligne;',
        '}'
      ]);
    }
    if (this.needs.has('nombre')) {
      blocks.push([
        'double bp_lire_nombre(const string& invite)',
        '{',
        '    if (!invite.empty()) cout << invite;',
        '    double valeur = 0;',
        '    while (!(cin >> valeur))',
        '    {',
        '        cin.clear();',
        '        string reste;',
        '        cin >> reste;',
        '        cout << "Nombre invalide, reessayez : ";',
        '    }',
        '    string fin;',
        '    getline(cin, fin);',
        '    return valeur;',
        '}'
      ]);
    }
    if (this.needs.has('lireFichier')) {
      this.need('fstream');
      this.need('sstream');
      blocks.push([
        'string bp_lire_fichier(const string& chemin)',
        '{',
        '    ifstream fichier(chemin);',
        '    if (!fichier)',
        '    {',
        '        cout << "Fichier illisible : " << chemin << endl;',
        '        return "";',
        '    }',
        '    stringstream flux;',
        '    flux << fichier.rdbuf();',
        '    return flux.str();',
        '}'
      ]);
    }
    if (this.needs.has('ecrireFichier')) {
      this.need('fstream');
      blocks.push([
        'void bp_ecrire_fichier(const string& chemin, const string& contenu)',
        '{',
        '    ofstream fichier(chemin);',
        '    if (!fichier)',
        '    {',
        '        cout << "Fichier non enregistrable : " << chemin << endl;',
        '        return;',
        '    }',
        '    fichier << contenu;',
        '}'
      ]);
    }
    if (this.needs.has('hasard')) {
      this.need('random');
      blocks.push([
        'int bp_aleatoire(int min, int max)',
        '{',
        '    static random_device source;',
        '    static mt19937 generateur(source());',
        '    if (max < min) return min;',
        '    uniform_int_distribution<int> distribution(min, max);',
        '    return distribution(generateur);',
        '}'
      ]);
    }
    if (this.needs.has('arrondir')) {
      this.need('cmath');
      blocks.push([
        'double bp_arrondir(double valeur, int decimales)',
        '{',
        '    double facteur = pow(10.0, decimales);',
        '    return round(valeur * facteur) / facteur;',
        '}'
      ]);
    }
    if (this.needs.has('contient')) {
      this.need('vector');
      this.need('algorithm');
      blocks.push([
        'template <typename T, typename V>',
        'bool bp_contient(const vector<T>& tableau, const V& valeur)',
        '{',
        '    return find(tableau.begin(), tableau.end(), valeur) != tableau.end();',
        '}'
      ]);
    }
    if (this.needs.has('indice')) {
      this.need('vector');
      blocks.push([
        'template <typename T, typename V>',
        'int bp_indice(const vector<T>& tableau, const V& valeur)',
        '{',
        '    for (size_t i = 0; i < tableau.size(); i++)',
        '    {',
        '        if (tableau[i] == valeur) return (int)i;',
        '    }',
        '    return -1;',
        '}'
      ]);
    }
    if (this.needs.has('somme')) {
      this.need('vector');
      this.need('numeric');
      blocks.push([
        'template <typename T>',
        'double bp_somme(const vector<T>& tableau)',
        '{',
        '    return accumulate(tableau.begin(), tableau.end(), 0.0);',
        '}'
      ]);
    }
    if (this.needs.has('decouper')) {
      this.need('vector');
      blocks.push([
        'vector<string> bp_decouper(const string& texte, const string& separateur)',
        '{',
        '    vector<string> morceaux;',
        '    if (separateur.empty())',
        '    {',
        '        morceaux.push_back(texte);',
        '        return morceaux;',
        '    }',
        '    size_t debut = 0;',
        '    while (true)',
        '    {',
        '        size_t position = texte.find(separateur, debut);',
        '        if (position == string::npos)',
        '        {',
        '            morceaux.push_back(texte.substr(debut));',
        '            break;',
        '        }',
        '        morceaux.push_back(texte.substr(debut, position - debut));',
        '        debut = position + separateur.size();',
        '    }',
        '    return morceaux;',
        '}'
      ]);
    }
    if (this.needs.has('joindre')) {
      this.need('vector');
      this.need('sstream');
      blocks.push([
        'template <typename T>',
        'string bp_joindre(const vector<T>& tableau, const string& separateur)',
        '{',
        '    ostringstream flux;',
        '    for (size_t i = 0; i < tableau.size(); i++)',
        '    {',
        '        if (i > 0) flux << separateur;',
        '        flux << bp_texte(tableau[i]);',
        '    }',
        '    return flux.str();',
        '}'
      ]);
    }
    if (this.needs.has('casse')) {
      blocks.push([
        'int bp_majuscule(int code)',
        '{',
        '    if (code >= \'a\' && code <= \'z\') return code - 32;',
        '    if (code >= 0xE0 && code <= 0xFE && code != 0xF7) return code - 32;',
        '    if (code == 0x153) return 0x152;',
        '    if (code == 0xFF) return 0x178;',
        '    return code;',
        '}',
        '',
        'int bp_minuscule(int code)',
        '{',
        '    if (code >= \'A\' && code <= \'Z\') return code + 32;',
        '    if (code >= 0xC0 && code <= 0xDE && code != 0xD7) return code + 32;',
        '    if (code == 0x152) return 0x153;',
        '    if (code == 0x178) return 0xFF;',
        '    return code;',
        '}',
        '',
        '/* Conversion caractère par caractère : les accents (UTF-8) sont conservés. */',
        'string bp_casse(const string& texte, bool majuscule)',
        '{',
        '    string sortie;',
        '    sortie.reserve(texte.size());',
        '    for (size_t i = 0; i < texte.size();)',
        '    {',
        '        unsigned char premier = (unsigned char)texte[i];',
        '        size_t longueur = 1;',
        '        int code = premier;',
        '        if (premier >= 0xF0) { longueur = 4; code = premier & 0x07; }',
        '        else if (premier >= 0xE0) { longueur = 3; code = premier & 0x0F; }',
        '        else if (premier >= 0xC0) { longueur = 2; code = premier & 0x1F; }',
        '        for (size_t j = 1; j < longueur && i + j < texte.size(); j++)',
        '        {',
        '            code = (code << 6) | ((unsigned char)texte[i + j] & 0x3F);',
        '        }',
        '        code = majuscule ? bp_majuscule(code) : bp_minuscule(code);',
        '        if (code < 0x80)',
        '        {',
        '            sortie += (char)code;',
        '        }',
        '        else if (code < 0x800)',
        '        {',
        '            sortie += (char)(0xC0 | (code >> 6));',
        '            sortie += (char)(0x80 | (code & 0x3F));',
        '        }',
        '        else if (code < 0x10000)',
        '        {',
        '            sortie += (char)(0xE0 | (code >> 12));',
        '            sortie += (char)(0x80 | ((code >> 6) & 0x3F));',
        '            sortie += (char)(0x80 | (code & 0x3F));',
        '        }',
        '        else',
        '        {',
        '            sortie += (char)(0xF0 | (code >> 18));',
        '            sortie += (char)(0x80 | ((code >> 12) & 0x3F));',
        '            sortie += (char)(0x80 | ((code >> 6) & 0x3F));',
        '            sortie += (char)(0x80 | (code & 0x3F));',
        '        }',
        '        i += longueur;',
        '    }',
        '    return sortie;',
        '}',
        '',
        'string bp_majuscules(const string& texte)',
        '{',
        '    return bp_casse(texte, true);',
        '}',
        '',
        'string bp_minuscules(const string& texte)',
        '{',
        '    return bp_casse(texte, false);',
        '}'
      ]);
    }
    if (this.needs.has('remplacer')) {
      blocks.push([
        'string bp_remplacer(string texte, const string& ancien, const string& nouveau)',
        '{',
        '    if (ancien.empty()) return texte;',
        '    size_t position = 0;',
        '    while ((position = texte.find(ancien, position)) != string::npos)',
        '    {',
        '        texte.replace(position, ancien.size(), nouveau);',
        '        position += nouveau.size();',
        '    }',
        '    return texte;',
        '}'
      ]);
    }
    if (this.needs.has('contientTexte')) {
      blocks.push([
        'bool bp_contient_texte(const string& texte, const string& morceau)',
        '{',
        '    return texte.find(morceau) != string::npos;',
        '}'
      ]);
    }
    /* Indices et longueurs comptés en caractères (UTF-8), comme en Python et C#. */
    if (this.needs.has('texteUnicode')) {
      this.need('vector');
      blocks.push([
        'vector<size_t> bp_reperes(const string& texte)',
        '{',
        '    vector<size_t> reperes;',
        '    for (size_t i = 0; i < texte.size(); i++)',
        '    {',
        '        if (((unsigned char)texte[i] & 0xC0) != 0x80) reperes.push_back(i);',
        '    }',
        '    return reperes;',
        '}',
        '',
        'size_t bp_taille_texte(const string& texte)',
        '{',
        '    return bp_reperes(texte).size();',
        '}',
        '',
        'string bp_sous_texte(const string& texte, int debut, int longueur)',
        '{',
        '    if (debut < 0) debut = 0;',
        '    if (longueur < 0) longueur = 0;',
        '    vector<size_t> reperes = bp_reperes(texte);',
        '    if (debut >= (int)reperes.size()) return "";',
        '    int fin = debut + longueur;',
        '    size_t finOctets = (fin >= (int)reperes.size()) ? texte.size() : reperes[(size_t)fin];',
        '    return texte.substr(reperes[(size_t)debut], finOctets - reperes[(size_t)debut]);',
        '}'
      ]);
    }
    if (this.needs.has('versNombre')) {
      blocks.push([
        'double bp_vers_nombre(const string& texte)',
        '{',
        '    try',
        '    {',
        '        return stod(texte);',
        '    }',
        '    catch (...)',
        '    {',
        '        return 0.0;',
        '    }',
        '}',
        '',
        'double bp_vers_nombre(double valeur)',
        '{',
        '    return valeur;',
        '}'
      ]);
    }
    if (this.needs.has('fichierExiste')) {
      this.need('fstream');
      blocks.push([
        'bool bp_fichier_existe(const string& chemin)',
        '{',
        '    ifstream fichier(chemin);',
        '    return (bool)fichier;',
        '}'
      ]);
    }
    if (this.needs.has('supprimerFichier')) {
      this.need('cstdio');
      blocks.push([
        'void bp_supprimer_fichier(const string& chemin)',
        '{',
        '    remove(chemin.c_str());',
        '}'
      ]);
    }
    if (this.needs.has('ajouterFichier')) {
      this.need('fstream');
      blocks.push([
        'void bp_ajouter_fichier(const string& chemin, const string& contenu)',
        '{',
        '    ofstream fichier(chemin, ios::app);',
        '    if (!fichier)',
        '    {',
        '        cout << "Fichier non enregistrable : " << chemin << endl;',
        '        return;',
        '    }',
        '    fichier << contenu;',
        '}'
      ]);
    }
    if (this.needs.has('maintenant')) {
      this.need('ctime');
      blocks.push([
        'string bp_maintenant()',
        '{',
        '    time_t instant = time(nullptr);',
        '    tm* local = localtime(&instant);',
        '    char tampon[32];',
        '    strftime(tampon, sizeof(tampon), "%d/%m/%Y %H:%M:%S", local);',
        '    return string(tampon);',
        '}'
      ]);
    }
    return blocks;
  };

  /* ------------------------------------------------------------- assemblage */

  /* Type Python correspondant à un type de Blueprint Studio (null si inconnu). */
  function pyTypeOf(type) {
    if (type === 'int') return 'int';
    if (type === 'double') return 'float';
    if (type === 'string') return 'str';
    if (type === 'bool') return 'bool';
    if (type === 'void') return 'None';
    return null;
  }

  Generator.prototype.emitFunction = function (fn) {
    const name = BP.sanitizeIdent(fn.props.name, 'fonction');
    const params = BP.parseParams(fn.props.params);
    const ret = ['void'].concat(BP.VAL_TYPES).indexOf(fn.props.rettype) === -1 ? 'int' : fn.props.rettype;
    const lines = [];

    if (this.isPy()) {
      /* annotations de type quand le type est connu, sinon paramètre simple */
      const sig = params.map(function (p) {
        const py = pyTypeOf(p.type);
        return p.name + (py ? ': ' + py : '');
      }).join(', ');
      const back = pyTypeOf(ret);
      lines.push('def ' + name + '(' + sig + ')' + (back ? ' -> ' + back : '') + ':');
      const body = this.collect(this.nextOf(fn, 'body'), 1);
      if (body.length) lines.push.apply(lines, body);
      else lines.push('    pass');
    } else {
      const sig = params.map(function (p) {
        return this.mapType(p.type) + ' ' + p.name;
      }, this).join(', ');
      const prefix = this.isCs() ? '    static ' : '';
      lines.push(prefix + this.mapType(ret) + ' ' + name + '(' + sig + ')');
      lines.push(prefix.replace(/static /, '') + '{');
      const body = this.collect(this.nextOf(fn, 'body'), this.isCs() ? 2 : 1);
      lines.push.apply(lines, body);
      lines.push(prefix.replace(/static /, '') + '}');
    }
    return lines;
  };

  Generator.prototype.header = function () {
    const c = this.isPy() ? '#' : '//';
    const title = (this.graph.name || 'Sans titre').replace(/[\r\n]+/g, ' ');
    const label = this.isPy() ? 'Python' :
      (this.isUnity() ? 'C# pour Unity 6 (C# 9, .NET Standard 2.1)' : (this.isCs() ? 'C#' : 'C++'));
    const lines = [c + ' ' + title, c + ' Généré par Blueprint Studio (' + label + ')'];
    if (this.isUnity()) {
      lines.push(c + ' A placer dans le dossier Assets/ du projet : Unity exige que le');
      lines.push(c + ' fichier s’appelle ' + this.unityClass() + '.cs, comme la classe ci-dessous.');
    }
    return lines;
  };

  /* Variante Unity des aides C# : Debug.Log au lieu de la console, System.Random
     explicite (UnityEngine.Random crée une ambiguïté) et résolution des chemins. */
  Generator.prototype.unityHelpers = function () {
    const blocks = this.csHelpers().map(function (block) {
      return block.map(function (line) {
        return line
          .replace(/Console\.WriteLine\(/g, 'Debug.Log(')
          .replace(/Console\.Write\(/g, 'Debug.Log(')
          .replace(/new Random\(\)/g, 'new System.Random()');
      });
    });
    if (this.needs.has('io')) {
      blocks.unshift([
        '    // Chemins relatifs : dossier de donnees persistant du jeu.',
        '    static string BpChemin(string chemin)',
        '    {',
        '        if (string.IsNullOrEmpty(chemin)) return Application.persistentDataPath;',
        '        return Path.IsPathRooted(chemin) ? chemin : Path.Combine(Application.persistentDataPath, chemin);',
        '    }'
      ]);
    }
    return blocks;
  };

  Generator.prototype.run = function () {
    const problems = [];
    const starts = this.graph.nodes.filter(function (n) { return n.type === 'event_start'; });
    if (starts.length === 0) {
      this.problem('error', 'Aucun nœud « Début » : le programme n’a pas de point d’entrée.');
    }
    if (starts.length > 1) {
      this.problem('warning', 'Plusieurs nœuds « Début » : seul le premier est utilisé.', starts[1].id);
    }

    const funcs = P.functionDefs(this.graph);
    const funcBlocks = funcs.map(function (fn) { return this.emitFunction(fn); }, this);

    const startId = starts.length ? starts[0].id : null;
    const entryIndent = this.isPy() ? 1 : (this.isCs() ? 2 : 1);
    const entry = [];
    if (startId) {
      this.emitExec(P.nextNode(this.graph, startId, 'out'), entryIndent, entry);
    }

    const helperBlocks = this.isPy() ? this.pyHelpers() :
      (this.isUnity() ? this.unityHelpers() : (this.isCs() ? this.csHelpers() : this.cppHelpers()));

    const lines = [];
    lines.push.apply(lines, this.header());
    lines.push('');

    if (this.isPy()) {
      const imports = [];
      if (this.needs.has('math')) imports.push('import math');
      if (this.needs.has('random')) imports.push('import random');
      if (this.needs.has('time')) imports.push('import time');
      if (this.needs.has('os')) imports.push('import os');
      if (this.needs.has('datetime')) imports.push('import datetime');
      if (imports.length) {
        lines.push.apply(lines, imports);
        lines.push('');
      }
      lines.push('import sys');
      lines.push('');
      lines.push('# Accents corrects dans le terminal et dans un fichier redirigé.');
      lines.push('if hasattr(sys.stdout, "reconfigure"):');
      lines.push('    sys.stdout.reconfigure(encoding="utf-8")');
      lines.push('');
      helperBlocks.forEach(function (block) {
        lines.push.apply(lines, block);
        lines.push('');
      });
      funcBlocks.forEach(function (block) {
        lines.push.apply(lines, block);
        lines.push('');
      });

      /* point d'entrée explicite : le fichier peut être importé sans s'exécuter */
      const taken = funcs.map(function (fn) {
        return BP.sanitizeIdent(fn.props.name, 'fonction');
      });
      let mainName = 'main';
      while (taken.indexOf(mainName) !== -1) mainName = '_' + mainName;
      lines.push('def ' + mainName + '():');
      if (entry.length) lines.push.apply(lines, entry);
      else lines.push('    pass');
      lines.push('');
      lines.push('if __name__ == "__main__":');
      lines.push('    ' + mainName + '()');
    } else if (this.isUnity()) {
      /* Cible Unity 6 : C# 9, .NET Standard 2.1, classe MonoBehaviour. */
      lines.push('using System;');
      if (this.unityWait) lines.push('using System.Collections;');
      if (this.needs.has('list')) lines.push('using System.Collections.Generic;');
      if (this.needs.has('io')) lines.push('using System.IO;');
      if (this.needs.has('linq')) lines.push('using System.Linq;');
      lines.push('using UnityEngine;');
      lines.push('');
      lines.push('public class ' + this.unityClass() + ' : MonoBehaviour');
      lines.push('{');
      if (this.unityFields.length) {
        lines.push('    [Header("Entrées du blueprint")]');
        this.unityFields.forEach(function (field) {
          if (field.prompt) lines.push('    [Tooltip("' + field.prompt + '")]');
          lines.push('    [SerializeField] private ' + field.type + ' ' + field.name +
            (field.type === 'string' ? ' = "";' : ' = 0f;'));
        });
        lines.push('');
      }
      helperBlocks.forEach(function (block) {
        lines.push.apply(lines, block);
        lines.push('');
      });
      funcBlocks.forEach(function (block) {
        lines.push.apply(lines, block);
        lines.push('');
      });
      if (this.unityWait) {
        lines.push('    void Start()');
        lines.push('    {');
        lines.push('        StartCoroutine(BpExecuter());');
        lines.push('    }');
        lines.push('');
        lines.push('    // Coroutine : les attentes ne figent pas le jeu.');
        lines.push('    IEnumerator BpExecuter()');
        lines.push('    {');
        if (entry.length) lines.push.apply(lines, entry);
        else lines.push('        yield break;');
        lines.push('    }');
      } else {
        lines.push('    void Start()');
        lines.push('    {');
        if (entry.length) lines.push.apply(lines, entry);
        else lines.push('        // (aucune instruction)');
        lines.push('    }');
      }
      lines.push('}');
    } else if (this.isCs()) {
      lines.push('using System;');
      lines.push('using System.Globalization;');
      if (this.needs.has('list')) lines.push('using System.Collections.Generic;');
      if (this.needs.has('io')) lines.push('using System.IO;');
      if (this.needs.has('linq')) lines.push('using System.Linq;');
      if (this.needs.has('threading')) lines.push('using System.Threading;');
      lines.push('');
      lines.push('class Program');
      lines.push('{');
      helperBlocks.forEach(function (block) {
        lines.push.apply(lines, block);
        lines.push('');
      });
      funcBlocks.forEach(function (block) {
        lines.push.apply(lines, block);
        lines.push('');
      });
      lines.push('    static void Main(string[] args)');
      lines.push('    {');
      lines.push('        // nombres identiques quel que soit le Windows (3.5 et non 3,5)');
      lines.push('        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;');
      if (entry.length) lines.push.apply(lines, entry);
      else lines.push('        // (aucune instruction)');
      lines.push('    }');
      lines.push('}');
    } else {
      lines.push('#include <iostream>');
      lines.push('#include <string>');
      if (this.needs.has('fstream')) lines.push('#include <fstream>');
      if (this.needs.has('sstream')) lines.push('#include <sstream>');
      if (this.needs.has('vector')) lines.push('#include <vector>');
      if (this.needs.has('vector')) lines.push('#include <cstddef>');
      if (this.needs.has('unordered_map')) lines.push('#include <unordered_map>');
      if (this.needs.has('cmath')) lines.push('#include <cmath>');
      if (this.needs.has('algorithm')) lines.push('#include <algorithm>');
      if (this.needs.has('numeric')) lines.push('#include <numeric>');
      if (this.needs.has('random')) lines.push('#include <random>');
      if (this.needs.has('thread')) lines.push('#include <thread>');
      if (this.needs.has('chrono')) lines.push('#include <chrono>');
      if (this.needs.has('ctime')) lines.push('#include <ctime>');
      if (this.needs.has('cstdio')) lines.push('#include <cstdio>');
      if (this.needs.has('cstdlib')) lines.push('#include <cstdlib>');
      if (this.needs.has('charconv')) lines.push('#include <charconv>');
      if (this.needs.has('cctype')) lines.push('#include <cctype>');
      lines.push('');
      lines.push('using namespace std;');
      lines.push('');
      helperBlocks.forEach(function (block) {
        lines.push.apply(lines, block);
        lines.push('');
      });
      funcBlocks.forEach(function (block) {
        lines.push.apply(lines, block);
        lines.push('');
      });
      lines.push('int main()');
      lines.push('{');
      if (entry.length) lines.push.apply(lines, entry);
      else lines.push('    // (aucune instruction)');
      lines.push('    return 0;');
      lines.push('}');
    }

    const code = lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
    problems.push.apply(problems, this.problems);
    return {
      code: code,
      problems: problems,
      lang: this.lang,
      /* Unity impose le nom de fichier : on le propose tel quel à l'export. */
      suggestedName: this.isUnity() ? this.unityClass() : null
    };
  };

  BP.generateCode = function (graph, lang) {
    return new Generator(graph, lang).run();
  };

  /** Fusionne les problèmes du graphe et ceux du générateur. */
  BP.diagnose = function (graph, lang) {
    const graphProblems = P.validate(graph);
    const gen = BP.generateCode(graph, lang);
    const seen = new Set();
    const all = [];
    graphProblems.concat(gen.problems).forEach(function (p) {
      const key = p.level + '|' + p.message;
      if (seen.has(key)) return;
      seen.add(key);
      all.push(p);
    });
    return { code: gen.code, problems: all, suggestedName: gen.suggestedName || null };
  };
})(typeof window !== 'undefined' ? window : globalThis);
