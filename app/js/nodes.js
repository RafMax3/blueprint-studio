/* Catalogue des nœuds disponibles dans l'éditeur.
   Chaque définition décrit les broches (entrées / sorties) et les propriétés du nœud. */
(function (root) {
  'use strict';
  const BP = (root.BP = root.BP || {});

  const K = { EXEC: 'exec', NUMBER: 'number', STRING: 'string', BOOL: 'bool', ARRAY: 'array',
    DICT: 'dict', ANY: 'any' };
  const VAL_TYPES = ['int', 'double', 'string', 'bool'];

  BP.K = K;
  BP.VAL_TYPES = VAL_TYPES;
  BP.KIND_COLOR = {
    exec: '#d9e2ee',
    number: '#4ec9b0',
    string: '#e0b070',
    bool: '#e06c75',
    array: '#b08cff',
    any: '#9aa7b8'
  };
  BP.TYPE_LABEL = {
    int: 'entier (int)',
    double: 'décimal (double)',
    string: 'texte (string)',
    bool: 'booléen (bool)',
    void: 'aucun (void)'
  };

  function txt(id, label, def, extra) {
    return Object.assign({ id: id, label: label, def: def, control: 'text' }, extra || {});
  }
  function sel(id, label, def, options) {
    return { id: id, label: label, def: def, control: 'select', options: options };
  }

  const DEFS = {
    event_start: {
      title: 'Début',
      category: 'Événements',
      accent: '#e0605c',
      desc: "Point d'entrée du programme : tout ce qui suit ce nœud est exécuté en premier.",
      inputs: [],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    print: {
      title: 'Afficher',
      category: 'Actions',
      accent: '#3f8cff',
      desc: 'Affiche une valeur dans la console.',
      inputs: [{ id: 'in', kind: K.EXEC }, { id: 'value', kind: K.ANY, label: 'valeur' }],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    print_inline: {
      title: 'Afficher sans retour',
      category: 'Actions',
      accent: '#3f8cff',
      desc: 'Affiche une valeur sans passer à la ligne suivante.',
      inputs: [{ id: 'in', kind: K.EXEC }, { id: 'value', kind: K.ANY, label: 'valeur' }],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    wait: {
      title: 'Attendre',
      category: 'Actions',
      accent: '#3f8cff',
      desc: 'Met le programme en pause pendant une durée en secondes.',
      inputs: [{ id: 'in', kind: K.EXEC }, { id: 'seconds', kind: K.NUMBER, label: 'secondes', def: '1' }],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    var_decl: {
      title: 'Déclarer variable',
      category: 'Variables',
      accent: '#9a7bff',
      desc: 'Crée une variable typée. Indispensable en C# et C++ avant de la définir.',
      inputs: [{ id: 'in', kind: K.EXEC }],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: [
        txt('name', 'Nom', 'x'),
        sel('vtype', 'Type', 'int', VAL_TYPES)
      ]
    },

    set_var: {
      title: 'Définir variable',
      category: 'Variables',
      accent: '#9a7bff',
      desc: 'Assigne une nouvelle valeur à une variable.',
      inputs: [{ id: 'in', kind: K.EXEC }, { id: 'value', kind: K.ANY, label: 'valeur' }],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: [txt('name', 'Variable', 'x')]
    },

    get_var: {
      title: 'Lire variable',
      category: 'Variables',
      accent: '#9a7bff',
      desc: 'Renvoie la valeur actuelle d’une variable.',
      inputs: [],
      outputs: [{ id: 'value', kind: K.ANY, label: 'valeur' }],
      props: [txt('name', 'Variable', 'x')]
    },

    inc_var: {
      title: 'Modifier variable',
      category: 'Variables',
      accent: '#9a7bff',
      desc: 'Ajoute, retire, multiplie ou divise la valeur d’une variable.',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'amount', kind: K.NUMBER, label: 'valeur', def: '1' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: [txt('name', 'Variable', 'x'), sel('op', 'Opération', '+=', ['+=', '-=', '*=', '/='])]
    },

    literal_number: {
      title: 'Nombre',
      category: 'Valeurs',
      accent: '#2ea88f',
      desc: 'Constante numérique (entier ou décimal).',
      inputs: [],
      outputs: [{ id: 'value', kind: K.NUMBER, label: 'valeur' }],
      props: [txt('value', 'Valeur', '0')]
    },

    literal_string: {
      title: 'Texte',
      category: 'Valeurs',
      accent: '#2ea88f',
      desc: 'Constante de type chaîne de caractères.',
      inputs: [],
      outputs: [{ id: 'value', kind: K.STRING, label: 'valeur' }],
      props: [txt('value', 'Valeur', 'Bonjour')]
    },

    literal_bool: {
      title: 'Booléen',
      category: 'Valeurs',
      accent: '#2ea88f',
      desc: 'Constante vrai / faux.',
      inputs: [],
      outputs: [{ id: 'value', kind: K.BOOL, label: 'valeur' }],
      props: [sel('value', 'Valeur', 'true', ['true', 'false'])]
    },

    random_number: {
      title: 'Nombre aléatoire',
      category: 'Valeurs',
      accent: '#2ea88f',
      desc: 'Renvoie un entier aléatoire entre deux bornes incluses.',
      inputs: [
        { id: 'min', kind: K.NUMBER, label: 'min', def: '1' },
        { id: 'max', kind: K.NUMBER, label: 'max', def: '6' }
      ],
      outputs: [{ id: 'value', kind: K.NUMBER, label: 'valeur' }],
      props: []
    },

    math: {
      title: 'Opération',
      category: 'Maths',
      accent: '#2ea88f',
      desc: 'Calcul arithmétique entre deux valeurs numériques.',
      inputs: [
        { id: 'a', kind: K.NUMBER, label: 'a', def: '0' },
        { id: 'b', kind: K.NUMBER, label: 'b', def: '0' }
      ],
      outputs: [{ id: 'result', kind: K.NUMBER, label: 'résultat' }],
      props: [sel('op', 'Opérateur', '+', ['+', '-', '*', '/', '%'])]
    },

    power: {
      title: 'Puissance',
      category: 'Maths',
      accent: '#2ea88f',
      desc: 'Élève un nombre à une puissance.',
      inputs: [
        { id: 'a', kind: K.NUMBER, label: 'base', def: '2' },
        { id: 'b', kind: K.NUMBER, label: 'exposant', def: '3' }
      ],
      outputs: [{ id: 'result', kind: K.NUMBER, label: 'résultat' }],
      props: []
    },

    sqrt: {
      title: 'Racine carrée',
      category: 'Maths',
      accent: '#2ea88f',
      desc: 'Renvoie la racine carrée d’un nombre.',
      inputs: [{ id: 'value', kind: K.NUMBER, label: 'valeur', def: '9' }],
      outputs: [{ id: 'result', kind: K.NUMBER, label: 'résultat' }],
      props: []
    },

    absolute: {
      title: 'Valeur absolue',
      category: 'Maths',
      accent: '#2ea88f',
      desc: 'Renvoie la valeur absolue (toujours positive).',
      inputs: [{ id: 'value', kind: K.NUMBER, label: 'valeur', def: '0' }],
      outputs: [{ id: 'result', kind: K.NUMBER, label: 'résultat' }],
      props: []
    },

    rounding: {
      title: 'Arrondi',
      category: 'Maths',
      accent: '#2ea88f',
      desc: 'Arrondit à l’entier le plus proche, à l’entier inférieur ou supérieur.',
      inputs: [{ id: 'value', kind: K.NUMBER, label: 'valeur', def: '0' }],
      outputs: [{ id: 'result', kind: K.NUMBER, label: 'résultat' }],
      props: [sel('op', 'Mode', 'round', ['round', 'floor', 'ceil'])]
    },

    round_n: {
      title: 'Arrondi décimal',
      category: 'Maths',
      accent: '#2ea88f',
      desc: 'Arrondit un nombre à un nombre donné de décimales.',
      inputs: [
        { id: 'value', kind: K.NUMBER, label: 'valeur', def: '0' },
        { id: 'decimals', kind: K.NUMBER, label: 'décimales', def: '2' }
      ],
      outputs: [{ id: 'result', kind: K.NUMBER, label: 'résultat' }],
      props: []
    },

    minmax: {
      title: 'Minimum / maximum',
      category: 'Maths',
      accent: '#2ea88f',
      desc: 'Renvoie le plus petit ou le plus grand de deux nombres.',
      inputs: [
        { id: 'a', kind: K.NUMBER, label: 'a', def: '0' },
        { id: 'b', kind: K.NUMBER, label: 'b', def: '0' }
      ],
      outputs: [{ id: 'result', kind: K.NUMBER, label: 'résultat' }],
      props: [sel('op', 'Choix', 'min', ['min', 'max'])]
    },

    pi: {
      title: 'Pi',
      category: 'Maths',
      accent: '#2ea88f',
      desc: 'Constante π (3,14159…).',
      inputs: [],
      outputs: [{ id: 'value', kind: K.NUMBER, label: 'valeur' }],
      props: []
    },

    compare: {
      title: 'Comparaison',
      category: 'Logique',
      accent: '#d98b3f',
      desc: 'Compare deux valeurs et renvoie un booléen.',
      inputs: [
        { id: 'a', kind: K.ANY, label: 'a' },
        { id: 'b', kind: K.ANY, label: 'b' }
      ],
      outputs: [{ id: 'result', kind: K.BOOL, label: 'résultat' }],
      props: [sel('op', 'Opérateur', '==', ['==', '!=', '<', '>', '<=', '>='])]
    },

    logic: {
      title: 'Et / Ou',
      category: 'Logique',
      accent: '#d98b3f',
      desc: 'Combine deux conditions avec ET ou OU.',
      inputs: [
        { id: 'a', kind: K.BOOL, label: 'a', def: 'false' },
        { id: 'b', kind: K.BOOL, label: 'b', def: 'false' }
      ],
      outputs: [{ id: 'result', kind: K.BOOL, label: 'résultat' }],
      props: [sel('op', 'Opérateur', 'et', ['et', 'ou'])]
    },

    not: {
      title: 'Non',
      category: 'Logique',
      accent: '#d98b3f',
      desc: 'Inverse une condition (vrai devient faux).',
      inputs: [{ id: 'value', kind: K.BOOL, label: 'valeur', def: 'false' }],
      outputs: [{ id: 'result', kind: K.BOOL, label: 'résultat' }],
      props: []
    },

    format: {
      title: 'Concaténer',
      category: 'Texte',
      accent: '#2ea88f',
      desc: 'Colle deux textes bout à bout.',
      inputs: [
        { id: 'a', kind: K.STRING, label: 'a', def: '""' },
        { id: 'b', kind: K.STRING, label: 'b', def: '""' }
      ],
      outputs: [{ id: 'result', kind: K.STRING, label: 'résultat' }],
      props: []
    },

    text_length: {
      title: 'Longueur texte',
      category: 'Texte',
      accent: '#2ea88f',
      desc: 'Renvoie le nombre de caractères d’un texte.',
      inputs: [{ id: 'text', kind: K.STRING, label: 'texte', def: '""' }],
      outputs: [{ id: 'length', kind: K.NUMBER, label: 'longueur' }],
      props: []
    },

    text_case: {
      title: 'Majuscules / minuscules',
      category: 'Texte',
      accent: '#2ea88f',
      desc: 'Passe un texte en majuscules ou en minuscules.',
      inputs: [{ id: 'text', kind: K.STRING, label: 'texte', def: '""' }],
      outputs: [{ id: 'result', kind: K.STRING, label: 'résultat' }],
      props: [sel('op', 'Mode', 'majuscules', ['majuscules', 'minuscules'])]
    },

    text_replace: {
      title: 'Remplacer dans texte',
      category: 'Texte',
      accent: '#2ea88f',
      desc: 'Remplace toutes les occurrences d’un morceau de texte.',
      inputs: [
        { id: 'text', kind: K.STRING, label: 'texte', def: '""' },
        { id: 'search', kind: K.STRING, label: 'à remplacer', def: '"a"' },
        { id: 'replacement', kind: K.STRING, label: 'par', def: '"b"' }
      ],
      outputs: [{ id: 'result', kind: K.STRING, label: 'résultat' }],
      props: []
    },

    text_contains: {
      title: 'Texte contient',
      category: 'Texte',
      accent: '#2ea88f',
      desc: 'Indique si un texte contient un morceau donné.',
      inputs: [
        { id: 'text', kind: K.STRING, label: 'texte', def: '""' },
        { id: 'search', kind: K.STRING, label: 'recherche', def: '""' }
      ],
      outputs: [{ id: 'result', kind: K.BOOL, label: 'résultat' }],
      props: []
    },

    text_substring: {
      title: 'Sous-chaîne',
      category: 'Texte',
      accent: '#2ea88f',
      desc: 'Extrait une partie d’un texte à partir d’un indice et d’une longueur.',
      inputs: [
        { id: 'text', kind: K.STRING, label: 'texte', def: '""' },
        { id: 'start', kind: K.NUMBER, label: 'début', def: '0' },
        { id: 'length', kind: K.NUMBER, label: 'longueur', def: '3' }
      ],
      outputs: [{ id: 'result', kind: K.STRING, label: 'résultat' }],
      props: []
    },

    text_split: {
      title: 'Découper texte',
      category: 'Texte',
      accent: '#2ea88f',
      desc: 'Découpe un texte selon un séparateur et renvoie un tableau de morceaux.',
      inputs: [
        { id: 'text', kind: K.STRING, label: 'texte', def: '""' },
        { id: 'separator', kind: K.STRING, label: 'séparateur', def: '","' }
      ],
      outputs: [{ id: 'parts', kind: K.ARRAY, label: 'tableau' }],
      props: []
    },

    text_join: {
      title: 'Joindre tableau',
      category: 'Texte',
      accent: '#2ea88f',
      desc: 'Colle les éléments d’un tableau avec un séparateur.',
      inputs: [
        { id: 'array', kind: K.ARRAY, label: 'tableau' },
        { id: 'separator', kind: K.STRING, label: 'séparateur', def: '", "' }
      ],
      outputs: [{ id: 'result', kind: K.STRING, label: 'résultat' }],
      props: []
    },

    to_int: {
      title: 'En entier',
      category: 'Conversions',
      accent: '#2ea88f',
      desc: 'Convertit une valeur en nombre entier (valeur invalide = 0).',
      inputs: [{ id: 'value', kind: K.ANY, label: 'valeur', def: '"0"' }],
      outputs: [{ id: 'result', kind: K.NUMBER, label: 'entier' }],
      props: []
    },

    to_double: {
      title: 'En décimal',
      category: 'Conversions',
      accent: '#2ea88f',
      desc: 'Convertit une valeur en nombre décimal (valeur invalide = 0).',
      inputs: [{ id: 'value', kind: K.ANY, label: 'valeur', def: '"0"' }],
      outputs: [{ id: 'result', kind: K.NUMBER, label: 'nombre' }],
      props: []
    },

    to_string: {
      title: 'En texte',
      category: 'Conversions',
      accent: '#2ea88f',
      desc: 'Convertit un nombre ou un booléen en texte.',
      inputs: [{ id: 'value', kind: K.ANY, label: 'valeur', def: '"0"' }],
      outputs: [{ id: 'result', kind: K.STRING, label: 'texte' }],
      props: []
    },

    array_decl: {
      title: 'Déclarer tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Crée une variable tableau vide d’un type d’élément donné.',
      inputs: [{ id: 'in', kind: K.EXEC }],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: [
        txt('name', 'Variable', 'liste'),
        sel('etype', 'Éléments', 'int', VAL_TYPES)
      ]
    },

    array_new: {
      title: 'Créer tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Construit un tableau à partir de valeurs séparées par des virgules (ex. « 3, 5, 7 »).',
      inputs: [],
      outputs: [{ id: 'value', kind: K.ARRAY, label: 'tableau' }],
      props: [txt('items', 'Valeurs', '3, 5, 7')]
    },

    array_length: {
      title: 'Longueur tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Renvoie le nombre d’éléments d’un tableau.',
      inputs: [{ id: 'array', kind: K.ARRAY, label: 'tableau' }],
      outputs: [{ id: 'length', kind: K.NUMBER, label: 'longueur' }],
      props: []
    },

    array_get: {
      title: 'Élément du tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Renvoie l’élément situé à l’indice donné (le premier indice est 0).',
      inputs: [
        { id: 'array', kind: K.ARRAY, label: 'tableau' },
        { id: 'index', kind: K.NUMBER, label: 'indice', def: '0' }
      ],
      outputs: [{ id: 'value', kind: K.ANY, label: 'valeur' }],
      props: []
    },

    array_push: {
      title: 'Ajouter au tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Ajoute une valeur à la fin d’un tableau.',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'array', kind: K.ARRAY, label: 'tableau' },
        { id: 'value', kind: K.ANY, label: 'valeur' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    array_set: {
      title: 'Définir élément',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Remplace l’élément situé à un indice donné.',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'array', kind: K.ARRAY, label: 'tableau' },
        { id: 'index', kind: K.NUMBER, label: 'indice', def: '0' },
        { id: 'value', kind: K.ANY, label: 'valeur' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    array_insert: {
      title: 'Insérer dans tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Insère une valeur avant l’indice donné.',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'array', kind: K.ARRAY, label: 'tableau' },
        { id: 'index', kind: K.NUMBER, label: 'indice', def: '0' },
        { id: 'value', kind: K.ANY, label: 'valeur' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    array_remove: {
      title: 'Supprimer élément',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Supprime l’élément situé à un indice donné.',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'array', kind: K.ARRAY, label: 'tableau' },
        { id: 'index', kind: K.NUMBER, label: 'indice', def: '0' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    array_contains: {
      title: 'Tableau contient',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Indique si une valeur se trouve dans le tableau.',
      inputs: [
        { id: 'array', kind: K.ARRAY, label: 'tableau' },
        { id: 'value', kind: K.ANY, label: 'valeur' }
      ],
      outputs: [{ id: 'result', kind: K.BOOL, label: 'résultat' }],
      props: []
    },

    array_index_of: {
      title: 'Indice d’un élément',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Renvoie l’indice d’une valeur dans le tableau (-1 si absente).',
      inputs: [
        { id: 'array', kind: K.ARRAY, label: 'tableau' },
        { id: 'value', kind: K.ANY, label: 'valeur' }
      ],
      outputs: [{ id: 'index', kind: K.NUMBER, label: 'indice' }],
      props: []
    },

    array_sort: {
      title: 'Trier tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Trie le tableau sur place (ordre croissant).',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'array', kind: K.ARRAY, label: 'tableau' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    array_reverse: {
      title: 'Inverser tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Inverse l’ordre des éléments du tableau.',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'array', kind: K.ARRAY, label: 'tableau' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    array_clear: {
      title: 'Vider tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Supprime tous les éléments du tableau.',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'array', kind: K.ARRAY, label: 'tableau' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    array_sum: {
      title: 'Somme du tableau',
      category: 'Tableaux',
      accent: '#2ea88f',
      desc: 'Additionne tous les nombres du tableau.',
      inputs: [{ id: 'array', kind: K.ARRAY, label: 'tableau' }],
      outputs: [{ id: 'total', kind: K.NUMBER, label: 'total' }],
      props: []
    },

    dict_decl: {
      title: 'Déclarer dictionnaire',
      category: 'Dictionnaires',
      accent: '#8b6ce0',
      desc: 'Crée un dictionnaire vide : chaque clé associe une valeur.',
      inputs: [{ id: 'in', kind: K.EXEC }],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: [
        txt('name', 'Variable', 'dico'),
        sel('ktype', 'Clés', 'string', ['string', 'int']),
        sel('vtype', 'Valeurs', 'int', VAL_TYPES)
      ]
    },

    dict_set: {
      title: 'Écrire dans le dictionnaire',
      category: 'Dictionnaires',
      accent: '#8b6ce0',
      desc: 'Associe une valeur à une clé (remplace la valeur existante).',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'dict', kind: K.DICT, label: 'dictionnaire' },
        { id: 'key', kind: K.ANY, label: 'clé' },
        { id: 'value', kind: K.ANY, label: 'valeur' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    dict_get: {
      title: 'Lire dans le dictionnaire',
      category: 'Dictionnaires',
      accent: '#8b6ce0',
      desc: 'Renvoie la valeur associée à une clé, ou la valeur par défaut du type si la clé est absente.',
      inputs: [
        { id: 'dict', kind: K.DICT, label: 'dictionnaire' },
        { id: 'key', kind: K.ANY, label: 'clé' }
      ],
      outputs: [{ id: 'value', kind: K.ANY, label: 'valeur' }],
      props: []
    },

    dict_has: {
      title: 'Clé présente ?',
      category: 'Dictionnaires',
      accent: '#8b6ce0',
      desc: 'Indique si le dictionnaire contient la clé donnée.',
      inputs: [
        { id: 'dict', kind: K.DICT, label: 'dictionnaire' },
        { id: 'key', kind: K.ANY, label: 'clé' }
      ],
      outputs: [{ id: 'result', kind: K.BOOL, label: 'présente' }],
      props: []
    },

    dict_len: {
      title: 'Taille du dictionnaire',
      category: 'Dictionnaires',
      accent: '#8b6ce0',
      desc: 'Renvoie le nombre de paires clé/valeur.',
      inputs: [{ id: 'dict', kind: K.DICT, label: 'dictionnaire' }],
      outputs: [{ id: 'length', kind: K.NUMBER, label: 'taille' }],
      props: []
    },

    branch: {
      title: 'Si / Sinon',
      category: 'Logique',
      accent: '#d98b3f',
      desc: 'Exécute une branche selon une condition.',
      inputs: [{ id: 'in', kind: K.EXEC }, { id: 'cond', kind: K.BOOL, label: 'condition', def: 'false' }],
      outputs: [
        { id: 'true', kind: K.EXEC, label: 'Vrai' },
        { id: 'false', kind: K.EXEC, label: 'Faux' }
      ],
      props: []
    },

    for_range: {
      title: 'Boucle Pour',
      category: 'Boucles',
      accent: '#4d9de0',
      desc: 'Répète le corps <nombre> fois, avec un compteur.',
      inputs: [{ id: 'in', kind: K.EXEC }, { id: 'count', kind: K.NUMBER, label: 'nombre', def: '5' }],
      outputs: [
        { id: 'body', kind: K.EXEC, label: 'corps' },
        { id: 'done', kind: K.EXEC, label: 'après' }
      ],
      props: [txt('var', 'Compteur', 'i')]
    },

    while_loop: {
      title: 'Boucle Tant que',
      category: 'Boucles',
      accent: '#4d9de0',
      desc: 'Répète le corps tant que la condition est vraie.',
      inputs: [{ id: 'in', kind: K.EXEC }, { id: 'cond', kind: K.BOOL, label: 'condition', def: 'false' }],
      outputs: [
        { id: 'body', kind: K.EXEC, label: 'corps' },
        { id: 'done', kind: K.EXEC, label: 'après' }
      ],
      props: []
    },

    break_loop: {
      title: 'Arrêter la boucle',
      category: 'Boucles',
      accent: '#4d9de0',
      desc: 'Sort immédiatement de la boucle en cours.',
      inputs: [{ id: 'in', kind: K.EXEC }],
      outputs: [],
      props: []
    },

    continue_loop: {
      title: 'Continuer la boucle',
      category: 'Boucles',
      accent: '#4d9de0',
      desc: 'Passe directement au tour suivant de la boucle.',
      inputs: [{ id: 'in', kind: K.EXEC }],
      outputs: [],
      props: []
    },

    for_each: {
      title: 'Boucle Pour chaque',
      category: 'Boucles',
      accent: '#4d9de0',
      desc: 'Parcourt un tableau : le corps reçoit chaque élément dans la variable indiquée.',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'array', kind: K.ARRAY, label: 'tableau' }
      ],
      outputs: [
        { id: 'body', kind: K.EXEC, label: 'corps' },
        { id: 'done', kind: K.EXEC, label: 'après' }
      ],
      props: [txt('var', 'Élément', 'element')]
    },

    function_def: {
      title: 'Définir fonction',
      category: 'Fonctions',
      accent: '#c9569b',
      desc: 'Déclare une fonction et son corps. Paramètres au format « a: int, b: string ».',
      inputs: [],
      outputs: [{ id: 'body', kind: K.EXEC, label: 'corps' }],
      props: [
        txt('name', 'Nom', 'ma_fonction'),
        txt('params', 'Paramètres', 'a: int'),
        sel('rettype', 'Retour', 'int', ['void'].concat(VAL_TYPES))
      ],
      dynamic: 'function_def'
    },

    call_func: {
      title: 'Appeler fonction',
      category: 'Fonctions',
      accent: '#c9569b',
      desc: 'Appelle une fonction déclarée et renvoie sa valeur de retour.',
      inputs: [],
      outputs: [{ id: 'result', kind: K.ANY, label: 'résultat' }],
      props: [
        txt('name', 'Nom', 'ma_fonction'),
        txt('args', 'Arguments', 'a')
      ],
      dynamic: 'call_func'
    },

    return_value: {
      title: 'Retourner',
      category: 'Fonctions',
      accent: '#c9569b',
      desc: 'Renvoie une valeur depuis la fonction courante.',
      inputs: [{ id: 'in', kind: K.EXEC }, { id: 'value', kind: K.ANY, label: 'valeur' }],
      outputs: [],
      props: []
    },

    call_stmt: {
      title: 'Appeler (instruction)',
      category: 'Fonctions',
      accent: '#c9569b',
      desc: 'Appelle une fonction sans utiliser sa valeur de retour. Arguments au format « a, b ».',
      inputs: [{ id: 'in', kind: K.EXEC }],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: [
        txt('name', 'Nom', 'ma_fonction'),
        txt('args', 'Arguments', '')
      ],
      dynamic: 'call_func'
    },

    input_text: {
      title: 'Saisie texte',
      category: 'Entrées / sorties',
      accent: '#5aa9a0',
      desc: 'Demande une ligne de texte à l’utilisateur dans la console.',
      inputs: [],
      outputs: [{ id: 'value', kind: K.STRING, label: 'texte' }],
      props: [txt('prompt', 'Invite', 'Votre nom : ')]
    },

    input_number: {
      title: 'Saisie nombre',
      category: 'Entrées / sorties',
      accent: '#5aa9a0',
      desc: 'Demande un nombre à l’utilisateur et redemande tant que la saisie est invalide.',
      inputs: [],
      outputs: [{ id: 'value', kind: K.NUMBER, label: 'nombre' }],
      props: [txt('prompt', 'Invite', 'Un nombre : ')]
    },

    file_read: {
      title: 'Lire fichier',
      category: 'Entrées / sorties',
      accent: '#5aa9a0',
      desc: 'Lit un fichier texte et renvoie son contenu (chaîne vide en cas d’erreur).',
      inputs: [{ id: 'path', kind: K.STRING, label: 'chemin', def: '"donnees.txt"' }],
      outputs: [{ id: 'content', kind: K.STRING, label: 'contenu' }],
      props: []
    },

    file_write: {
      title: 'Écrire fichier',
      category: 'Entrées / sorties',
      accent: '#5aa9a0',
      desc: 'Écrit un texte dans un fichier (le contenu existant est remplacé).',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'path', kind: K.STRING, label: 'chemin', def: '"sortie.txt"' },
        { id: 'content', kind: K.STRING, label: 'contenu', def: '""' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    file_append: {
      title: 'Ajouter au fichier',
      category: 'Entrées / sorties',
      accent: '#5aa9a0',
      desc: 'Ajoute un texte à la fin d’un fichier (le contenu existant est conservé).',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'path', kind: K.STRING, label: 'chemin', def: '"journal.txt"' },
        { id: 'content', kind: K.STRING, label: 'contenu', def: '""' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    file_exists: {
      title: 'Fichier existe ?',
      category: 'Entrées / sorties',
      accent: '#5aa9a0',
      desc: 'Indique si un fichier existe à ce chemin.',
      inputs: [{ id: 'path', kind: K.STRING, label: 'chemin', def: '"donnees.txt"' }],
      outputs: [{ id: 'result', kind: K.BOOL, label: 'existe' }],
      props: []
    },

    file_delete: {
      title: 'Supprimer fichier',
      category: 'Entrées / sorties',
      accent: '#5aa9a0',
      desc: 'Supprime un fichier s’il existe.',
      inputs: [
        { id: 'in', kind: K.EXEC },
        { id: 'path', kind: K.STRING, label: 'chemin', def: '"donnees.txt"' }
      ],
      outputs: [{ id: 'out', kind: K.EXEC }],
      props: []
    },

    now_text: {
      title: 'Date et heure',
      category: 'Temps',
      accent: '#7bb0a8',
      desc: 'Renvoie la date et l’heure actuelles sous forme de texte.',
      inputs: [],
      outputs: [{ id: 'value', kind: K.STRING, label: 'texte' }],
      props: []
    },

    comment: {
      title: 'Commentaire',
      category: 'Divers',
      accent: '#8a929c',
      desc: 'Note libre. Aucun code généré.',
      inputs: [],
      outputs: [],
      props: [{ id: 'text', label: '', def: 'Note…', control: 'textarea' }],
      noPins: true,
      fixedWidth: 300,
      fixedHeight: 150
    }
  };

  BP.DEFS = DEFS;

  BP.CATEGORIES = [
    'Événements',
    'Actions',
    'Variables',
    'Valeurs',
    'Maths',
    'Texte',
    'Conversions',
    'Tableaux',
    'Logique',
    'Boucles',
    'Fonctions',
    'Entrées / sorties',
    'Temps',
    'Divers'
  ];

  /** Nettoie un identifiant de variable / fonction. */
  function sanitizeIdent(value, fallback) {
    let s = String(value == null ? '' : value).trim();
    s = s.replace(/[^\w\u00C0-\u024F]/g, '_');
    if (!s) s = fallback || 'valeur';
    if (/^\d/.test(s)) s = '_' + s;
    return s;
  }
  BP.sanitizeIdent = sanitizeIdent;

  /** "a: int, b: string" -> [{ name:'a', type:'int' }, ...] */
  function parseParams(spec) {
    if (!spec) return [];
    return String(spec)
      .split(',')
      .map(function (p) { return p.trim(); })
      .filter(Boolean)
      .map(function (part, i) {
        const bits = part.split(':');
        const name = sanitizeIdent(bits[0], 'arg' + (i + 1));
        let type = (bits[1] || 'int').trim().toLowerCase();
        if (type === 'float' || type === 'decimal') type = 'double';
        if (type === 'str' || type === 'text') type = 'string';
        if (VAL_TYPES.indexOf(type) === -1) type = 'int';
        return { name: name, type: type };
      });
  }
  BP.parseParams = parseParams;

  /** Paramètres d'un nœud « Appeler fonction » : "a, b" */
  function parseArgs(spec) {
    if (!spec) return [];
    return String(spec)
      .split(',')
      .map(function (p, i) { return p.trim(); })
      .filter(Boolean)
      .map(function (p, i) { return sanitizeIdent(p.split(':')[0], 'arg' + (i + 1)); });
  }
  BP.parseArgs = parseArgs;

  /** Broches réelles d'un nœud (certaines sont dynamiques). */
  function pinsOf(node) {
    const def = DEFS[node.type] || { inputs: [], outputs: [] };
    const inputs = (def.inputs || []).slice();
    const outputs = (def.outputs || []).slice();

    if (node.type === 'function_def') {
      const params = parseParams(node.props && node.props.params);
      inputs.unshift.apply(inputs, params.map(function (p) {
        return { id: 'param:' + p.name, kind: K.ANY, label: p.name, def: def0(p.type) };
      }));
    }
    if (node.type === 'call_func' || node.type === 'call_stmt') {
      const args = parseArgs(node.props && node.props.args);
      const argPins = args.map(function (name) {
        return { id: 'arg:' + name, kind: K.ANY, label: name, def: '0' };
      });
      if (node.type === 'call_func') inputs.unshift.apply(inputs, argPins);
      else inputs.push.apply(inputs, argPins);
    }
    return { inputs: inputs, outputs: outputs };
  }

  function def0(type) {
    if (type === 'double') return '0.0';
    if (type === 'string') return '""';
    if (type === 'bool') return 'false';
    return '0';
  }
  BP.defaultForType = def0;

  BP.pinsOf = pinsOf;

  BP.pinInfo = function (node, pinId, dir) {
    const pins = pinsOf(node);
    const list = dir === 'in' ? pins.inputs : pins.outputs;
    for (let i = 0; i < list.length; i++) if (list[i].id === pinId) return list[i];
    return null;
  };

  BP.defOf = function (node) {
    return DEFS[node.type] || { title: node.type, accent: '#888', props: [] };
  };
})(typeof window !== 'undefined' ? window : globalThis);
