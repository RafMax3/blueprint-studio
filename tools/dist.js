/* Copie les artefacts compilés dans dist/ avec des noms lisibles :
   l'exécutable portable et, s'il a été généré, l'installateur NSIS.
   Usage : npm run dist (compile puis copie). */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const release = path.join(root, 'src-tauri', 'target', 'release');
const portable = path.join(release, 'blueprint-studio.exe');
const bundleDir = path.join(release, 'bundle', 'nsis');
const targetDir = path.join(root, 'dist');

if (!fs.existsSync(portable)) {
  console.error('Exécutable introuvable : ' + portable);
  console.error('Lancez « npm run build » avant.');
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

/* Un antivirus ou l'explorateur peut verrouiller la destination quelques
   instants après une compilation : on réessaie plutôt que d'échouer. */
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function copy(source, target) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.copyFileSync(source, target);
      return true;
    } catch (err) {
      if (attempt >= 6) {
        console.error('Copie impossible (' + path.basename(target) + ') : ' + err.message);
        return false;
      }
      try { fs.rmSync(target, { force: true }); } catch (ignored) { /* verrou passager */ }
      pause(400);
    }
  }
}

function report(file) {
  if (!fs.existsSync(file)) return;
  const size = fs.statSync(file).size;
  console.log('✓ ' + path.relative(root, file) + ' — ' + (size / 1048576).toFixed(1) + ' Mo');
}

const artifacts = [[portable, path.join(targetDir, 'Blueprint Studio (Rust).exe')]];

if (fs.existsSync(bundleDir)) {
  const installer = fs.readdirSync(bundleDir).filter(function (name) {
    return /setup\.exe$/i.test(name);
  })[0];
  if (installer) {
    artifacts.push([path.join(bundleDir, installer), path.join(targetDir, 'Blueprint Studio (Rust) Setup.exe')]);
  }
}

let ok = true;
artifacts.forEach(function (pair) {
  if (!copy(pair[0], pair[1])) ok = false;
  report(pair[1]);
});

if (artifacts.length === 1) {
  console.log('  (installateur absent : lancez « npm run installer » pour le produire)');
}

process.exit(ok ? 0 : 1);
