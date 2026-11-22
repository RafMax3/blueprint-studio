/* Vérifie la cible Unity : génère le code des exemples et du graphe de couverture,
   puis le compile avec les contraintes de Unity 6 (C# 9, .NET Standard 2.1) contre
   des classes UnityEngine minimales (MonoBehaviour, Debug, Application).
   Usage : node tools/unity-check.js   (ignoré si le SDK .NET est absent) */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const context = vm.createContext({ console: console });
['nodes', 'graph', 'codegen', 'examples'].forEach(function (name) {
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'app', 'js', name + '.js'), 'utf8'),
    context, { filename: name + '.js' });
});
const BP = context.BP;

function hasDotnet() {
  try {
    const probe = spawnSync('dotnet', ['--version'], { stdio: 'ignore', timeout: 30000 });
    return probe.status === 0;
  } catch (err) {
    return false;
  }
}

if (!hasDotnet()) {
  console.log('Unity : vérification ignorée (SDK .NET introuvable).');
  process.exit(0);
}

/* ------------------------------------------------ code Unity à vérifier */

const scripts = [];
const problems = [];

function addScript(label, graph) {
  const result = BP.generateCode(graph, 'unity');
  result.problems.forEach(function (p) {
    problems.push(label + ' : ' + p.level + ' — ' + p.message);
  });
  scripts.push({
    label: label,
    name: result.suggestedName,
    code: result.code,
    errors: result.problems.filter(function (p) { return p.level === 'error'; }).length
  });
}

BP.EXAMPLES.forEach(function (example) {
  addScript(example.name, JSON.parse(JSON.stringify(example.graph)));
});

/* Le graphe de couverture exerce tous les nœuds et toutes les aides générées. */
const coverage = require('./coverage.js');
addScript('couverture', JSON.parse(JSON.stringify(coverage.graph)));

/* ------------------------------------------------------- projet de test */

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-unity-'));

const stubs = `// Classes UnityEngine minimales : elles n'existent pas hors d'Unity.
namespace UnityEngine
{
    public class Object { }

    public class Component : Object { }

    public class Behaviour : Component
    {
        public bool enabled { get; set; }
    }

    public class MonoBehaviour : Behaviour { }

    public static class Debug
    {
        public static void Log(object message) { }
        public static void LogWarning(object message) { }
        public static void LogError(object message) { }
    }

    [System.AttributeUsage(System.AttributeTargets.Field)]
    public sealed class SerializeField : System.Attribute { }

    [System.AttributeUsage(System.AttributeTargets.Field)]
    public sealed class TooltipAttribute : System.Attribute
    {
        public TooltipAttribute(string tooltip) { }
    }

    [System.AttributeUsage(System.AttributeTargets.Field)]
    public sealed class HeaderAttribute : System.Attribute
    {
        public HeaderAttribute(string header) { }
    }

    public static class Application
    {
        public static string persistentDataPath
        {
            get { return System.IO.Path.GetTempPath(); }
        }
    }
}
`;

const project = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netstandard2.1</TargetFramework>
    <LangVersion>9.0</LangVersion>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>BlueprintUnityCheck</AssemblyName>
    <RootNamespace>BlueprintUnityCheck</RootNamespace>
    <EnableDefaultCompileItems>true</EnableDefaultCompileItems>
  </PropertyGroup>
</Project>
`;

fs.writeFileSync(path.join(workDir, 'BlueprintUnityCheck.csproj'), project, 'utf8');
fs.writeFileSync(path.join(workDir, 'UnityStubs.cs'), stubs, 'utf8');

scripts.forEach(function (script) {
  // Unity exige un fichier par MonoBehaviour, nommé comme la classe.
  fs.writeFileSync(path.join(workDir, script.name + '.cs'), script.code, 'utf8');
});

/* ---------------------------------------------------------- compilation */

console.log('Fichiers Unity vérifiés : ' + scripts.map(function (s) {
  return s.name + '.cs (' + s.label + ')';
}).join(', '));

const build = spawnSync('dotnet', ['build', 'BlueprintUnityCheck.csproj', '--nologo', '-v', 'quiet',
  '-p:TreatWarningsAsErrors=false'], { cwd: workDir, encoding: 'utf8', timeout: 300000 });

const output = String(build.stdout || '') + String(build.stderr || '');
const errors = output.split(/\r?\n/).filter(function (line) {
  return /error [A-Z]{2}\d+/.test(line);
});
const warnings = output.split(/\r?\n/).filter(function (line) {
  return /warning [A-Z]{2}\d+/.test(line) && line.indexOf('UnityStubs') === -1;
});

if (build.status === 0 && !errors.length) {
  console.log('✓ compilation C# 9 / netstandard2.1 réussie (Unity 6)');
  if (warnings.length) {
    console.log(warnings.length + ' avertissement(s) :');
    warnings.slice(0, 8).forEach(function (line) { console.log('  ! ' + line.trim()); });
  }
} else {
  console.log('✕ compilation Unity impossible');
  (errors.length ? errors : output.split('\n')).slice(0, 15).forEach(function (line) {
    console.log('  ' + line.trim());
  });
}

if (process.env.BP_KEEP) console.log('Fichiers conservés : ' + workDir);
else fs.rmSync(workDir, { recursive: true, force: true });

if (problems.length) {
  console.log('Avertissements du générateur :');
  problems.slice(0, 6).forEach(function (message) { console.log('  ! ' + message); });
}

const failed = errors.length > 0 || build.status !== 0 ||
  scripts.some(function (s) { return s.errors > 0; });
console.log(failed ? 'UNITY : FAIL' : 'UNITY : OK');
process.exit(failed ? 1 : 0);
