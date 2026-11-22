/* Écrit les exemples (source : app/js/examples.js) dans examples/*.blueprint.json */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const context = vm.createContext({ console: console });
['nodes', 'graph', 'codegen', 'examples'].forEach((name) => {
  const file = path.join(rootDir, 'app', 'js', name + '.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: name + '.js' });
});

const BP = context.BP;
const outDir = path.join(rootDir, 'examples');
fs.mkdirSync(outDir, { recursive: true });

BP.EXAMPLES.forEach((example) => {
  const graph = BP.model.parse(JSON.stringify(example.graph));
  const target = path.join(outDir, example.id + '.blueprint.json');
  fs.writeFileSync(target, BP.model.serialize(graph), 'utf8');
  console.log('écrit ' + path.relative(rootDir, target));
});
