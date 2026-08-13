mod commands;

use std::collections::HashMap;

use serde_json::json;
use tauri_tray_base::{
    apply_window_settings, install_state, setup_tray, sync_autostart, TrayBaseOptions,
    TraySetupOptions,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri_tray_base::with_common_plugins(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            tauri_tray_base::settings_get,
            tauri_tray_base::settings_set,
            tauri_tray_base::app_get_state,
            commands::dialog_pick_folder,
            commands::fonts_scan,
            commands::shell_show_item,
            commands::shell_open_path,
        ])
        .setup(move |app| {
            let mut defaults = HashMap::new();
            defaults.insert("opacity".into(), json!(1.0));
            defaults.insert("alwaysOnTop".into(), json!(false));
            defaults.insert("startMinimised".into(), json!(false));
            defaults.insert("outDir".into(), json!(""));
            defaults.insert("mode".into(), json!("convert"));
            defaults.insert("timeoutMs".into(), json!(30000));
            defaults.insert("recentUrls".into(), json!([]));

            install_state(
                app.handle(),
                TrayBaseOptions {
                    app_name: "Font Checker".into(),
                    settings_file_name: "font-checker-settings.json".into(),
                    defaults,
                    ..Default::default()
                },
            )?;

            setup_tray(app.handle(), TraySetupOptions::default())?;
            apply_window_settings(app.handle());
            sync_autostart(app.handle());

            Ok(())
        })
        .on_window_event(|window, event| {
            tauri_tray_base::on_window_event(window, event);
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running font-checker");
}
