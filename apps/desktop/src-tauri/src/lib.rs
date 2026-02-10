use std::error::Error;
use std::net::TcpListener;
use tauri::Manager;

mod crypto;

/// Application state shared across the Tauri app.
pub struct AppState {
    pub port: u16,
    pub secret: String,
}

/// Find an available port on localhost.
fn find_available_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to any port")
        .local_addr()
        .expect("Failed to get local address")
        .port()
}

/// Spawn the Bun sidecar server process.
fn spawn_sidecar(
    app: &tauri::AppHandle,
    port: u16,
    secret: &str,
) -> Result<(), Box<dyn Error>> {
    use tauri_plugin_shell::ShellExt;

    let _child = app
        .shell()
        .sidecar("coding-assistant-server")
        .expect("failed to find sidecar binary")
        .env("PORT", port.to_string())
        .env("AUTH_SECRET", secret)
        .env("HOST", "127.0.0.1")
        .spawn()
        .expect("Failed to spawn sidecar");

    println!("[tauri] Sidecar spawned on port {}", port);
    Ok(())
}

/// Tauri command: get the server URL.
#[tauri::command]
fn get_server_url(state: tauri::State<'_, AppState>) -> String {
    format!("http://127.0.0.1:{}", state.port)
}

/// Tauri command: get the auth token.
#[tauri::command]
fn get_auth_token(state: tauri::State<'_, AppState>) -> String {
    state.secret.clone()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let port = find_available_port();
            let secret = crypto::generate_secret();

            let state = AppState {
                port,
                secret: secret.clone(),
            };

            app.manage(state);

            // Spawn the sidecar in production
            #[cfg(not(debug_assertions))]
            {
                let handle = app.handle().clone();
                spawn_sidecar(&handle, port, &secret)?;
            }

            println!("[tauri] App initialized. Port: {}, Secret: {}...", port, &secret[..8]);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_server_url, get_auth_token])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
