/* Graphiques d'exemple livrés avec l'application (source unique, exportés en .json par tools/export-examples.js). */
(function (root) {
  'use strict';
  const BP = (root.BP = root.BP || {});

  function n(id, type, x, y, props) {
    return { id: id, type: type, x: x, y: y, props: props || {} };
  }
  function w(id, fromNode, fromPin, toNode, toPin) {
    return { id: id, from: { node: fromNode, pin: fromPin }, to: { node: toNode, pin: toPin } };
  }
  function g(name, nodes, wires) {
    return { format: 'blueprint-studio', version: 1, name: name, nodes: nodes, wires: wires };
  }

  const BONJOUR = g('Bonjour', [
    n('start', 'event_start', 80, 80),
    n('afficher', 'print', 80, 230),
    n('texte', 'literal_string', 430, 250, { value: 'Bonjour depuis Blueprint Studio !' })
  ], [
    w('w1', 'start', 'out', 'afficher', 'in'),
    w('w2', 'texte', 'value', 'afficher', 'value')
  ]);

  const BOUCLE = g('Somme 1..5', [
    n('start', 'event_start', 80, 60),
    n('decl', 'var_decl', 80, 200, { name: 'total', vtype: 'int' }),
    n('boucle', 'for_range', 80, 330, { var: 'i' }),
    n('cinq', 'literal_number', 450, 350, { value: '5' }),
    n('set', 'set_var', 80, 520, { name: 'total' }),
    n('addition', 'math', 430, 540, { op: '+' }),
    n('lireTotal', 'get_var', 760, 560, { name: 'total' }),
    n('lireI', 'get_var', 760, 660, { name: 'i' }),
    n('afficher', 'print', 80, 700),
    n('lireResultat', 'get_var', 430, 720, { name: 'total' })
  ], [
    w('w1', 'start', 'out', 'decl', 'in'),
    w('w2', 'decl', 'out', 'boucle', 'in'),
    w('w3', 'cinq', 'value', 'boucle', 'count'),
    w('w4', 'boucle', 'body', 'set', 'in'),
    w('w5', 'addition', 'result', 'set', 'value'),
    w('w6', 'lireTotal', 'value', 'addition', 'a'),
    w('w7', 'lireI', 'value', 'addition', 'b'),
    w('w8', 'boucle', 'done', 'afficher', 'in'),
    w('w9', 'lireResultat', 'value', 'afficher', 'value')
  ]);

  const FONCTION = g('Fonction et condition', [
    n('fdef', 'function_def', 80, 60, { name: 'est_pair', params: 'n: int', rettype: 'bool' }),
    n('retour', 'return_value', 80, 220),
    n('cmp', 'compare', 430, 240, { op: '==' }),
    n('zéro', 'literal_number', 760, 250, { value: '0' }),
    n('modulo', 'math', 430, 420, { op: '%' }),
    n('lireN', 'get_var', 760, 430, { name: 'n' }),
    n('deux', 'literal_number', 430, 560, { value: '2' }),

    n('start', 'event_start', 80, 660),
    n('declR', 'var_decl', 80, 800, { name: 'r', vtype: 'bool' }),
    n('setR', 'set_var', 80, 930, { name: 'r' }),
    n('appel', 'call_func', 430, 950, { name: 'est_pair', args: 'n' }),
    n('sept', 'literal_number', 760, 970, { value: '7' }),
    n('si', 'branch', 80, 1090),
    n('lireR', 'get_var', 430, 1110, { name: 'r' }),
    n('pair', 'print', 80, 1270),
    n('textePair', 'literal_string', 500, 1290, { value: "C'est pair" }),
    n('impair', 'print', 80, 1420),
    n('texteImpair', 'literal_string', 500, 1440, { value: "C'est impair" })
  ], [
    w('f1', 'fdef', 'body', 'retour', 'in'),
    w('f2', 'cmp', 'result', 'retour', 'value'),
    w('f3', 'modulo', 'result', 'cmp', 'a'),
    w('f4', 'zéro', 'value', 'cmp', 'b'),
    w('f5', 'lireN', 'value', 'modulo', 'a'),
    w('f6', 'deux', 'value', 'modulo', 'b'),

    w('m1', 'start', 'out', 'declR', 'in'),
    w('m2', 'declR', 'out', 'setR', 'in'),
    w('m3', 'appel', 'result', 'setR', 'value'),
    w('m4', 'sept', 'value', 'appel', 'arg:n'),
    w('m5', 'setR', 'out', 'si', 'in'),
    w('m6', 'lireR', 'value', 'si', 'cond'),
    w('m7', 'si', 'true', 'pair', 'in'),
    w('m8', 'textePair', 'value', 'pair', 'value'),
    w('m9', 'si', 'false', 'impair', 'in'),
    w('m10', 'texteImpair', 'value', 'impair', 'value')
  ]);

  const TABLEAU = g('Somme d’un tableau', [
    n('start', 'event_start', 80, 60),
    n('decl', 'var_decl', 80, 200, { name: 'total', vtype: 'int' }),
    n('each', 'for_each', 80, 330, { var: 'element' }),
    n('tableau', 'array_new', 640, 350, { items: '4, 8, 15, 16' }),
    n('set', 'set_var', 80, 520, { name: 'total' }),
    n('addition', 'math', 430, 540, { op: '+' }),
    n('lireTotal', 'get_var', 760, 560, { name: 'total' }),
    n('lireElement', 'get_var', 760, 660, { name: 'element' }),
    n('afficher', 'print', 80, 700),
    n('lireResultat', 'get_var', 430, 720, { name: 'total' })
  ], [
    w('w1', 'start', 'out', 'decl', 'in'),
    w('w2', 'decl', 'out', 'each', 'in'),
    w('w3', 'tableau', 'value', 'each', 'array'),
    w('w4', 'each', 'body', 'set', 'in'),
    w('w5', 'addition', 'result', 'set', 'value'),
    w('w6', 'lireTotal', 'value', 'addition', 'a'),
    w('w7', 'lireElement', 'value', 'addition', 'b'),
    w('w8', 'each', 'done', 'afficher', 'in'),
    w('w9', 'lireResultat', 'value', 'afficher', 'value')
  ]);

  const DICO = g('Dictionnaire', [
    n('start', 'event_start', 80, 60),
    n('decl', 'dict_decl', 80, 200, { name: 'ages', ktype: 'string', vtype: 'int' }),
    n('ecrireAda', 'dict_set', 80, 340),
    n('lireAges1', 'get_var', 430, 360, { name: 'ages' }),
    n('cleAda', 'literal_string', 430, 470, { value: 'ada' }),
    n('ageAda', 'literal_number', 430, 560, { value: '36' }),
    n('ecrireAlan', 'dict_set', 80, 470),
    n('lireAges2', 'get_var', 430, 700, { name: 'ages' }),
    n('cleAlan', 'literal_string', 430, 800, { value: 'alan' }),
    n('ageAlan', 'literal_number', 430, 890, { value: '41' }),
    n('afficherTaille', 'print', 80, 640),
    n('taille', 'dict_len', 430, 980),
    n('lireAges3', 'get_var', 760, 1000, { name: 'ages' }),
    n('afficherAge', 'print', 80, 800),
    n('lireAge', 'dict_get', 430, 1110),
    n('lireAges4', 'get_var', 760, 1130, { name: 'ages' }),
    n('cleAda2', 'literal_string', 760, 1230, { value: 'ada' }),
    n('afficherPresente', 'print', 80, 960),
    n('presente', 'dict_has', 430, 1260),
    n('lireAges5', 'get_var', 760, 1280, { name: 'ages' }),
    n('cleAda3', 'literal_string', 760, 1380, { value: 'ada' })
  ], [
    w('w1', 'start', 'out', 'decl', 'in'),
    w('w2', 'decl', 'out', 'ecrireAda', 'in'),
    w('w3', 'lireAges1', 'value', 'ecrireAda', 'dict'),
    w('w4', 'cleAda', 'value', 'ecrireAda', 'key'),
    w('w5', 'ageAda', 'value', 'ecrireAda', 'value'),
    w('w6', 'ecrireAda', 'out', 'ecrireAlan', 'in'),
    w('w7', 'lireAges2', 'value', 'ecrireAlan', 'dict'),
    w('w8', 'cleAlan', 'value', 'ecrireAlan', 'key'),
    w('w9', 'ageAlan', 'value', 'ecrireAlan', 'value'),
    w('w10', 'ecrireAlan', 'out', 'afficherTaille', 'in'),
    w('w11', 'taille', 'length', 'afficherTaille', 'value'),
    w('w12', 'lireAges3', 'value', 'taille', 'dict'),
    w('w13', 'afficherTaille', 'out', 'afficherAge', 'in'),
    w('w14', 'lireAge', 'value', 'afficherAge', 'value'),
    w('w15', 'lireAges4', 'value', 'lireAge', 'dict'),
    w('w16', 'cleAda2', 'value', 'lireAge', 'key'),
    w('w17', 'afficherAge', 'out', 'afficherPresente', 'in'),
    w('w18', 'presente', 'result', 'afficherPresente', 'value'),
    w('w19', 'lireAges5', 'value', 'presente', 'dict'),
    w('w20', 'cleAda3', 'value', 'presente', 'key')
  ]);

  BP.EXAMPLES = [
    { id: 'bonjour', name: 'Bonjour', description: 'Le plus petit programme possible.', graph: BONJOUR },
    { id: 'boucle', name: 'Somme 1..5', description: 'Variables, boucle et calcul : 0+1+2+3+4.', graph: BOUCLE },
    { id: 'fonction', name: 'Fonction et condition', description: 'Fonction avec paramètre, comparaison et Si/Sinon.', graph: FONCTION },
    { id: 'tableau', name: 'Somme d’un tableau', description: 'Tableau littéral et boucle Pour chaque : 4+8+15+16.', graph: TABLEAU },
    { id: 'dictionnaire', name: 'Dictionnaire', description: 'Dictionnaire de clés texte : écrire, lire, tester et compter.', graph: DICO }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
