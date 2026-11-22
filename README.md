# Blueprint Studio

Application de bureau Windows pour **programmer avec des nœuds** : vous assemblez un
graphique (comme un blueprint de jeu vidéo) et l'application génère en temps réel le code
équivalent en **Python**, **C#**, **C++** ou **C# pour Unity 6**.

## Installation (utilisateurs Windows)

### Version native (recommandée)

Deux fichiers, aucun prérequis (ni Node.js, ni droits administrateur) :

* **`Blueprint Studio (Rust) Setup.exe`** — installateur de **1,1 Mo** : installation pour
  l'utilisateur courant, raccourcis Bureau et menu Démarrer, désinstallation propre depuis
  « Applications et fonctionnalités », interface en français. Il installe WebView2 au
  passage s'il manque ;
* **`Blueprint Studio (Rust).exe`** — version portable de **3,0 Mo** : rien à installer,
  copiez le fichier où vous voulez et double-cliquez.

Les deux démarrent en moins de 0,2 s une fois en cache et n'occupent qu'environ **26 Mo de
mémoire**, dans un seul processus. Le seul composant requis est **WebView2**, présent
d'origine sur Windows 11 et sur Windows 10 à jour ; s'il manque malgré tout, l'application
affiche désormais un message Windows explicite au lieu d'échouer en silence.

Les exécutables ne sont pas signés : au premier lancement, Windows SmartScreen peut afficher
« Windows a protégé votre PC ». Cliquez sur **Informations complémentaires** puis
**Exécuter quand même**. La signature de code s'ajoute avec un certificat (voir
« Diffuser l'application »).

## Lancer depuis les sources (développement)

Prérequis : Windows 10/11, [Rust](https://rustup.rs) stable (chaîne
`x86_64-pc-windows-msvc`, qui utilise le linker intégré) et WebView2. Node.js n'est utile que
pour les outils de vérification et le bundler (`npm install` une fois).

1. **Double-clic sur `Lancer.bat`** — ouvre l'exécutable déjà compilé, sinon compile et lance
   l'application avec `cargo run --release`.
2. Ou en ligne de commande :

   ```bat
   npm install            :: une fois (outils + CLI Tauri)
   npm start              :: lance l'application (cargo run)
   npm run build          :: compile en release
   npm run installer      :: produit l'installateur NSIS
   npm run dist           :: compile en release et copie les artefacts dans dist/
   npm test               :: exemples + couverture 67 nœuds + tests unitaires Rust
   npm run smoke          :: test d'interface dans la vraie fenêtre WebView2
   ```

## Architecture

Un **noyau natif en Rust** : WebView2 (le moteur Edge déjà présent dans Windows) affiche
l'interface, Rust gère les fichiers, les menus, l'état de la fenêtre et le brouillon de
secours. Aucun runtime Node.js ni Chromium embarqué n'est livré.

| | Ancienne version (Electron) | Version actuelle (Rust + Tauri) |
| --- | --- | --- |
| Exécutable | 84 Mo (installateur) / 308 Mo décompressé | **3,0 Mo** |
| Mémoire au repos | ~315 Mo, 4 processus | **~26 Mo, 1 processus** |
| Ouverture de la fenêtre | 0,67 s (4,6 s au premier lancement) | **0,15 s (0,34 s au premier lancement)** |
| Installeur | 84 Mo | **1,1 Mo** |
| Interface | Chromium embarqué | WebView2 du système |
|
Mesures réalisées sur la même machine, trois lancements chacun, fenêtre affichée puis
mémoire relevée après 3 s (voir « Vérifications »).

Ce qui change pour l'utilisateur :

* **une seule fenêtre et un seul processus**, plus de préchargement Chromium ;
* les dialogues à plusieurs choix (« Enregistrer / Ne pas enregistrer / Annuler »,
  récupération du brouillon) sont dessinés dans la page, avec des libellés français et le
  thème sombre de l'application ;
* les menus, raccourcis, fichiers récents, l'instance unique et l'ouverture par
  double-clic ou depuis l'explorateur fonctionnent à l'identique ;
* l'état (taille, position, maximisé) et le brouillon de secours sont conservés dans
  `%APPDATA%\com.blueprintstudio.app`.

Le pont `app/js/desktop-bridge.js` expose l'API `window.desktop` (fichiers, dialogues,
titre, fermeture, événements). `app.js` ne dépend que de cette API : sans le pont (page
ouverte dans un navigateur), l'interface fonctionne en aperçu, sans accès aux fichiers.

## Utilisation

| Action | Comment |
| --- | --- |
| Ajouter un nœud | Clic sur un élément de la palette de gauche, ou glisser-déposer sur le canvas |
| Relier deux nœuds | Glisser depuis une broche de sortie (à droite) vers une broche d'entrée (à gauche) |
| Déplacer la vue | Glisser le fond du canvas |
| Zoom | Molette de la souris |
| Déplacer un nœud | Glisser son en-tête |
| Supprimer | Sélectionner puis `Suppr` (les nœuds « Début » sont protégés) |
| Changer de langage | Onglets `Python` / `C#` / `C++` / `Unity` à droite |
| Copier / exporter | Boutons `Copier` et `Exporter` au-dessus du code généré |
| Rouvrir un fichier | Menu `Fichier → Ouvrir récemment` (dix derniers graphiques) |
| Ouvrir par double-clic | Clic droit sur un `.blueprint.json` → `Ouvrir avec` → `Blueprint Studio` |
| Aide | Menu `Aide → Guide de démarrage` et `Raccourcis clavier` |

La taille et la position de la fenêtre sont mémorisées d'une session à l'autre. Un point
séparateur **•** après le nom du fichier signale des modifications non enregistrées ;
la fermeture propose de les enregistrer.

Le graphique en cours est aussi **sauvegardé automatiquement** (5 secondes après la dernière
modification) dans le dossier de données de l'application. Si celle-ci se ferme de façon
inattendue, l'ouverture suivante propose de récupérer ce travail ; le brouillon est effacé
dès qu'il est enregistré, ignoré, ou après 7 jours.

Le code se met à jour à chaque modification ; les erreurs et avertissements apparaissent
sous le code et dans la barre d'état (cliquez sur un message pour centrer le nœud concerné).

### Types de broches

* **losange clair** : flux d'exécution (l'ordre des instructions) ;
* **rond vert** : nombre, **orange** : texte, **rouge** : booléen, **gris** : valeur libre.

Une sortie d'exécution ne peut alimenter qu'une seule entrée ; une valeur ne peut alimenter
qu'une seule entrée à la fois (la nouvelle liaison remplace l'ancienne).

## Nœuds disponibles

**67 nœuds** répartis en 14 catégories (recherche par nom dans la palette).

| Catégorie | Nœuds |
| --- | --- |
| Événements (1) | Début |
| Actions (3) | Afficher · Afficher sans retour · Attendre |
| Variables (4) | Déclarer variable · Définir variable · Lire variable · Modifier variable (`+ - * /`) |
| Valeurs (4) | Nombre · Texte · Booléen · Nombre aléatoire |
| Maths (8) | Opération (`+ - * / %`) · Puissance · Racine carrée · Valeur absolue · Arrondi · Arrondi décimal · Minimum / maximum · Pi |
| Texte (8) | Concaténer · Longueur texte · Majuscules / minuscules · Remplacer dans texte · Texte contient · Sous-chaîne · Découper texte · Joindre tableau |
| Conversions (3) | En entier · En décimal · En texte |
| Tableaux (14) | Déclarer tableau · Créer tableau · Longueur tableau · Élément du tableau · Ajouter au tableau · Définir élément · Insérer dans tableau · Supprimer élément · Tableau contient · Indice d’un élément · Trier tableau · Inverser tableau · Vider tableau · Somme du tableau |
| Logique (4) | Comparaison (`== != < > <= >=`) · Et / Ou · Non · Si / Sinon |
| Boucles (5) | Boucle Pour · Boucle Tant que · Arrêter la boucle · Continuer la boucle · Boucle Pour chaque |
| Fonctions (4) | Définir fonction · Appeler fonction · Retourner · Appeler (instruction) |
| Entrées / sorties (7) | Saisie texte · Saisie nombre · Lire fichier · Écrire fichier · Ajouter au fichier · Fichier existe ? · Supprimer fichier |
| Temps (1) | Date et heure |
| Divers (1) | Commentaire |

Les paramètres de fonction s'écrivent `a: int, b: string` ; les arguments d'un appel
s'écrivent `a, b`.

### Tableaux

Un tableau est une variable à part entière : « Déclarer tableau » crée une variable vide d'un
type d'élément (`int`, `double`, `string`, `bool`), puis « Définir variable » et « Ajouter au
tableau » la remplissent. Le type des éléments d'un tableau littéral est déduit du contenu :
`1, 2, 3` → `int`, `1.5, 2` → `double`, `true, false` → `bool`, sinon `string`. Le code généré
utilise des types natifs : `list` (Python), `List<T>` (C#), `vector<T>` (C++).

Les nœuds qui modifient un tableau sur place (ajouter, trier, vider…) ont besoin de la
variable : reliez « Lire variable » à leur broche tableau, sinon la modification est perdue
(le générateur vous en avertit).

Les nœuds « Saisie », « fichiers », « texte » et « tableaux » n’ajoutent pas de dépendance
externe : ils génèrent de petites fonctions d’aide (`bp_lire_fichier`, `BpSousTexte`,
`bp_decouper`, …) seulement si le nœud correspondant est utilisé, si bien que le code produit
reste autonome et compilable tel quel.

### Qualité du code généré

**Python** — programme principal dans `def main():` protégé par
`if __name__ == "__main__":` (le fichier peut donc être importé sans rien exécuter), **annotations
de type** quand le type est connu (`def est_pair(n: int) -> bool:`), imports ajoutés à la
demande (`math`, `random`, `time`, `os`, `datetime`), sortie forcée en **UTF-8** (accents
corrects dans le terminal comme dans un fichier redirigé).

**C#** — `using` ajoutés à la demande (`Collections.Generic`, `IO`, `Linq`, `Threading`), culture
**invariante** en tête de `Main` (décimaux avec un point, `3.5`), helpers `static` générés
uniquement si nécessaire.

**C++** — `#include` ajoutés à la demande (aucun en-tête inutile), helpers `inline`/`template`
seulement si le nœud correspondant est utilisé, **UTF-8 respecté** : longueur, sous-chaîne et
majuscules/minuscules comptent les caractères, pas les octets (`café` → 4, `é` → `É`).
Booléens affichés `True`/`False`, décimaux dans leur représentation la plus courte, tableaux
affichés `[1, 2, 3]` : la sortie C++ est **identique à celle du C#** (hors valeurs aléatoires
et date).

Les nœuds « Saisie » et « fichiers » ajoutent automatiquement une petite fonction d’aide au
fichier généré (`bp_lire_fichier`, `BpLireNombre`, …) : le code produit reste autonome.

## Cible Unity (Unity 6)

L'onglet **Unity** génère un script C# directement utilisable dans Unity 6 :

* classe `MonoBehaviour` nommée d'après le graphique (`Somme 1..5` → `Somme15`), point
  d'entrée `void Start()` : **aucun `Main`**, aucun code de programme console ;
* **C# 9 / .NET Standard 2.1** uniquement (le niveau de langage de Unity 6) : pas de
  fonctionnalité C# 10+, pas d'API hors .NET Standard 2.1 ;
* `Debug.Log` au lieu de `Console.WriteLine` (les messages arrivent dans la Console de
  l'éditeur et dans les journaux du jeu) ;
* les nœuds « Saisie texte » et « Saisie nombre » deviennent des champs
  `[SerializeField]` avec `[Tooltip]` : la valeur se règle **dans l'Inspector**, sans code ;
* les chemins relatifs des nœuds de fichiers partent de `Application.persistentDataPath` ;
* `Random`/`Thread` sont qualifiés (`System.Random`) pour éviter l'ambiguïté avec
  `UnityEngine.Random`.

Le nom de fichier proposé à l'export est celui de la classe : Unity exige qu'ils soient
identiques (`Somme15.cs`). L'export s'appelle donc directement `Somme15.cs`.

Limites assumées en Unity : « Attendre » utilise `Thread.Sleep` (bloque le fil principal :
préférez une coroutine écrite à la main), « Afficher sans retour » s'affiche quand même sur
une ligne, et les fichiers ne fonctionnent pas sur la cible WebGL.

`npm run unity` vérifie cette cible pour de vrai : les quatre exemples et le graphe de
couverture complet sont générés puis **compilés avec C# 9 et `netstandard2.1`** contre des
classes `UnityEngine` minimales (`MonoBehaviour`, `Debug`, `Application`, `SerializeField`,
`Tooltip`, `Header`). Sur cette machine : compilation réussie, sans erreur.

## Exemples fournis

Menu **Exemples** ou liste « Exemples… » dans la barre d'outils :

* **Bonjour** — affichage d'un texte ;
* **Somme 1..5** — variable, boucle, calcul (affiche `10`) ;
* **Fonction et condition** — fonction `est_pair`, comparaison, Si/Sinon ;
* **Somme d'un tableau** — tableau littéral et boucle Pour chaque (affiche `43`).

Ils sont aussi disponibles en fichiers dans `examples/*.blueprint.json`.

## Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl+N` / `Ctrl+O` | Nouveau / ouvrir un graphique |
| `Ctrl+S` / `Ctrl+Maj+S` | Enregistrer / enregistrer sous |
| `Ctrl+E` | Exporter le code généré |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / rétablir |
| `Ctrl+A` | Tout sélectionner |
| `Suppr` | Supprimer la sélection |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom / ajuster la vue |

## Format des fichiers

Les graphiques sont enregistrés en JSON (`*.blueprint.json`) :

```json
{
  "format": "blueprint-studio",
  "version": 1,
  "name": "Bonjour",
  "nodes": [{ "id": "start", "type": "event_start", "x": 80, "y": 80, "props": {} }],
  "wires": [{ "id": "w1", "from": { "node": "start", "pin": "out" },
                        "to": { "node": "afficher", "pin": "in" } }]
}
```

## Structure du projet

```
src-tauri/                 noyau natif Rust (Tauri) : fenêtre, menus, fichiers, brouillon,
                           état de la fenêtre, instance unique + tests unitaires
app/index.html             interface
app/styles.css             thème sombre
build/                     icône de l'application (icon.png, icon.ico)
app/js/nodes.js            catalogue des nœuds et de leurs broches
app/js/graph.js            modèle de graphe, validation, sérialisation
app/js/codegen.js          générateurs Python / C# / C++
app/js/view.js             canvas : nœuds, câbles, zoom, glisser-déposer, undo
app/js/app.js              palette, onglets, fichiers, raccourcis, brouillon
app/js/desktop-bridge.js   pont window.desktop → noyau Rust (IPC Tauri)
examples/                  graphiques d'exemple (livrés avec l'application)
tools/                     vérifications (exemples, couverture 67 nœuds, cible Unity,
                           interface WebView2), génération des exemples, de l'icône et
                           copie des artefacts
.toolchain/                compilateur C++ portable local (facultatif, ignoré par git)
```

## Vérifications

```bat
npm test                     :: exemples + couverture 67 nœuds + tests unitaires Rust
node tools/check.js --code   :: affiche le code généré
npm run unity                :: génère puis compile la cible Unity (C# 9, netstandard2.1)
npm run smoke                :: test d'interface dans la vraie fenêtre WebView2

set BP_CXX=C:\msys64\mingw64\bin\g++.exe   :: pour compiler le C++ pendant les tests
```

Le noyau Rust est couvert par six tests unitaires (`npm run test:rust`) : écriture/lecture/
effacement atomique du brouillon, brouillon de plus de sept jours ignoré et supprimé,
assainissement des noms de fichiers, sélection du fichier passé en argument, conservation
des seuls fichiers récents existants et équivalence des chemins `D:/x` / `D:\x`.

`npm run smoke` lance l'exécutable avec `BP_SMOKE=1` : après chargement de la page, un
script en lecture seule relève la palette, le nombre de nœuds et de liaisons, le titre, puis
bascule sur les trois onglets et mesure le code généré — preuve que l'interface, le pont
Rust↔JS et les trois générateurs fonctionnent dans WebView2. Le résultat observé :
18 nœuds / 16 liaisons, aucun problème, Python 464 caractères, C# 631, C++ 939, et le
graphique passé en argument bien chargé au démarrage.

Résultats obtenus sur cette machine : génération sans erreur des quatre exemples dans les
trois langages, code Python **exécuté** (`10`, `C'est impair`, `43`), code C# **compilé et
exécuté** avec le SDK .NET, test d'interface réussi (câblage, déplacement, annulation,
suppression, rendu des 67 nœuds et de toutes leurs broches).

`npm run coverage` construit un graphe de **215 nœuds couvrant les 67 types**, génère les trois
langages et, si `BP_CXX` (ou `g++`/`clang++` dans le `PATH`) est disponible, **compile le C++**
avec `-std=c++17 -Wall -Wextra`. Sur cette machine (GCC 16, w64devkit) : 0 erreur de
génération, compilation **sans le moindre avertissement**, et exécution comparée des trois
programmes — **C# et C++ produisent exactement la même sortie** (hors nombre aléatoire et
date). Python s'exécute aussi, avec trois écarts de langage documentés ci-dessous.

Les quatre exemples sont également compilés et exécutés en C++ (`Bonjour`, `10`,
`C'est impair`, `43`), avec les mêmes sorties qu'en Python.

Côté livraison : `npm run installer` construit le bundle NSIS (1,1 Mo, français, installation
par utilisateur, désinstallation, WebView2 pris en charge) et `npm run dist` copie les deux
artefacts dans `dist/`. L'exécutable porte les métadonnées Windows attendues
(Description, Produit, Version 1.0.0, Société) visibles dans ses propriétés, et il démarre en
0,06 à 0,22 s dans un seul processus de 26 Mo. Les installateurs, eux, n'ont pas été exécutés
pour ne pas modifier cette machine.

## Diffuser l'application```bat
npm install            :: une fois (CLI Tauri)
npm run icon           :: régénère build/icon.ico et src-tauri/icons/icon.ico
npm run installer      :: installateur NSIS, dans src-tauri/target/release/bundle/nsis/
npm run dist           :: recopie l'exe et l'installateur dans dist/
```

Artefacts produits :

* `dist/Blueprint Studio (Rust) Setup.exe` — installateur NSIS : installation par
  utilisateur (aucun droit administrateur), raccourcis Bureau et menu Démarrer,
  désinstalleur, interface française, WebView2 installé s'il manque ;
* `dist/Blueprint Studio (Rust).exe` — version portable, un seul fichier.

L'icône (exe, barre des tâches et installateur) vient de `src-tauri/icons/icon.ico`, généré
par `tools/make-icon.js` sans dépendance graphique. Les quatre exemples sont **embarqués dans
l'exécutable** (`include_str!`) et recopiés au premier lancement dans
`%APPDATA%\com.blueprintstudio.app\exemples`, où le menu `Exemples → Ouvrir le dossier des
exemples` les retrouve une fois installé.

Pour signer les exécutables et supprimer l'avertissement SmartScreen, renseignez
`bundle.windows.certificateThumbprint` (et éventuellement `timestampUrl`) dans
`src-tauri/tauri.conf.json` avec un certificat présent dans le magasin Windows, puis
relancez `npm run installer`.

## Licence

Le logiciel est **propriétaire, tous droits réservés** : voir `LICENSE`. Le code source généré
à partir de vos graphiques vous appartient et peut être utilisé librement, y compris
commercialement. Remplacer ce fichier par une autre licence (MIT, commerciale…) est une simple
décision à prendre avant publication.

## Limites connues

* Le catalogue couvre le cœur d'un langage (flux, variables, textes, maths, tableaux, boucles,
  fonctions, console, fichiers, temps). Il ne génère pas de **classes / objets**, de réseau,
  de threads, ni d'interface graphique : ces domaines demandent des structures que des nœuds
  reliés par câbles décrivent mal.
* Les types en C# et C++ sont **explicites** : utilisez le nœud « Déclarer variable » (ou
  « Déclarer tableau ») avant d'affecter une variable (le générateur ne devine pas les types).
* `/` produit une division entière quand les deux valeurs sont entières en C# et C++
  (`1 / 3` → `0`), mais toujours flottante en Python : c'est la sémantique des langages, pas
  un défaut du générateur. Utilisez un décimal (`1.0`) pour une division réelle.
* « Saisie nombre » renvoie un décimal : affiché `42.0` en Python, `42` en C# et en C++.
* Un texte de tableau s'affiche `['a', 'b']` en Python (affichage natif des listes) et
  `[a, b]` en C#/C++.
* Le C# généré force la culture invariante : les décimaux s'affichent avec un point (`3.5`),
  identiques à Python, et non avec la virgule du système.
* Les chemins de fichiers sont relatifs au dossier d'exécution du programme généré.
* L'application génère le code mais ne l'exécute pas.
* Les exécutables ne sont pas signés (avertissement SmartScreen au premier lancement) et
  l'application ne se met pas à jour toute seule : une nouvelle version s'installe par-dessus
  l'ancienne depuis l'installateur.
* Le C++ généré demande **C++17** (représentation des décimaux via `<charconv>`). Il n'utilise
  que la bibliothèque standard : `g++ -std=c++17`, `clang++ -std=c++17`, ou Visual Studio avec
  `/std:c++17 /utf-8` (l'option `/utf-8` est nécessaire pour les accents avec MSVC).
* Le C++ n'a pas été testé avec MSVC (seul GCC l'a compilé ici) ; le code reste du C++17
  standard. Les accès aux tableaux passent par `.at()` : un indice hors limites lève
  `std::out_of_range` au lieu de provoquer un comportement indéfini.
* La cible Unity ne gère pas les entrées console (remplacées par des champs Inspector), les
  coroutines et la cible WebGL (pas de fichiers).
