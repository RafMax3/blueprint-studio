# Utiliser un script généré dans Unity 6

Guide pas à pas pour passer d'un graphique Blueprint Studio à un script qui tourne
dans Unity 6 (6000.x). Durée : deux minutes.

## 1. Créer (ou ouvrir) un projet Unity 6

1. Ouvrez **Unity Hub → New project**.
2. Choisissez le modèle **Universal 2D** (ou 3D, peu importe) et la version **Unity 6**.
3. Nommez le projet, puis **Create project**.

Le projet s'ouvre sur une scène vide (`SampleScene`).

## 2. Exporter depuis Blueprint Studio

1. Dans Blueprint Studio, construisez le graphique (ou ouvrez **Exemples → Dictionnaire**).
2. Cliquez sur l'onglet **Unity** à droite : le code affiché est déjà en C# 9 /
   .NET Standard 2.1, compatible Unity 6.
3. Cliquez sur **Exporter**.

Le nom proposé est celui de la classe (`Dictionnaire.cs`, `Somme15.cs`…) : **c'est
obligatoire**, Unity associe un `MonoBehaviour` au fichier qui porte son nom.

## 3. Copier le fichier dans le projet

Enregistrez (ou copiez) le `.cs` dans le dossier `Assets/` du projet Unity — par exemple
`Assets/Scripts/`. Créez `Assets/Scripts` s'il n'existe pas.

Revenez dans Unity : le script est importé automatiquement (pas de redémarrage).

> Si Unity affiche « The class defined in script file named X does not match the file
> name », c'est que le fichier a été renommé : gardez le nom proposé à l'export.

## 4. Attacher le script à un objet

1. Dans la fenêtre **Hierarchy**, clic droit → **Create Empty** (ou sélectionnez la
   `Main Camera`).
2. Glissez le script depuis la fenêtre **Project** sur cet objet, ou utilisez
   **Add Component → Scripts → \<Nom du script\>**.

Le composant apparaît dans l'**Inspector**.

## 5. Régler les entrées (si le graphique en contient)

Les nœuds « Saisie texte » et « Saisie nombre » deviennent des champs
**« Entrées du blueprint »** dans l'Inspector, avec le texte d'invite en infobulle :

* champ `string` pour une saisie texte ;
* champ `float` pour une saisie nombre (Unity ne sérialise pas `double`) ;
* laissez la valeur par défaut ou tapez la vôtre, puis **Play**.

## 6. Lancer et lire la sortie

1. Appuyez sur **Play**.
2. Ouvrez **Window → General → Console** : chaque nœud « Afficher » y écrit une ligne
   (`Debug.Log`).

Exemple avec l'exemple **Dictionnaire** :

```
2
36
True
```

## Ce que le script généré fait (et ne fait pas)

* point d'entrée `void Start()` (ou coroutine `BpExecuter()` quand le graphique contient
  « Attendre ») : rien à appeler à la main ;
* `Debug.Log` pour les affichages ;
* chemins relatifs des nœuds fichiers résolus dans `Application.persistentDataPath` ;
* pas de `Main`, pas de `Console`, aucune API hors .NET Standard 2.1 ;
* pas de `Update()` : un graphique s'exécute une fois au démarrage. Pour du temps réel,
  dupliquez le script ou appelez `StartCoroutine(BpExecuter())` depuis votre propre
  `Update()`.

## Dépannage

| Symptôme | Cause | Solution |
| --- | --- | --- |
| `error CS0246: MonoBehaviour introuvable` | le fichier est hors de `Assets/` | déplacez-le dans `Assets/` |
| Le composant n'apparaît pas dans **Add Component** | erreur de compilation dans la Console | corrigez l'erreur affichée (message en français dans Blueprint Studio) |
| « The class defined in script file… » | fichier renommé | renommez le fichier comme la classe |
| Rien ne s'affiche dans la Console | script non attaché, ou **Play** non lancé | vérifiez l'Inspector et l'état **Play** |
| Les fichiers ne s'écrivent pas | cible WebGL | les fichiers ne sont pas disponibles en WebGL |
| `NullReferenceException` sur un champ | champ Inspector non renseigné | renseignez les « Entrées du blueprint » |

## Vérifier sans Unity

`npm run unity` génère les exemples et le graphe de couverture, puis les compile avec
`LangVersion 9.0` et `netstandard2.1` contre des classes `UnityEngine` minimales : cela
détecte les erreurs de langage et d'API avant même d'ouvrir Unity.
