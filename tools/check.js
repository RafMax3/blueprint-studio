/* Vérifie les exemples : structure du graphe + génération dans les 3 langages.
   Usage : node tools/check.js [--code] */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const context = vm.createContext({ console: console });
['nodes', 'graph', 'codegen', 'examples'].forEach((name) => {
  const file = path.join(rootDir, 'app', 'js', name + '.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: name + '.js' });
});

const BP = context.BP;
const showCode = process.argv.indexOf('--code') !== -1;
let errors = 0;
let warnings = 0;

/* Compilateur C++ optionnel : BP_CXX, sinon g++ / clang++ / c++ du PATH. */
function findCompiler() {
  const candidates = [process.env.BP_CXX, 'g++', 'clang++', 'c++']
    .filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    try {
      execFileSync(candidates[i], ['--version'], { stdio: 'ignore' });
      return candidates[i];
    } catch (err) {
      /* essayons le suivant */
    }
  }
  return null;
}

const compiler = findCompiler();
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-check-'));

function compileCpp(code, name) {
  const source = path.join(workDir, name + '.cpp');
  const binary = path.join(workDir, name + (process.platform === 'win32' ? '.exe' : ''));
  fs.writeFileSync(source, code, 'utf8');
  try {
    execFileSync(compiler, ['-std=c++17', '-Wall', '-Wextra', '-o', binary, source],
      { stdio: 'pipe', timeout: 60000 });
    return null;
  } catch (err) {
    const detail = String((err.stderr && err.stderr.toString()) || err.message || '')
      .split('\n').filter(Boolean).slice(0, 6).join('\n');
    return detail;
  }
}

function pinExists(graph, ref, dir) {
  const node = BP.model.nodeById(graph, ref.node);
  if (!node) return false;
  return !!BP.pinInfo(node, ref.pin, dir);
}

BP.EXAMPLES.forEach((example) => {
  const graph = JSON.parse(JSON.stringify(example.graph));
  console.log('\n=== ' + example.name + ' (' + example.id + ') ===');

  graph.wires.forEach((wire) => {
    if (!pinExists(graph, wire.from, 'out')) {
      console.log('  ✕ liaison ' + wire.id + ' : sortie inconnue ' + wire.from.node + '.' + wire.from.pin);
      errors++;
    }
    if (!pinExists(graph, wire.to, 'in')) {
      console.log('  ✕ liaison ' + wire.id + ' : entrée inconnue ' + wire.to.node + '.' + wire.to.pin);
      errors++;
    }
  });

  BP.LANGS.forEach((lang) => {
    const result = BP.generateCode(graph, lang.id);
    const localErrors = result.problems.filter((p) => p.level === 'error');
    localErrors.forEach((p) => { errors++; });
    result.problems.filter((p) => p.level === 'warning').forEach(() => { warnings++; });

    console.log('  ' + lang.label + ' : ' + result.code.split('\n').length + ' lignes, ' +
      localErrors.length + ' erreur(s), ' +
      result.problems.filter((p) => p.level === 'warning').length + ' avertissement(s)');
    result.problems.forEach((p) => console.log('    ! ' + p.message));
    if (showCode) {
      console.log('  ----------------------------------------');
      console.log(result.code.split('\n').map((l) => '  | ' + l).join('\n'));
      console.log('  ----------------------------------------');
    }
    if (lang.id === 'cpp' && compiler && !localErrors.length) {
      const failure = compileCpp(result.code, 'exemple-' + example.id);
      if (failure) {
        errors++;
        console.log('  ✕ compilation C++ impossible (' + compiler + ')');
        console.log(failure.split('\n').map((l) => '    ' + l).join('\n'));
      } else {
        console.log('  ✓ compilation C++ réussie (' + compiler + ')');
      }
    }
  });
});

fs.rmSync(workDir, { recursive: true, force: true });
if (compiler) console.log('\nCompilateur C++ : ' + compiler);
else console.log('\nCompilateur C++ : absent (définissez BP_CXX pour compiler les exemples)');

console.log('\nRésultat : ' + errors + ' erreur(s), ' + warnings + ' avertissement(s)');
process.exit(errors ? 1 : 0);
