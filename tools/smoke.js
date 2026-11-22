/* Test d'intégration de l'application (Tauri/WebView2) :
   lance l'exécutable avec BP_SMOKE=1, attend le rapport du script injecté dans
   WebView2, puis vérifie l'interface, le pont Rust↔JS et les trois générateurs.
   Le diagnostic écrit sur la sortie standard, donc il faut le binaire de
   développement (`cargo build`) : la version release n'ouvre pas de console. */
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'src-tauri', 'target', 'debug', 'blueprint-studio.exe');
const graph = path.join(root, 'examples', 'fonction.blueprint.json');

function ensureBuild() {
  if (fs.existsSync(exe)) return true;
  console.log('… compilation du binaire de développement');
  const build = spawnSync('cargo', ['build', '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml')], {
    stdio: 'inherit'
  });
  return build.status === 0 && fs.existsSync(exe);
}

function fail(message) {
  console.error('SMOKE : FAIL — ' + message);
  process.exit(1);
}

if (!ensureBuild()) fail('compilation impossible');

const child = spawn(exe, [graph], {
  env: Object.assign({}, process.env, { BP_SMOKE: '1' }),
  stdio: ['ignore', 'pipe', 'ignore']
});

let buffer = '';
let finished = false;

const timer = setTimeout(function () {
  finish('aucun rapport reçu en 30 s');
}, 30000);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  try { child.kill(); } catch (ignored) { /* déjà arrêté */ }
  if (error) fail(error);

  const line = buffer.split(/\r?\n/).filter(function (l) { return l.startsWith('SMOKE '); })[0];
  if (!line) fail('rapport absent');
  let report;
  try {
    report = JSON.parse(line.slice(6));
  } catch (err) {
    fail('rapport illisible : ' + err.message);
  }
  if (report.error) fail('erreur dans la page : ' + report.error);

  const checks = [
    ['pont Rust actif', report.desktop === true && report.engine === 'rust'],
    ['palette complète', report.palette >= 10],
    ['graphique chargé', /—\s*Blueprint Studio$/.test(report.title || '')],
    ['graphique passé en argument pris en compte', /Fonction et condition/.test(report.title || '')],
    ['aucun problème signalé', String(report.problems || '').indexOf('Aucun') === 0],
    ['code Python généré', (report.lengths || {}).Python > 100],
    ['code C# généré', (report.lengths || {})['C#'] > 100],
    ['code C++ généré', (report.lengths || {})['C++'] > 100],
    ['code Unity généré', (report.lengths || {}).Unity > 100]
  ];

  console.log(JSON.stringify({
    titre: report.title,
    noeuds: report.nodes,
    liaisons: report.wires,
    problemes: report.problems,
    longueurs: report.lengths,
    controles: checks.length,
    echoues: checks.filter(function (c) { return !c[1]; }).map(function (c) { return c[0]; })
  }, null, 2));

  const failed = checks.filter(function (c) { return !c[1]; });
  if (failed.length) fail(failed.map(function (c) { return c[0]; }).join(', '));
  console.log('SMOKE : OK');
}

child.stdout.on('data', function (chunk) {
  buffer += chunk.toString('utf8');
  if (buffer.indexOf('SMOKE {') !== -1) finish(null);
});

child.on('error', function (err) { finish('lancement impossible : ' + err.message); });
child.on('exit', function () {
  if (!finished) finish('processus terminé sans rapport');
});
