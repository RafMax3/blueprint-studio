/* Couverture complète : construit un graphe utilisant les 67 nœuds, génère les trois
   langages et compile le C++ si un compilateur est disponible.
   Usage : node tools/coverage.js        (BP_CXX pour choisir le compilateur) */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const context = vm.createContext({ console: console });
['nodes', 'graph', 'codegen'].forEach(function (name) {
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'app', 'js', name + '.js'), 'utf8'),
    context, { filename: name + '.js' });
});
const BP = context.BP;
const P = BP.model;

/* ------------------------------------------------------------ construction */

const graph = P.newGraph('Couverture');
let seq = 0;

function N(type, props) {
  const id = 'n' + (++seq);
  graph.nodes.push({ id: id, type: type, x: seq * 30, y: 0, props: Object.assign({}, props) });
  return id;
}
function L(from, fromPin, to, toPin) {
  graph.wires.push({ id: 'w' + (++seq), from: { node: from, pin: fromPin }, to: { node: to, pin: toPin } });
}
function num(v) { return N('literal_number', { value: String(v) }); }
function str(v) { return N('literal_string', { value: v }); }
function bool(v) { return N('literal_bool', { value: v ? 'true' : 'false' }); }
function read(name) { return N('get_var', { name: name }); }

const start = N('event_start');
let tail = { node: start, pin: 'out' };

function step(type, props) {
  const id = N(type, props);
  L(tail.node, tail.pin, id, 'in');
  tail = { node: id, pin: 'out' };
  return id;
}
function show(valueId, pin, inline) {
  const id = step(inline ? 'print_inline' : 'print');
  L(valueId, pin, id, 'value');
  return id;
}
function binary(type, props, a, b, outPin) {
  const id = N(type, props);
  L(a, 'result', id, 'a');
  L(b, 'result', id, 'b');
  show(id, outPin || 'result');
  return id;
}

/* Événements, actions */
show(str('Bonjour'), 'value');
show(str(' … '), 'value', true);
const w = step('wait');
L(num(0), 'value', w, 'seconds');

/* Variables */
step('var_decl', { name: 'n', vtype: 'int' });
const setN = step('set_var', { name: 'n' });
L(num(7), 'value', setN, 'value');
const inc = step('inc_var', { name: 'n', op: '+=' });
L(num(2), 'value', inc, 'amount');
show(read('n'), 'value');

/* Valeurs et maths */
show(N('random_number'), 'value');
show(N('pi'), 'value');
const somme = N('math', { op: '+' });
L(num(0.1), 'value', somme, 'a');
L(num(0.2), 'value', somme, 'b');
show(somme, 'result');
const div = N('math', { op: '/' });
L(num(1), 'value', div, 'a');
L(num(3), 'value', div, 'b');
show(div, 'result');
const pow = N('power');
L(num(2), 'value', pow, 'a');
L(num(10), 'value', pow, 'b');
show(pow, 'result');
const sq = N('sqrt');
L(num(81), 'value', sq, 'value');
show(sq, 'result');
const abs = N('absolute');
L(num(-5), 'value', abs, 'value');
show(abs, 'result');
[['round', 3.6], ['floor', 3.2], ['ceil', 3.2]].forEach(function (pair) {
  const r = N('rounding', { op: pair[0] });
  L(num(pair[1]), 'value', r, 'value');
  show(r, 'result');
});
const rn = N('round_n');
L(num(3.14159), 'value', rn, 'value');
L(num(2), 'value', rn, 'decimals');
show(rn, 'result');
['min', 'max'].forEach(function (op) {
  const mm = N('minmax', { op: op });
  L(num(3), 'value', mm, 'a');
  L(num(8), 'value', mm, 'b');
  show(mm, 'result');
});

/* Logique */
const cmp = N('compare', { op: '!=' });
L(num(1), 'value', cmp, 'a');
L(num(2), 'value', cmp, 'b');
show(cmp, 'result');
const et = N('logic', { op: 'et' });
L(bool(true), 'value', et, 'a');
L(bool(false), 'value', et, 'b');
show(et, 'result');
const ou = N('logic', { op: 'ou' });
L(bool(true), 'value', ou, 'a');
L(bool(false), 'value', ou, 'b');
show(ou, 'result');
const non = N('not');
L(bool(false), 'value', non, 'value');
show(non, 'result');

/* Texte */
const fmt = N('format');
L(str('a'), 'value', fmt, 'a');
L(str('b'), 'value', fmt, 'b');
show(fmt, 'result');
show(N('text_length'), 'length');
const up = N('text_case', { op: 'majuscules' });
L(str('café'), 'value', up, 'text');
show(up, 'result');
const low = N('text_case', { op: 'minuscules' });
L(str('ÇÀ ÉCOLE'), 'value', low, 'text');
show(low, 'result');
const rep = N('text_replace');
L(str('a-b-c'), 'value', rep, 'text');
L(str('-'), 'value', rep, 'search');
L(str('+'), 'value', rep, 'replacement');
show(rep, 'result');
const tc = N('text_contains');
L(str('bonjour'), 'value', tc, 'text');
L(str('jour'), 'value', tc, 'search');
show(tc, 'result');
const sub = N('text_substring');
L(str('café'), 'value', sub, 'text');
L(num(2), 'value', sub, 'start');
L(num(2), 'value', sub, 'length');
show(sub, 'result');
const split = N('text_split');
L(str('a,b,c'), 'value', split, 'text');
L(str(','), 'value', split, 'separator');
show(split, 'parts');

/* Conversions */
const toInt = N('to_int');
L(str('42'), 'value', toInt, 'value');
show(toInt, 'result');
const toDouble = N('to_double');
L(str('3.5'), 'value', toDouble, 'value');
show(toDouble, 'result');
const toTexte = N('to_string');
L(div, 'result', toTexte, 'value');
show(toTexte, 'result');

/* Tableaux */
step('array_decl', { name: 'nombres', etype: 'int' });
const setNombres = step('set_var', { name: 'nombres' });
L(N('array_new', { items: '3, 1, 2' }), 'value', setNombres, 'value');
show(read('nombres'), 'value');

const len = N('array_length');
L(read('nombres'), 'value', len, 'array');
show(len, 'length');

const get0 = N('array_get');
L(read('nombres'), 'value', get0, 'array');
L(num(0), 'value', get0, 'index');
show(get0, 'value');

const push = step('array_push');
L(read('nombres'), 'value', push, 'array');
L(num(4), 'value', push, 'value');

const setItem = step('array_set');
L(read('nombres'), 'value', setItem, 'array');
L(num(0), 'value', setItem, 'index');
L(num(9), 'value', setItem, 'value');

const insert = step('array_insert');
L(read('nombres'), 'value', insert, 'array');
L(num(1), 'value', insert, 'index');
L(num(5), 'value', insert, 'value');

const remove = step('array_remove');
L(read('nombres'), 'value', remove, 'array');
L(num(2), 'value', remove, 'index');

const sort = step('array_sort');
L(read('nombres'), 'value', sort, 'array');
const reverse = step('array_reverse');
L(read('nombres'), 'value', reverse, 'array');

const contains = N('array_contains');
L(read('nombres'), 'value', contains, 'array');
L(num(2), 'value', contains, 'value');
show(contains, 'result');

const index = N('array_index_of');
L(read('nombres'), 'value', index, 'array');
L(num(2), 'value', index, 'value');
show(index, 'index');

const sum = N('array_sum');
L(read('nombres'), 'value', sum, 'array');
show(sum, 'total');

const joinNumbers = N('text_join');
L(read('nombres'), 'value', joinNumbers, 'array');
L(str(' | '), 'value', joinNumbers, 'separator');
show(joinNumbers, 'result');

const clear = step('array_clear');
L(read('nombres'), 'value', clear, 'array');

step('array_decl', { name: 'drapeaux', etype: 'bool' });
const setDrapeaux = step('set_var', { name: 'drapeaux' });
L(N('array_new', { items: 'true, false' }), 'value', setDrapeaux, 'value');
show(read('drapeaux'), 'value');  /* Dictionnaires */
  const dico = step('dict_decl', { name: 'ages', ktype: 'string', vtype: 'int' });
  const ecrireDico = step('dict_set');
  L(read('ages'), 'value', ecrireDico, 'dict');
  L(str('ada'), 'value', ecrireDico, 'key');
  L(num(36), 'value', ecrireDico, 'value');

  const lireDico = N('dict_get');
  L(read('ages'), 'value', lireDico, 'dict');
  L(str('ada'), 'value', lireDico, 'key');
  show(lireDico, 'value');

  const aCle = N('dict_has');
  L(read('ages'), 'value', aCle, 'dict');
  L(str('ada'), 'value', aCle, 'key');
  show(aCle, 'result');

  const tailleDico = N('dict_len');
  L(read('ages'), 'value', tailleDico, 'dict');
  show(tailleDico, 'length');
  void dico;

  /* Boucles */
const range = N('for_range', { var: 'i' });
L(tail.node, tail.pin, range, 'in');
L(num(3), 'value', range, 'count');
const br = N('branch');
L(range, 'body', br, 'in');
const cmpI = N('compare', { op: '==' });
L(read('i'), 'value', cmpI, 'a');
L(num(1), 'value', cmpI, 'b');
L(cmpI, 'result', br, 'cond');
const cont = N('continue_loop');
L(br, 'true', cont, 'in');
const printI = N('print');
L(br, 'false', printI, 'in');
L(read('i'), 'value', printI, 'value');
tail = { node: range, pin: 'done' };

const wl = N('while_loop');
L(tail.node, tail.pin, wl, 'in');
L(bool(true), 'value', wl, 'cond');
const brk = N('break_loop');
L(wl, 'body', brk, 'in');
tail = { node: wl, pin: 'done' };

const each = N('for_each', { var: 'drapeau' });
L(tail.node, tail.pin, each, 'in');
L(read('drapeaux'), 'value', each, 'array');
const eachPrint = N('print');
L(each, 'body', eachPrint, 'in');
L(read('drapeau'), 'value', eachPrint, 'value');
tail = { node: each, pin: 'done' };

/* Fonctions */
const moyenne = N('function_def', { name: 'moyenne', params: 'a: double, b: double', rettype: 'double' });
const ret = N('return_value');
L(moyenne, 'body', ret, 'in');
const add = N('math', { op: '+' });
L(read('a'), 'value', add, 'a');
L(read('b'), 'value', add, 'b');
const half = N('math', { op: '/' });
L(add, 'result', half, 'a');
L(num(2), 'value', half, 'b');
L(half, 'result', ret, 'value');

const affiche = N('function_def', { name: 'affiche', params: 'a: int', rettype: 'void' });
const affichePrint = N('print');
L(affiche, 'body', affichePrint, 'in');
L(read('a'), 'value', affichePrint, 'value');

const callFunc = N('call_func', { name: 'moyenne', args: 'a, b' });
L(num(1), 'value', callFunc, 'arg:a');
L(num(2), 'value', callFunc, 'arg:b');
show(callFunc, 'result');

const callStmt = step('call_stmt', { name: 'affiche', args: 'a' });
L(num(5), 'value', callStmt, 'arg:a');

/* Entrées / sorties et temps */
show(N('input_text', { prompt: 'Nom : ' }), 'value');
show(N('input_number', { prompt: 'Age : ' }), 'value');

const fw = step('file_write');
L(str('couverture.txt'), 'value', fw, 'path');
L(str('contenu'), 'value', fw, 'content');
const fa = step('file_append');
L(str('couverture.txt'), 'value', fa, 'path');
L(str(' suite'), 'value', fa, 'content');
const fr = N('file_read');
L(str('couverture.txt'), 'value', fr, 'path');
show(fr, 'content');
const exists = N('file_exists');
L(str('couverture.txt'), 'value', exists, 'path');
show(exists, 'result');
const del = step('file_delete');
L(str('couverture.txt'), 'value', del, 'path');
show(N('now_text'), 'value');

/* Divers */
N('comment', { text: 'Tous les nœuds' });

/* ------------------------------------------------------------------ tests */

function main() {
  /* --------------------------------------------------------------- contrôles */

  const used = new Set(graph.nodes.map(function (n) { return n.type; }));
  const missing = Object.keys(BP.DEFS).filter(function (t) { return !used.has(t); });
  const unknown = Array.from(used).filter(function (t) { return !BP.DEFS[t]; });

  console.log('Graphe : ' + graph.nodes.length + ' nœuds, ' + used.size + '/' +
    Object.keys(BP.DEFS).length + ' types utilisés');
  let failures = 0;
  if (missing.length) {
    failures++;
    console.log('  ✕ types non couverts : ' + missing.join(', '));
  }
  if (unknown.length) {
    failures++;
    console.log('  ✕ types inconnus : ' + unknown.join(', '));
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-coverage-'));
  const files = {
    python: 'couverture.py',
    csharp: 'Program.cs',
    cpp: 'couverture.cpp',
    unity: 'CouvertureUnity.cs'
  };
  const codes = {};

  BP.LANGS.forEach(function (lang) {
    const result = BP.generateCode(graph, lang.id);
    const errors = result.problems.filter(function (p) { return p.level === 'error'; });
    const warnings = result.problems.length - errors.length;
    console.log(lang.label + ' : ' + result.code.split('\n').length + ' lignes, ' +
      errors.length + ' erreur(s), ' + warnings + ' avertissement(s)');
    result.problems.forEach(function (p) { console.log('  ! ' + p.message); });
    if (errors.length) failures++;
    codes[lang.id] = result.code;
    fs.writeFileSync(path.join(tmpDir, files[lang.id]), result.code, 'utf8');
  });

  /* Compilation C++ si un compilateur est disponible. */
  function findCompiler() {
    const candidates = [process.env.BP_CXX, 'g++', 'clang++', 'c++'].filter(Boolean);
    for (let i = 0; i < candidates.length; i++) {
      try {
        execFileSync(candidates[i], ['--version'], { stdio: 'ignore' });
        return candidates[i];
      } catch (err) {
        /* suivant */
      }
    }
    return null;
  }

  const compiler = findCompiler();
  if (compiler) {
    const binary = path.join(tmpDir, 'couverture' + (process.platform === 'win32' ? '.exe' : ''));
    try {
      execFileSync(compiler, ['-std=c++17', '-Wall', '-Wextra', '-o', binary,
        path.join(tmpDir, files.cpp)], { stdio: 'pipe', timeout: 120000 });
      console.log('✓ compilation C++ réussie (' + compiler + ')');
    } catch (err) {
      failures++;
      const detail = String((err.stderr && err.stderr.toString()) || err.message || '');
      console.log('✕ compilation C++ impossible (' + compiler + ')');
      console.log(detail.split('\n').filter(Boolean).slice(0, 12).map(function (l) { return '  ' + l; }).join('\n'));
    }
  } else {
    console.log('Compilateur C++ absent : définissez BP_CXX pour compiler (C++17 requis).');
  }

  if (process.env.BP_KEEP) console.log('Fichiers conservés : ' + tmpDir);
  else fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(failures ? 'COUVERTURE : FAIL (' + failures + ')' : 'COUVERTURE : OK');
  process.exit(failures ? 1 : 0);
}


module.exports = { graph: graph };

/* Exécuté directement : les contrôles ; chargé par un autre outil (benchmark,
   vérification Unity) : seul le graphe est construit. */
if (require.main === module) main();
