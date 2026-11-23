// Prevents a console window from appearing alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // Each plugin here corresponds to one capability in
        // capabilities/default.json; adding a plugin without the matching
        // permission leaves it inert, and the reverse is a right granted for
        // nothing.
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        // No capability entry for this one on purpose: the Rust side saves and
        // restores on its own, and the JS API — the part that would need a
        // permission — is not used.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running Prizma");
}
