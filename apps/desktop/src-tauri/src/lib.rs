use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use percent_encoding::percent_decode_str;
use reqwest::header::{CONTENT_DISPOSITION, CONTENT_LENGTH, RANGE};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_autostart::MacosLauncher;

const CREDENTIAL_SERVICE: &str = "ba.tvkuca.aplikacijav2";

struct DesktopState {
    transfer_guard: AtomicBool,
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    watched_exports: Mutex<HashMap<String, PathBuf>>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            transfer_guard: AtomicBool::new(false),
            cancellations: Mutex::new(HashMap::new()),
            watched_exports: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceInfo {
    hostname: String,
    platform: String,
    platform_version: String,
    architecture: String,
    app_version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeDownloadRequest {
    id: String,
    url: String,
    label: String,
    target_path: Option<String>,
    expected_sha256: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTransferProgress {
    id: String,
    status: String,
    transferred_bytes: u64,
    total_bytes: u64,
    path: String,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDownloadResult {
    id: String,
    path: String,
    bytes: u64,
    sha256: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PremiereWorkspaceFile {
    source_url: String,
    file_name: String,
    category: String,
    video_id: Option<String>,
    file_id: Option<String>,
    in_ms: Option<u64>,
    out_ms: Option<u64>,
    order: Option<u32>,
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PremiereWorkspaceRequest {
    job_id: String,
    title: String,
    brief: String,
    rough_cut: serde_json::Value,
    files: Vec<PremiereWorkspaceFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PremiereWorkspaceResult {
    job_id: String,
    workspace_path: String,
    manifest_path: String,
    exports_path: String,
    downloaded: usize,
    skipped: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PremiereExportReady {
    job_id: String,
    path: String,
    size: u64,
}

fn emit_transfer(
    app: &tauri::AppHandle,
    id: &str,
    status: &str,
    transferred_bytes: u64,
    total_bytes: u64,
    path: &Path,
    error: &str,
) {
    let _ = app.emit("desktop:transfer-progress", NativeTransferProgress {
        id: id.to_string(),
        status: status.to_string(),
        transferred_bytes,
        total_bytes,
        path: path.to_string_lossy().to_string(),
        error: error.to_string(),
    });
}

fn safe_filename(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches(|character: char| character == '.' || character.is_whitespace());
    if trimmed.is_empty() { "download.bin".into() } else { trimmed.chars().take(220).collect() }
}

fn disposition_filename(value: &str) -> Option<String> {
    for part in value.split(';').map(str::trim) {
        if let Some(encoded) = part.strip_prefix("filename*=") {
            let encoded = encoded.trim_matches('"').strip_prefix("UTF-8''").unwrap_or(encoded);
            return percent_decode_str(encoded).decode_utf8().ok().map(|value| safe_filename(&value));
        }
    }
    for part in value.split(';').map(str::trim) {
        if let Some(filename) = part.strip_prefix("filename=") {
            return Some(safe_filename(filename.trim_matches('"')));
        }
    }
    None
}

fn available_path(directory: &Path, filename: &str) -> PathBuf {
    let initial = directory.join(filename);
    let initial_part = PathBuf::from(format!("{}.part", initial.to_string_lossy()));
    if !initial.exists() || initial_part.exists() {
        return initial;
    }

    let path = Path::new(filename);
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str());
    for suffix in 1..10_000 {
        let candidate_name = match extension {
            Some(extension) => format!("{stem} ({suffix}).{extension}"),
            None => format!("{stem} ({suffix})"),
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{}-download.bin", chrono_free_timestamp()))
}

fn chrono_free_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default()
}

async fn sha256_file(path: &Path) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::open(path).await.map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).await.map_err(|error| error.to_string())?;
        if read == 0 { break; }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

async fn download_workspace_file(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    job_id: &str,
    index: usize,
    item: &PremiereWorkspaceFile,
    target_directory: &Path,
) -> Result<(PathBuf, bool), String> {
    use tokio::io::AsyncWriteExt;

    let parsed_url = reqwest::Url::parse(&item.source_url).map_err(|_| "Premiere download URL nije ispravan.".to_string())?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("Premiere workspace dozvoljava samo HTTP(S) izvore.".into());
    }
    let target = target_directory.join(safe_filename(&item.file_name));
    if tokio::fs::metadata(&target).await.map(|metadata| metadata.len() > 0).unwrap_or(false) {
        return Ok((target, true));
    }
    let part = PathBuf::from(format!("{}.part", target.to_string_lossy()));
    let resume_from = tokio::fs::metadata(&part).await.map(|metadata| metadata.len()).unwrap_or(0);
    let mut request = client.get(parsed_url);
    if resume_from > 0 {
        request = request.header(RANGE, format!("bytes={resume_from}-"));
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Premiere media download nije uspio: HTTP {}", response.status()));
    }
    let partial = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let start_at = if partial { resume_from } else { 0 };
    let response_length = response.headers().get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let total = if response_length > 0 { start_at + response_length } else { 0 };
    let mut options = tokio::fs::OpenOptions::new();
    options.create(true).write(true);
    if start_at > 0 { options.append(true); } else { options.truncate(true); }
    let mut file = options.open(&part).await.map_err(|error| error.to_string())?;
    let mut stream = response.bytes_stream();
    let mut transferred = start_at;
    let transfer_id = format!("premiere:{job_id}:{index}");
    emit_transfer(app, &transfer_id, "transferring", transferred, total, &target, "");
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|error| error.to_string())?;
        file.write_all(&bytes).await.map_err(|error| error.to_string())?;
        transferred += bytes.len() as u64;
        if last_emit.elapsed() >= std::time::Duration::from_millis(300) {
            emit_transfer(app, &transfer_id, "transferring", transferred, total, &target, "");
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    tokio::fs::rename(&part, &target).await.map_err(|error| error.to_string())?;
    emit_transfer(app, &transfer_id, "completed", transferred, total, &target, "");
    Ok((target, false))
}

#[tauri::command]
async fn prepare_premiere_workspace(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    request: PremiereWorkspaceRequest,
) -> Result<PremiereWorkspaceResult, String> {
    if request.job_id.len() != 24 || !request.job_id.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("Premiere job ID nije ispravan.".into());
    }
    if request.files.len() > 250 {
        return Err("Premiere workspace ima previše fajlova.".into());
    }

    let workspace = app.path().app_local_data_dir().map_err(|error| error.to_string())?
        .join("workspaces")
        .join(&request.job_id);
    let media = workspace.join("Media");
    let off = workspace.join("OFF");
    let brief = workspace.join("Brief");
    let exports = workspace.join("Exports");
    for directory in [&media, &off, &brief, &exports] {
        tokio::fs::create_dir_all(directory).await.map_err(|error| error.to_string())?;
    }

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let mut manifest_media = Vec::new();
    let mut manifest_off = Vec::new();
    let mut downloaded = 0;
    let mut skipped = 0;

    for (index, item) in request.files.iter().enumerate() {
        let target_directory = if item.category.eq_ignore_ascii_case("OFF") { &off } else { &media };
        let (path, was_skipped) = download_workspace_file(&app, &client, &request.job_id, index, item, target_directory).await?;
        if was_skipped { skipped += 1; } else { downloaded += 1; }
        let mut entry = serde_json::to_value(item).map_err(|error| error.to_string())?;
        entry["path"] = serde_json::Value::String(path.to_string_lossy().to_string());
        entry["fileName"] = serde_json::Value::String(
            path.file_name().and_then(|value| value.to_str()).unwrap_or("media.bin").to_string()
        );
        if item.category.eq_ignore_ascii_case("OFF") { manifest_off.push(entry); } else { manifest_media.push(entry); }
    }

    let brief_path = brief.join("brief.txt");
    tokio::fs::write(&brief_path, request.brief.as_bytes()).await.map_err(|error| error.to_string())?;
    let manifest_path = workspace.join("manifest.json");
    let manifest = serde_json::json!({
        "schema": "vca-premiere-workspace/v1",
        "jobId": request.job_id,
        "title": request.title,
        "brief": request.brief,
        "workspacePath": workspace.to_string_lossy(),
        "exportsPath": exports.to_string_lossy(),
        "media": manifest_media,
        "off": manifest_off,
        "roughCut": request.rough_cut,
        "createdAt": chrono_free_timestamp(),
    });
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    tokio::fs::write(&manifest_path, manifest_bytes).await.map_err(|error| error.to_string())?;

    state.watched_exports.lock().map_err(|_| "Workspace watcher nije dostupan.".to_string())?
        .insert(request.job_id.clone(), exports.clone());

    Ok(PremiereWorkspaceResult {
        job_id: request.job_id,
        workspace_path: workspace.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        exports_path: exports.to_string_lossy().to_string(),
        downloaded,
        skipped,
    })
}

#[tauri::command]
async fn start_native_download(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    request: NativeDownloadRequest,
) -> Result<NativeDownloadResult, String> {
    use tokio::io::AsyncWriteExt;

    let cancellation = Arc::new(AtomicBool::new(false));
    state.cancellations.lock().map_err(|_| "Transfer lock nije dostupan.".to_string())?
        .insert(request.id.clone(), cancellation.clone());

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let parsed_url = reqwest::Url::parse(&request.url).map_err(|_| "Download URL nije ispravan.".to_string())?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("Desktop download dozvoljava samo HTTP(S) URL.".into());
    }
    let download_directory = app.path().download_dir().map_err(|error| error.to_string())?;
    tokio::fs::create_dir_all(&download_directory).await.map_err(|error| error.to_string())?;

    let hinted_target = request.target_path.as_ref()
        .map(PathBuf::from)
        .filter(|path| path.parent() == Some(download_directory.as_path()));
    let hinted_part = hinted_target.as_ref().map(|path| PathBuf::from(format!("{}.part", path.to_string_lossy())));
    let resume_from = match &hinted_part {
        Some(path) => tokio::fs::metadata(path).await.map(|metadata| metadata.len()).unwrap_or(0),
        None => 0,
    };

    let mut builder = client.get(&request.url);
    if resume_from > 0 {
        builder = builder.header(RANGE, format!("bytes={resume_from}-"));
    }
    let response = builder.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        state.cancellations.lock().ok().map(|mut map| map.remove(&request.id));
        return Err(format!("Download server je vratio {status}: {body}"));
    }

    let header_filename = response.headers().get(CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .and_then(disposition_filename);
    let target = hinted_target.unwrap_or_else(|| {
        let filename = header_filename.unwrap_or_else(|| safe_filename(&request.label));
        available_path(&download_directory, &filename)
    });
    let part = PathBuf::from(format!("{}.part", target.to_string_lossy()));
    let partial_response = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let start_at = if partial_response { resume_from } else { 0 };
    let response_length = response.headers().get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let total = if response_length > 0 { start_at + response_length } else { 0 };

    let mut options = tokio::fs::OpenOptions::new();
    options.create(true).write(true);
    if start_at > 0 { options.append(true); } else { options.truncate(true); }
    let mut file = options.open(&part).await.map_err(|error| error.to_string())?;
    let mut stream = response.bytes_stream();
    let mut transferred = start_at;
    let mut last_progress_emit = std::time::Instant::now();
    emit_transfer(&app, &request.id, "transferring", transferred, total, &target, "");

    while let Some(chunk) = stream.next().await {
        if cancellation.load(Ordering::Relaxed) {
            file.flush().await.ok();
            emit_transfer(&app, &request.id, "paused", transferred, total, &target, "Transfer je pauziran; djelimični fajl je sačuvan.");
            state.cancellations.lock().ok().map(|mut map| map.remove(&request.id));
            return Err("Transfer je pauziran.".into());
        }
        let bytes = chunk.map_err(|error| error.to_string())?;
        file.write_all(&bytes).await.map_err(|error| error.to_string())?;
        transferred += bytes.len() as u64;
        if last_progress_emit.elapsed() >= std::time::Duration::from_millis(250) {
            emit_transfer(&app, &request.id, "transferring", transferred, total, &target, "");
            last_progress_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);

    let checksum = if let Some(expected) = request.expected_sha256.filter(|value| !value.is_empty()) {
        emit_transfer(&app, &request.id, "verifying", transferred, total, &target, "");
        let actual = sha256_file(&part).await?;
        if !actual.eq_ignore_ascii_case(&expected) {
            let message = "SHA-256 provjera nije prošla; .part fajl je zadržan.";
            emit_transfer(&app, &request.id, "failed", transferred, total, &target, message);
            state.cancellations.lock().ok().map(|mut map| map.remove(&request.id));
            return Err(message.into());
        }
        Some(actual)
    } else {
        None
    };

    tokio::fs::rename(&part, &target).await.map_err(|error| error.to_string())?;
    emit_transfer(&app, &request.id, "completed", transferred, total, &target, "");
    state.cancellations.lock().ok().map(|mut map| map.remove(&request.id));
    Ok(NativeDownloadResult {
        id: request.id,
        path: target.to_string_lossy().to_string(),
        bytes: transferred,
        sha256: checksum,
    })
}

#[tauri::command]
fn cancel_native_download(id: String, state: State<'_, DesktopState>) -> Result<(), String> {
    let map = state.cancellations.lock().map_err(|_| "Transfer lock nije dostupan.".to_string())?;
    if let Some(cancellation) = map.get(&id) {
        cancellation.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn device_info(app: tauri::AppHandle) -> DeviceInfo {
    DeviceInfo {
        hostname: std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows računar".into()),
        platform: std::env::consts::OS.into(),
        platform_version: std::env::var("OS").unwrap_or_default(),
        architecture: std::env::consts::ARCH.into(),
        app_version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
fn set_transfer_guard(active: bool, state: State<'_, DesktopState>) {
    state.transfer_guard.store(active, Ordering::Relaxed);
}

#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, &key)
        .map_err(|error| error.to_string())?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, &key)
        .map_err(|error| error.to_string())?;

    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secure_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, &key)
        .map_err(|error| error.to_string())?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle, state: State<'_, DesktopState>, force: bool) {
    if !force && state.transfer_guard.load(Ordering::Relaxed) {
        let _ = app.emit("desktop:quit-requested", ());
        return;
    }
    app.exit(0);
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            let _ = app.emit("desktop:second-instance", args);
        }))
        .manage(DesktopState::default())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let salt_path = app
                .path()
                .app_local_data_dir()
                .map_err(|error| error.to_string())?
                .join("stronghold-salt.txt");
            app.handle().plugin(
                tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build(),
            )?;

            let open = MenuItem::with_id(app, "open", "Otvori Aplikaciju v2", true, None::<&str>)?;
            let notifications = MenuItem::with_id(app, "notifications", "Moj rad i notifikacije", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Izlaz", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &notifications, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("Aplikacija v2")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "notifications" => {
                        show_main_window(app);
                        let _ = app.emit("desktop:navigate", "/my-work");
                    }
                    "quit" => {
                        let guarded = app
                            .state::<DesktopState>()
                            .transfer_guard
                            .load(Ordering::Relaxed);
                        if guarded {
                            show_main_window(app);
                            let _ = app.emit("desktop:quit-requested", ());
                        } else {
                            app.exit(0);
                        }
                    }
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            let watcher_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut observations: HashMap<String, (u64, std::time::Instant, bool)> = HashMap::new();
                loop {
                    let workspaces = watcher_app
                        .state::<DesktopState>()
                        .watched_exports
                        .lock()
                        .map(|items| items.clone())
                        .unwrap_or_default();
                    for (job_id, exports_path) in workspaces {
                        let mut entries = match tokio::fs::read_dir(&exports_path).await {
                            Ok(entries) => entries,
                            Err(_) => continue,
                        };
                        while let Ok(Some(entry)) = entries.next_entry().await {
                            let path = entry.path();
                            let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
                            if !matches!(extension.as_str(), "mp4" | "mov" | "mxf" | "mkv" | "avi") {
                                continue;
                            }
                            let size = entry.metadata().await.map(|metadata| metadata.len()).unwrap_or(0);
                            let key = format!("{}:{}", job_id, path.to_string_lossy());
                            match observations.get_mut(&key) {
                                Some((previous_size, changed_at, notified)) if *previous_size == size => {
                                    if size > 0 && !*notified && changed_at.elapsed() >= std::time::Duration::from_secs(3) {
                                        let _ = watcher_app.emit("desktop:premiere-export-ready", PremiereExportReady {
                                            job_id: job_id.clone(),
                                            path: path.to_string_lossy().to_string(),
                                            size,
                                        });
                                        *notified = true;
                                    }
                                }
                                Some((previous_size, changed_at, notified)) => {
                                    *previous_size = size;
                                    *changed_at = std::time::Instant::now();
                                    *notified = false;
                                }
                                None => {
                                    observations.insert(key, (size, std::time::Instant::now(), false));
                                }
                            }
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            });

            if std::env::args().any(|arg| arg == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_transfer_guard,
            secure_set,
            secure_get,
            secure_delete,
            device_info,
            start_native_download,
            cancel_native_download,
            prepare_premiere_workspace,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("Aplikacija v2 se nije mogla pokrenuti");
}
