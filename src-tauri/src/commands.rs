use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_tray_base::{emit_to_renderer, save_settings, TrayBaseState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanPayload {
    pub url: Option<String>,
    pub mode: Option<String>,
    pub out_dir: Option<String>,
    pub timeout_ms: Option<u64>,
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_node() -> PathBuf {
    if let Ok(found) = which::which("node") {
        return found;
    }
    PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" })
}

fn validate_http_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Enter a page URL.".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("URL must start with http:// or https://".into());
    }
    // Minimal structural check (host present after scheme).
    let rest = if let Some(r) = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .or_else(|| trimmed.strip_prefix("HTTP://"))
        .or_else(|| trimmed.strip_prefix("HTTPS://"))
    {
        r
    } else {
        return Err("Invalid URL.".into());
    };
    if rest.is_empty() || rest.starts_with('/') {
        return Err("Invalid URL.".into());
    }
    Ok(trimmed.to_string())
}

fn resolve_out_dir(app: &AppHandle, requested: Option<&str>, settings: &Value) -> PathBuf {
    let chosen = requested
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            settings
                .get("outDir")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
        });

    if let Some(path) = chosen {
        return path;
    }

    app.path()
        .document_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Font Checker")
}

fn push_recent_url(settings: &mut tauri_tray_base::PersistedSettings, url: &str) {
    let clean = url.trim();
    if clean.is_empty() {
        return;
    }
    let mut recent: Vec<String> = settings
        .extra
        .get("recentUrls")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .filter(|u| u != clean)
                .collect()
        })
        .unwrap_or_default();
    recent.insert(0, clean.to_string());
    recent.truncate(12);
    settings.extra.insert(
        "recentUrls".into(),
        Value::Array(recent.into_iter().map(Value::String).collect()),
    );
}

fn run_sidecar_check(request: &Value) -> Result<Value, String> {
    let root = project_root();
    let host = root.join("sidecar").join("host.mjs");
    if !host.exists() {
        return Err(format!("Sidecar missing: {}", host.display()));
    }

    let node = resolve_node();
    let mut cmd = Command::new(&node);
    cmd.arg(&host)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn node sidecar: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let body = serde_json::to_vec(request).map_err(|e| e.to_string())?;
        stdin
            .write_all(&body)
            .map_err(|e| format!("Failed writing to sidecar stdin: {e}"))?;
    }

    let mut stdout = String::new();
    if let Some(mut out) = child.stdout.take() {
        out.read_to_string(&mut stdout)
            .map_err(|e| format!("Failed reading sidecar stdout: {e}"))?;
    }

    let mut stderr = String::new();
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr);
    }

    let status = child
        .wait()
        .map_err(|e| format!("Sidecar wait failed: {e}"))?;

    let line = stdout
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");

    if line.is_empty() {
        let detail = if stderr.trim().is_empty() {
            format!("exit {}", status.code().unwrap_or(-1))
        } else {
            stderr.trim().to_string()
        };
        return Err(format!("Sidecar returned no JSON ({detail})"));
    }

    serde_json::from_str(line).map_err(|e| {
        let detail = if stderr.trim().is_empty() {
            line.to_string()
        } else {
            format!("{line} | stderr: {}", stderr.trim())
        };
        format!("Invalid sidecar JSON: {e} ({detail})")
    })
}

#[tauri::command]
pub fn dialog_pick_folder(app: AppHandle, title: Option<String>) -> Option<String> {
    let title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| "Choose output folder".into());

    app.dialog()
        .file()
        .set_title(title)
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn fonts_scan(
    app: AppHandle,
    state: State<'_, TrayBaseState>,
    payload: ScanPayload,
) -> Result<Value, String> {
    let href = match validate_http_url(&payload.url.unwrap_or_default()) {
        Ok(u) => u,
        Err(error) => return Ok(json!({ "ok": false, "error": error })),
    };

    let (mode, out_dir, timeout_ms, settings_value) = {
        let mut settings = state.settings.lock();
        let mode = payload
            .mode
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| {
                settings
                    .extra
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "convert".into());
        let mode = match mode.as_str() {
            "discover" | "download" | "convert" => mode,
            _ => "convert".into(),
        };

        let current = settings.to_value();
        let out_dir = resolve_out_dir(&app, payload.out_dir.as_deref(), &current);
        let timeout_ms = payload
            .timeout_ms
            .or_else(|| settings.extra.get("timeoutMs").and_then(|v| v.as_u64()))
            .unwrap_or(30_000)
            .clamp(5_000, 120_000);

        settings.extra.insert("mode".into(), json!(mode));
        settings
            .extra
            .insert("outDir".into(), json!(out_dir.to_string_lossy()));
        settings
            .extra
            .insert("timeoutMs".into(), json!(timeout_ms));
        push_recent_url(&mut settings, &href);
        let _ = save_settings(&state.settings_path, &settings);
        let settings_value = settings.to_value();
        (mode, out_dir, timeout_ms, settings_value)
    };

    emit_to_renderer(&app, "settings:changed", settings_value);
    emit_to_renderer(
        &app,
        "fonts:status",
        json!({ "status": "running", "url": href }),
    );

    let download = mode == "download" || mode == "convert";
    let convert = mode == "convert";
    let request = json!({
        "op": "checkSite",
        "url": href,
        "download": download,
        "convert": convert,
        "outDir": out_dir.to_string_lossy(),
        "timeoutMs": timeout_ms,
    });

    let sidecar_result = tauri::async_runtime::spawn_blocking(move || run_sidecar_check(&request))
        .await
        .unwrap_or_else(|e| Err(format!("Sidecar task failed: {e}")));

    Ok(match sidecar_result {
        Ok(mut result) => {
            if result.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                let count = result
                    .get("fonts")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                if let Some(obj) = result.as_object_mut() {
                    obj.insert(
                        "outDir".into(),
                        if download || convert {
                            json!(out_dir.to_string_lossy())
                        } else {
                            Value::Null
                        },
                    );
                }
                emit_to_renderer(
                    &app,
                    "fonts:status",
                    json!({ "status": "done", "url": href, "count": count }),
                );
                result
            } else {
                let error = result
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Scan failed")
                    .to_string();
                emit_to_renderer(
                    &app,
                    "fonts:status",
                    json!({ "status": "error", "url": href, "error": error }),
                );
                result
            }
        }
        Err(error) => {
            emit_to_renderer(
                &app,
                "fonts:status",
                json!({ "status": "error", "url": href, "error": error }),
            );
            json!({ "ok": false, "error": error })
        }
    })
}

#[tauri::command]
pub fn shell_show_item(app: AppHandle, file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path.trim());
    if path.as_os_str().is_empty() || !path.exists() {
        return Ok(());
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn shell_open_path(app: AppHandle, target_path: String) -> Value {
    let path = target_path.trim();
    if path.is_empty() {
        return json!({ "ok": false, "error": "Empty path" });
    }
    match app.opener().open_path(path, None::<&str>) {
        Ok(()) => json!({ "ok": true, "error": null }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}
