/* Blueprint Studio — noyau natif (Rust + Tauri).
   WebView2 affiche l'interface ; Rust gère les fichiers, le brouillon de
   secours, les menus, l'état de la fenêtre et l'instance unique. */

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

const MAX_RECENT: usize = 10;
const DRAFT_FILE: &str = "brouillon.blueprint.json";
const DRAFT_MAX_AGE_MS: u128 = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WIDTH: f64 = 1500.0;
const DEFAULT_HEIGHT: f64 = 950.0;

/* --------------------------------------------------------------- état */

#[derive(Clone, Serialize, Deserialize, Default)]
struct WindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize, Deserialize, Default)]
struct Session {
    window: Option<WindowBounds>,
    #[serde(default)]
    maximized: bool,
    #[serde(default)]
    recent: Vec<String>,
}

struct AppState {
    session: Mutex<Session>,
    allow_close: AtomicBool,
    ready: AtomicBool,
    pending_open: Mutex<Option<String>>,
    data_dir: PathBuf,
    examples_dir: PathBuf,
}

fn lock_session(state: &AppState) -> std::sync::MutexGuard<'_, Session> {
    state.session.lock().unwrap_or_else(|err| err.into_inner())
}

fn state_file(dir: &Path) -> PathBuf {
    dir.join("state.json")
}

/* --------------------------------------------------- état persistant */

fn load_state(dir: &Path) -> Session {
    let raw = match fs::read_to_string(state_file(dir)) {
        Ok(text) => text,
        Err(_) => return Session::default(),
    };
    let mut session: Session = serde_json::from_str(&raw).unwrap_or_default();
    session.recent = session
        .recent
        .into_iter()
        .filter(|path| Path::new(path).exists())
        .take(MAX_RECENT)
        .collect();
    session
}

fn write_state(dir: &Path, session: &Session) {
    let Ok(json) = serde_json::to_string_pretty(session) else {
        return;
    };
    let _ = fs::create_dir_all(dir);
    let target = state_file(dir);
    let temporary = target.with_extension("json.tmp");
    if fs::write(&temporary, json).is_ok() {
        let _ = fs::rename(&temporary, &target);
    }
}

static SAVE_TICK: AtomicU64 = AtomicU64::new(0);

fn save_state(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut session = lock_session(&state);
    if let Some(window) = app.get_webview_window("main") {
        let minimized = window.is_minimized().unwrap_or(false);
        if !minimized {
            if let (Ok(position), Ok(size), Ok(scale)) = (
                window.outer_position(),
                window.inner_size(),
                window.scale_factor(),
            ) {
                let scale = if scale > 0.0 { scale } else { 1.0 };
                session.window = Some(WindowBounds {
                    x: (position.x as f64 / scale).round() as i32,
                    y: (position.y as f64 / scale).round() as i32,
                    width: (size.width as f64 / scale).round() as u32,
                    height: (size.height as f64 / scale).round() as u32,
                });
            }
        }
        session.maximized = window.is_maximized().unwrap_or(false);
    }
    write_state(&state.data_dir, &session);
}

/* Regroupe les rafales de redimensionnements : une seule écriture par 400 ms. */
fn schedule_save(app: &AppHandle) {
    let tick = SAVE_TICK.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        if SAVE_TICK.load(Ordering::SeqCst) == tick {
            save_state(&handle);
        }
    });
}

/* ------------------------------------------------------ fichiers récents */

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/* Chemins Windows homogènes : « D:/x » et « D:\x » désignent le même fichier. */
fn path_text(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\")
}

fn same_path(a: &str, b: &str) -> bool {
    a.replace('/', "\\").eq_ignore_ascii_case(&b.replace('/', "\\"))
}

fn rebuild_menu(app: &AppHandle) {
    if let Ok(menu) = build_menu(app) {
        let _ = app.set_menu(menu);
    }
}

fn remember_file(app: &AppHandle, path: &Path) {
    let text = path_text(path);
    {
        let state = app.state::<AppState>();
        let mut session = lock_session(&state);
        session.recent.retain(|other| !same_path(other, &text));
        session.recent.insert(0, text);
        session.recent.truncate(MAX_RECENT);
        write_state(&state.data_dir, &session);
    }
    rebuild_menu(app);
}

fn forget_missing(app: &AppHandle, path: &str) {
    {
        let state = app.state::<AppState>();
        let mut session = lock_session(&state);
        session.recent.retain(|other| !same_path(other, path));
        write_state(&state.data_dir, &session);
    }
    rebuild_menu(app);
}

/* ---------------------------------------------------------------- menu */

fn menu_item(app: &AppHandle, id: &str, label: &str, accelerator: Option<&str>) -> MenuItem<Wry> {
    let build = |with_accel: bool| {
        let mut builder = MenuItemBuilder::with_id(id, label);
        if with_accel {
            if let Some(accelerator) = accelerator {
                builder = builder.accelerator(accelerator);
            }
        }
        builder.build(app)
    };
    match build(true) {
        Ok(item) => item,
        Err(err) => {
            eprintln!("menu : accélérateur ignoré pour {id} ({err})");
            build(false).expect("élément de menu")
        }
    }
}

fn static_item(app: &AppHandle, id: &str, label: &str) -> MenuItem<Wry> {
    menu_item(app, id, label, None)
}

fn recent_submenu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let recent = {
        let state = app.state::<AppState>();
        let session = lock_session(&state);
        session.recent.clone()
    };
    let mut builder = SubmenuBuilder::new(app, "Ouvrir récemment");
    if recent.is_empty() {
        let empty = MenuItemBuilder::with_id("recent.none", "Aucun fichier récent")
            .enabled(false)
            .build(app)?;
        builder = builder.item(&empty);
    } else {
        for (index, path) in recent.iter().enumerate() {
            let item = MenuItemBuilder::with_id(
                format!("recent:{index}"),
                file_name_of(Path::new(path)),
            )
            .build(app)?;
            builder = builder.item(&item);
        }
        let clear = static_item(app, "recent.clear", "Vider la liste");
        builder = builder.separator().item(&clear);
    }
    builder.build()
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let nouveau = menu_item(app, "file.new", "Nouveau", Some("CmdOrCtrl+N"));
    let ouvrir = menu_item(app, "file.open", "Ouvrir…", Some("CmdOrCtrl+O"));
    let enregistrer = menu_item(app, "file.save", "Enregistrer", Some("CmdOrCtrl+S"));
    let enregistrer_sous = menu_item(
        app,
        "file.save-as",
        "Enregistrer sous…",
        Some("CmdOrCtrl+Shift+S"),
    );
    let exporter = menu_item(
        app,
        "file.export",
        "Exporter le code généré…",
        Some("CmdOrCtrl+E"),
    );
    let quitter = PredefinedMenuItem::quit(app, Some("Quitter"))?;
    let recent = recent_submenu(app)?;

    let fichier = SubmenuBuilder::new(app, "Fichier")
        .item(&nouveau)
        .item(&ouvrir)
        .item(&recent)
        .separator()
        .item(&enregistrer)
        .item(&enregistrer_sous)
        .separator()
        .item(&exporter)
        .separator()
        .item(&quitter)
        .build()?;

    let annuler = menu_item(app, "edit.undo", "Annuler", Some("CmdOrCtrl+Z"));
    let retablir = menu_item(app, "edit.redo", "Rétablir", Some("CmdOrCtrl+Y"));
    let supprimer = static_item(app, "edit.delete", "Supprimer la sélection");
    let tout = menu_item(app, "edit.select-all", "Tout sélectionner", Some("CmdOrCtrl+A"));

    let edition = SubmenuBuilder::new(app, "Édition")
        .item(&annuler)
        .item(&retablir)
        .separator()
        .item(&supprimer)
        .item(&tout)
        .build()?;

    let exemple_bonjour = static_item(app, "example:bonjour", "Bonjour");
    let exemple_boucle = static_item(app, "example:boucle", "Somme 1..5");
    let exemple_fonction = static_item(app, "example:fonction", "Fonction et condition");
    let exemple_tableau = static_item(app, "example:tableau", "Somme d'un tableau");
    let dossier_exemples = static_item(app, "examples.folder", "Ouvrir le dossier des exemples");

    let exemples = SubmenuBuilder::new(app, "Exemples")
        .item(&exemple_bonjour)
        .item(&exemple_boucle)
        .item(&exemple_fonction)
        .item(&exemple_tableau)
        .separator()
        .item(&dossier_exemples)
        .build()?;

    let zoom_avant = menu_item(app, "view.zoom-in", "Zoom avant", Some("CmdOrCtrl+Plus"));
    let zoom_arriere = menu_item(app, "view.zoom-out", "Zoom arrière", Some("CmdOrCtrl+Minus"));
    let ajuster = menu_item(app, "view.fit", "Ajuster la vue", Some("CmdOrCtrl+0"));

    let affichage = SubmenuBuilder::new(app, "Affichage")
        .item(&zoom_avant)
        .item(&zoom_arriere)
        .item(&ajuster)
        .build()?;

    let guide = static_item(app, "help.quickstart", "Guide de démarrage");
    let raccourcis = static_item(app, "help.shortcuts", "Raccourcis clavier");
    let propos = static_item(app, "help.about", "À propos de Blueprint Studio");

    let aide = SubmenuBuilder::new(app, "Aide")
        .item(&guide)
        .item(&raccourcis)
        .separator()
        .item(&propos)
        .build()?;

    MenuBuilder::new(app)
        .item(&fichier)
        .item(&edition)
        .item(&exemples)
        .item(&affichage)
        .item(&aide)
        .build()
}

/* ------------------------------------------------------------- dialogues */

fn show_info(app: &AppHandle, title: &str, message: impl Into<String>) {
    app.dialog()
        .message(message.into())
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

fn show_warning(app: &AppHandle, title: &str, message: impl Into<String>) {
    app.dialog()
        .message(message.into())
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

fn show_quickstart(app: &AppHandle) {
    show_info(
        app,
        "Guide de démarrage",
        "Créer votre premier programme en 4 étapes\n\n\
         1. Cliquez sur un nœud dans la palette de gauche (ou glissez-le sur le plan).\n\
         2. Partez toujours du nœud « Début » : glissez de sa broche de droite vers la\n\
            broche d'exécution (losange) du nœud suivant.\n\
         3. Reliez les valeurs rondes : « Nombre », « Texte »… vers les broches « valeur ».\n\
         4. Le code apparaît à droite : choisissez Python, C# ou C++ avec les onglets.\n\n\
         Un point • après le nom du fichier signale des modifications non enregistrées.\n\
         Menu Exemples : quatre graphiques complets à ouvrir.",
    );
}

fn show_shortcuts(app: &AppHandle) {
    show_info(
        app,
        "Raccourcis clavier",
        "Ctrl+N / Ctrl+O\t\tNouveau / Ouvrir\n\
         Ctrl+S / Ctrl+Maj+S\tEnregistrer / Enregistrer sous\n\
         Ctrl+E\t\t\tExporter le code généré\n\
         Ctrl+Z / Ctrl+Y\t\tAnnuler / Rétablir\n\
         Ctrl+A / Suppr\t\tTout sélectionner / Supprimer\n\
         Ctrl+= / Ctrl+- / Ctrl+0\tZoom avant / arrière / ajuster\n\
         Molette\t\t\tZoom du plan\n\
         Glisser le fond\t\tDéplacer la vue\n\
         Double-clic sur le fond\tRechercher un nœud",
    );
}

fn show_about(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    show_info(
        app,
        "À propos de Blueprint Studio",
        format!(
            "Blueprint Studio {version}\n\n\
             Éditeur de graphes de nœuds qui génère du code Python, C# et C++.\n\n\
             Glissez les nœuds depuis la palette, reliez les broches, puis lisez le code\n\
             généré à droite.\n\n\
             67 nœuds répartis en 14 catégories.\n\
             Noyau Rust + WebView2 (Tauri)\n\n\
             Licence propriétaire — voir le fichier LICENSE livré avec l'application."
        ),
    );
}

/* ------------------------------------------------------ exemples fournis */

const EXAMPLES: &[(&str, &str)] = &[
    (
        "bonjour.blueprint.json",
        include_str!("../../examples/bonjour.blueprint.json"),
    ),
    (
        "boucle.blueprint.json",
        include_str!("../../examples/boucle.blueprint.json"),
    ),
    (
        "fonction.blueprint.json",
        include_str!("../../examples/fonction.blueprint.json"),
    ),
    (
        "tableau.blueprint.json",
        include_str!("../../examples/tableau.blueprint.json"),
    ),
    (
        "dictionnaire.blueprint.json",
        include_str!("../../examples/dictionnaire.blueprint.json"),
    ),
];

fn open_examples_folder(app: &AppHandle) {
    let dir = app.state::<AppState>().examples_dir.clone();
    let _ = fs::create_dir_all(&dir);
    for (name, content) in EXAMPLES {
        let target = dir.join(name);
        if !target.exists() {
            let _ = fs::write(&target, content);
        }
    }
    let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
}

/* --------------------------------------------------- ouverture de fichier */

fn file_from_args(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.is_empty() && !arg.starts_with('-'))
        .filter(|arg| arg.to_ascii_lowercase().ends_with(".json"))
        .map(PathBuf::from)
        .find(|path| path.exists())
}

fn flush_open(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.ready.load(Ordering::SeqCst) {
        return;
    }
    let pending = state
        .pending_open
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .take();
    if let Some(path) = pending {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let _ = app.emit("app:open-path", path);
    }
}

fn request_open(app: &AppHandle, path: PathBuf) {
    if !path.exists() {
        forget_missing(app, &path_text(&path));
        show_warning(
            app,
            "Fichier introuvable",
            format!("Ce graphique n'existe plus.\n\n{}", path.display()),
        );
        return;
    }
    {
        let state = app.state::<AppState>();
        let mut pending = state
            .pending_open
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        *pending = Some(path_text(&path));
    }
    flush_open(app);
}

/* ---------------------------------------------------------- menu → JS */

fn on_menu_event(app: &AppHandle, id: &str) {
    let action = match id {
        "file.new" => "new",
        "file.open" => "open",
        "file.save" => "save",
        "file.save-as" => "save-as",
        "file.export" => "export",
        "edit.undo" => "undo",
        "edit.redo" => "redo",
        "edit.delete" => "delete",
        "edit.select-all" => "select-all",
        "view.zoom-in" => "zoom-in",
        "view.zoom-out" => "zoom-out",
        "view.fit" => "fit",
        "example:bonjour" => "example:bonjour",
        "example:boucle" => "example:boucle",
        "example:fonction" => "example:fonction",
        "example:tableau" => "example:tableau",
        "examples.folder" => {
            open_examples_folder(app);
            return;
        }
        "help.quickstart" => {
            show_quickstart(app);
            return;
        }
        "help.shortcuts" => {
            show_shortcuts(app);
            return;
        }
        "help.about" => {
            show_about(app);
            return;
        }
        "recent.clear" => {
            {
                let state = app.state::<AppState>();
                let mut session = lock_session(&state);
                session.recent.clear();
                write_state(&state.data_dir, &session);
            }
            rebuild_menu(app);
            return;
        }
        other => {
            if let Some(rest) = other.strip_prefix("recent:") {
                if let Ok(index) = rest.parse::<usize>() {
                    let path = {
                        let state = app.state::<AppState>();
                        let session = lock_session(&state);
                        session.recent.get(index).cloned()
                    };
                    if let Some(path) = path {
                        request_open(app, PathBuf::from(path));
                    }
                }
            }
            return;
        }
    };
    let _ = app.emit("menu", action);
}

/* ------------------------------------------------------- IPC : fichiers */

#[derive(Serialize)]
struct GraphFile {
    path: String,
    name: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl GraphFile {
    fn failure(message: String) -> Self {
        Self {
            path: String::new(),
            name: String::new(),
            content: String::new(),
            error: Some(message),
        }
    }

    fn read(path: &Path) -> Self {
        match fs::read_to_string(path) {
            Ok(content) => Self {
                path: path_text(path),
                name: file_name_of(path),
                content,
                error: None,
            },
            Err(err) => Self::failure(format!("Impossible de lire ce fichier : {err}")),
        }
    }
}

#[derive(Serialize)]
struct SaveResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Deserialize)]
struct SavePayload {
    #[serde(default)]
    path: Option<String>,
    content: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    lang: Option<String>,
}

fn safe_name(payload: &SavePayload) -> String {
    let raw = payload
        .name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "graphique".to_string());
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            other => other,
        })
        .collect();
    cleaned.trim().to_string()
}

async fn pick_save_path(
    app: &AppHandle,
    file_name: String,
    filter_name: &'static str,
    extensions: &'static [&'static str],
) -> Option<PathBuf> {
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .file()
            .set_title("Enregistrer")
            .set_file_name(file_name)
            .add_filter(filter_name, extensions)
            .add_filter("Tous les fichiers", &["*"])
            .blocking_save_file()
    })
    .await
    .ok()
    .flatten()?;
    picked.into_path().ok()
}

fn write_text(path: &Path, content: &str) -> Result<(), String> {
    fs::write(path, content).map_err(|err| format!("Écriture impossible : {err}"))
}

fn save_into(path: &Path, payload: &SavePayload) -> SaveResult {
    match write_text(path, &payload.content) {
        Ok(()) => SaveResult {
            path: Some(path_text(path)),
            error: None,
        },
        Err(message) => SaveResult {
            path: None,
            error: Some(message),
        },
    }
}

#[tauri::command]
async fn file_open(app: AppHandle, path: Option<String>) -> Option<GraphFile> {
    let selected = match path {
        Some(path) => Some(PathBuf::from(path)),
        None => {
            let handle = app.clone();
            let picked = tauri::async_runtime::spawn_blocking(move || {
                handle
                    .dialog()
                    .file()
                    .set_title("Ouvrir un graphique")
                    .add_filter("Graphique Blueprint", &["json"])
                    .add_filter("Tous les fichiers", &["*"])
                    .blocking_pick_file()
            })
            .await
            .ok()
            .flatten()?;
            picked.into_path().ok()
        }
    }?;

    let file = GraphFile::read(&selected);
    match &file.error {
        Some(_) => forget_missing(&app, &path_text(&selected)),
        None => remember_file(&app, &selected),
    }
    Some(file)
}

#[tauri::command]
async fn file_read(app: AppHandle, path: String) -> Option<GraphFile> {
    let selected = PathBuf::from(&path);
    let file = GraphFile::read(&selected);
    match &file.error {
        Some(_) => forget_missing(&app, &path),
        None => remember_file(&app, &selected),
    }
    Some(file)
}

#[tauri::command]
async fn file_save(app: AppHandle, payload: SavePayload) -> Option<SaveResult> {
    if let Some(path) = payload.path.clone() {
        let target = PathBuf::from(path);
        let result = save_into(&target, &payload);
        if result.error.is_none() {
            remember_file(&app, &target);
        }
        return Some(result);
    }
    save_as(&app, &payload, "Graphique Blueprint", &["blueprint.json", "json"], true).await
}

#[tauri::command]
async fn file_save_as(app: AppHandle, payload: SavePayload) -> Option<SaveResult> {
    save_as(&app, &payload, "Graphique Blueprint", &["blueprint.json", "json"], true).await
}

#[tauri::command]
async fn file_export(app: AppHandle, payload: SavePayload) -> Option<SaveResult> {
    let lang = payload.lang.clone().unwrap_or_default();
    let (filter, extensions) = match lang.as_str() {
        "python" => ("Code Python", &["py"][..]),
        "csharp" => ("Code C#", &["cs"][..]),
        "cpp" => ("Code C++", &["cpp"][..]),
        "unity" => ("Script Unity", &["cs"][..]),
        _ => ("Texte", &["txt"][..]),
    };
    save_as(&app, &payload, filter, extensions, false).await
}

async fn save_as(
    app: &AppHandle,
    payload: &SavePayload,
    filter: &'static str,
    extensions: &'static [&'static str],
    remember: bool,
) -> Option<SaveResult> {
    let mut file_name = safe_name(payload);
    let suffix = if remember {
        ".blueprint.json".to_string()
    } else {
        format!(".{}", extensions.first().copied().unwrap_or("txt"))
    };
    if !file_name.to_ascii_lowercase().ends_with(&suffix) {
        file_name.push_str(&suffix);
    }
    let target = pick_save_path(app, file_name, filter, extensions).await?;
    let result = save_into(&target, payload);
    if remember && result.error.is_none() {
        remember_file(app, &target);
    }
    Some(result)
}

/* ------------------------------------------------------ IPC : brouillon */

#[derive(Serialize)]
struct Draft {
    content: String,
    #[serde(rename = "savedAt")]
    saved_at: f64,
}

fn draft_file(dir: &Path) -> PathBuf {
    dir.join(DRAFT_FILE)
}

fn draft_save_file(dir: &Path, content: &str) -> bool {
    if content.trim().is_empty() {
        return false;
    }
    let target = draft_file(dir);
    let temporary = target.with_extension("json.tmp");
    let written = fs::create_dir_all(dir).is_ok()
        && fs::write(&temporary, content).is_ok()
        && fs::rename(&temporary, &target).is_ok();
    if !written {
        let _ = fs::remove_file(&temporary);
    }
    written
}

fn draft_read_file(dir: &Path) -> Option<Draft> {
    let target = draft_file(dir);
    let metadata = fs::metadata(&target).ok()?;
    let modified = metadata.modified().ok()?;
    let age = SystemTime::now()
        .duration_since(modified)
        .unwrap_or_default()
        .as_millis();
    if age > DRAFT_MAX_AGE_MS {
        let _ = fs::remove_file(&target);
        return None;
    }
    let content = fs::read_to_string(&target).ok()?;
    if content.trim().is_empty() {
        return None;
    }
    let saved_at = modified
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as f64)
        .unwrap_or(0.0);
    Some(Draft { content, saved_at })
}

fn draft_clear_file(dir: &Path) -> bool {
    fs::remove_file(draft_file(dir)).is_ok()
}

#[tauri::command]
fn draft_save(app: AppHandle, payload: SavePayload) -> bool {
    let dir = app.state::<AppState>().data_dir.clone();
    draft_save_file(&dir, &payload.content)
}

#[tauri::command]
fn draft_read(app: AppHandle) -> Option<Draft> {
    let dir = app.state::<AppState>().data_dir.clone();
    draft_read_file(&dir)
}

#[tauri::command]
fn draft_clear(app: AppHandle) -> bool {
    let dir = app.state::<AppState>().data_dir.clone();
    draft_clear_file(&dir)
}

/* --------------------------------------------------------- IPC : fenêtre */

#[tauri::command]
fn win_set_title(app: AppHandle, title: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(if title.trim().is_empty() {
            "Blueprint Studio"
        } else {
            &title
        });
    }
}

#[tauri::command]
fn win_close(app: AppHandle) {
    app.state::<AppState>().allow_close.store(true, Ordering::SeqCst);
    save_state(&app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

/* ------------------------------------------------------ diagnostic (CI) */

const SMOKE_SCRIPT: &str = r#"
(function () {
  function count(selector) {
    return document.querySelectorAll(selector).length;
  }
  function read() {
    return (document.getElementById('code') || {}).textContent || '';
  }
  function send(report) {
    window.__TAURI__.core.invoke('diag_report', { json: JSON.stringify(report) });
  }
  try {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#langTabs .tab'));
    var report = {
      desktop: !!(window.desktop && window.desktop.isDesktop),
      engine: window.desktop && window.desktop.engine,
      palette: count('#paletteList > *'),
      nodes: (document.getElementById('statusNodes') || {}).textContent || '',
      wires: (document.getElementById('statusWires') || {}).textContent || '',
      problems: (document.getElementById('statusProblems') || {}).textContent || '',
      title: document.title,
      lengths: {},
      heads: {}
    };
    var index = 0;
    (function next() {
      if (index >= tabs.length) { send(report); return; }
      var label = tabs[index].textContent.trim();
      tabs[index].click();
      setTimeout(function () {
        var code = read();
        report.lengths[label] = code.length;
        report.heads[label] = code.split('\n')[0].slice(0, 40);
        index += 1;
        next();
      }, 260);
    })();
    return;
  } catch (error) {
    window.__TAURI__.core.invoke('diag_report', { json: JSON.stringify({ error: String(error) }) });
  }
})();
"#;

#[tauri::command]
fn diag_report(app: AppHandle, json: String) {
    println!("SMOKE {json}");
    app.exit(0);
}

/* -------------------------------------------------------------- tests */

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bp-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("dossier temporaire");
        dir
    }

    #[test]
    fn brouillon_aller_retour() {
        let dir = temp_dir("draft");
        assert!(draft_read_file(&dir).is_none(), "aucun brouillon au départ");
        assert!(draft_save_file(&dir, "{\"noeuds\":[]}"));
        let draft = draft_read_file(&dir).expect("brouillon lisible");
        assert_eq!(draft.content, "{\"noeuds\":[]}");
        assert!(draft.saved_at > 0.0);
        assert!(!draft_save_file(&dir, "   "), "contenu vide refusé");
        assert!(draft_clear_file(&dir));
        assert!(draft_read_file(&dir).is_none());
        assert!(!draft_clear_file(&dir), "effacer deux fois renvoie false");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn brouillon_trop_vieux_est_ignore() {
        let dir = temp_dir("draft-old");
        assert!(draft_save_file(&dir, "{}\n"));
        /* On antidate le fichier de huit jours pour simuler un brouillon périmé. */
        let target = draft_file(&dir);
        let old = SystemTime::now() - Duration::from_secs(8 * 24 * 3600);
        let handle = fs::OpenOptions::new().write(true).open(&target).expect("ouverture");
        handle.set_modified(old).expect("date modifiée");
        drop(handle);
        assert!(draft_read_file(&dir).is_none(), "brouillon de 8 jours ignoré");
        assert!(!target.exists(), "brouillon périmé supprimé");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn noms_de_fichier_assainis() {
        let payload = SavePayload {
            path: None,
            content: String::new(),
            name: Some("mon:graphique*?".to_string()),
            lang: None,
        };
        assert_eq!(safe_name(&payload), "mon-graphique--");
        let vide = SavePayload {
            path: None,
            content: String::new(),
            name: Some("   ".to_string()),
            lang: None,
        };
        assert_eq!(safe_name(&vide), "graphique");
    }

    #[test]
    fn chemins_windows_equivalents() {
        assert!(same_path("D:/a/b.json", "D:\\a\\B.json"));
        assert!(same_path("D:\\a\\b.json", "D:\\A\\B.JSON"));
        assert!(!same_path("D:/a/b.json", "D:/a/c.json"));
        assert_eq!(path_text(Path::new("D:/a/b.json")), "D:\\a\\b.json");
    }

    #[test]
    fn arguments_json_seulement() {
        let dir = temp_dir("args");
        let graph = dir.join("test.blueprint.json");
        fs::write(&graph, "{}").expect("écriture");
        let args = vec![
            "exe".to_string(),
            "--flag".to_string(),
            "note.txt".to_string(),
            graph.to_string_lossy().to_string(),
        ];
        assert_eq!(file_from_args(&args), Some(graph));
        let none = vec!["exe".to_string(), "absent.json".to_string()];
        assert_eq!(file_from_args(&none), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn etat_conserve_les_fichiers_existants() {
        let dir = temp_dir("state");
        let present = dir.join("present.json");
        fs::write(&present, "{}").expect("écriture");
        let session = Session {
            window: Some(WindowBounds { x: 10, y: 20, width: 1500, height: 950 }),
            maximized: true,
            recent: vec![
                present.to_string_lossy().to_string(),
                dir.join("disparu.json").to_string_lossy().to_string(),
            ],
        };
        write_state(&dir, &session);
        let relu = load_state(&dir);
        assert_eq!(relu.recent.len(), 1, "les fichiers disparus sont retirés");
        assert!(relu.maximized);
        assert_eq!(relu.window.map(|w| w.width), Some(1500));
        let _ = fs::remove_dir_all(&dir);
    }
}

/* -------------------------------------------------- erreurs de démarrage */

/* Une application fenêtrée n'a pas de console : sans ce message, un WebView2
   manquant ou un plantage au démarrage ne produirait rien de visible. */
fn show_fatal(message: &str) {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

        fn wide(text: &str) -> Vec<u16> {
            OsStr::new(text)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        }

        let body = wide(message);
        let title = wide("Blueprint Studio");
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                body.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("{message}");
    }
}

/* ------------------------------------------------------------- démarrage */

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let detail = info
            .payload()
            .downcast_ref::<&str>()
            .map(|text| text.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "erreur inconnue".to_string());
        show_fatal(&format!(
            "Blueprint Studio a rencontré une erreur inattendue.\n\n{detail}"
        ));
    }));

    let outcome = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if let Some(path) = file_from_args(&argv) {
                request_open(app, path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            file_open,
            file_read,
            file_save,
            file_save_as,
            file_export,
            draft_save,
            draft_read,
            draft_clear,
            win_set_title,
            win_close,
            diag_report
        ])
        .on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();

            let data_dir = handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = fs::create_dir_all(&data_dir);
            let session = load_state(&data_dir);
            let examples_dir = data_dir.join("exemples");

            app.manage(AppState {
                session: Mutex::new(session.clone()),
                allow_close: AtomicBool::new(false),
                ready: AtomicBool::new(false),
                pending_open: Mutex::new(None),
                data_dir,
                examples_dir,
            });

            let menu = build_menu(&handle)?;
            app.set_menu(menu)?;

            if let Some(path) = file_from_args(&std::env::args().collect::<Vec<String>>()) {
                *handle
                    .state::<AppState>()
                    .pending_open
                    .lock()
                    .unwrap_or_else(|err| err.into_inner()) = Some(path_text(&path));
            }

            let bounds = session.window.clone();
            let width = bounds
                .as_ref()
                .map(|b| (b.width as f64).max(1080.0))
                .unwrap_or(DEFAULT_WIDTH);
            let height = bounds
                .as_ref()
                .map(|b| (b.height as f64).max(640.0))
                .unwrap_or(DEFAULT_HEIGHT);

            let mut builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Blueprint Studio")
            .inner_size(width, height)
            .min_inner_size(1080.0, 640.0)
            .visible(false)
            .on_page_load(|window, payload| {
                /* `Started` arrive avant l'exécution des scripts : l'interface
                   n'écoute pas encore. On attend la fin du chargement. */
                if payload.event() != tauri::webview::PageLoadEvent::Finished {
                    return;
                }
                let handle = window.app_handle().clone();
                handle.state::<AppState>().ready.store(true, Ordering::SeqCst);
                let _ = window.show();
                flush_open(&handle);
                if std::env::var_os("BP_SMOKE").is_some() {
                    let delayed = handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(1200));
                        if let Some(window) = delayed.get_webview_window("main") {
                            let _ = window.eval(SMOKE_SCRIPT);
                        }
                    });
                }
            });

            if let Some(bounds) = &bounds {
                let monitor = handle.primary_monitor().ok().flatten();
                if let Some(monitor) = monitor {
                    let scale = monitor.scale_factor();
                    let screen_width = monitor.size().width as f64 / scale;
                    let screen_height = monitor.size().height as f64 / scale;
                    let visible = bounds.x as f64 > -80.0
                        && bounds.y as f64 > -80.0
                        && (bounds.x as f64) < screen_width - 120.0
                        && (bounds.y as f64) < screen_height - 80.0;
                    if visible {
                        builder = builder.position(bounds.x as f64, bounds.y as f64);
                    }
                }
            }

            if session.maximized {
                builder = builder.maximized(true);
            }

            let window = builder.build()?;
            let tracker = handle.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if tracker
                        .state::<AppState>()
                        .allow_close
                        .load(Ordering::SeqCst)
                    {
                        save_state(&tracker);
                    } else {
                        api.prevent_close();
                        let _ = tracker.emit("app:close-request", ());
                    }
                }
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => schedule_save(&tracker),
                _ => {}
            });

            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(err) = outcome {
        show_fatal(&format!(
            "Blueprint Studio n'a pas pu démarrer.\n\n{err}\n\n"
        ));
        std::process::exit(1);
    }
}
