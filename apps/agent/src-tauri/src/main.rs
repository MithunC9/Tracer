//! Tracer desktop agent: a tray app around tracer-core.
//!
//! - A background thread runs capture -> pipeline -> encrypted buffer -> uploader.
//! - The tray menu shows the status and offers pause/resume, open window, quit.
//! - The settings window (ui/) talks to the commands in commands.rs.
//!
//! Configuration (environment):
//! - TRACER_API_URL: API base URL (default: compile-time TRACER_API_URL, else
//!   http://localhost:4000).
//! - TRACER_SIMULATE_RAW: path to a fixtures raw.jsonl; replays it in real time instead of
//!   observing this Mac (demo mode; uploads are labelled platform "simulated").

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WindowEvent, Wry};
use tracer_core::agent::{Agent, Mode};
use tracer_core::api::{ApiClient, AGENT_VERSION};
use tracer_core::buffer::Store;
use tracer_core::capture::{self, CaptureSource, SimulatedOptions, SimulatedSource, SourcePoll, TimeShift};
use tracer_core::model::Platform;
use tracer_core::secrets::{self, SecretStore};
use tracer_core::{pairing, AgentStatus};

pub struct AppState {
    pub agent: Mutex<Agent>,
    pub secrets: Box<dyn SecretStore>,
    pub api_base: String,
    pub platform: Platform,
    pub simulate: Option<PathBuf>,
    pub capture_error: Mutex<Option<String>>,
}

struct TrayItems {
    status: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
}

fn api_base() -> String {
    std::env::var("TRACER_API_URL")
        .ok()
        .or_else(|| option_env!("TRACER_API_URL").map(String::from))
        .unwrap_or_else(|| "http://localhost:4000".into())
}

fn init_state(app: &AppHandle) -> Result<AppState, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let simulate = std::env::var_os("TRACER_SIMULATE_RAW").map(PathBuf::from);
    let platform = if simulate.is_some() {
        Platform::Simulated
    } else if cfg!(target_os = "macos") {
        Platform::Macos
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Linux
    };
    let secrets = secrets::default_store(&data_dir, simulate.is_some())?;
    let store = Store::open_in(&data_dir, secrets.as_ref())?;
    let base = api_base();
    let api = match pairing::load_token(secrets.as_ref())? {
        Some(t) => Some(ApiClient::new(&base, Some(t))?),
        None => None,
    };
    let agent = Agent::new(store, api, platform, AGENT_VERSION)?;
    Ok(AppState { agent: Mutex::new(agent), secrets, api_base: base, platform, simulate, capture_error: Mutex::new(None) })
}

fn make_source(state: &AppState, idle_threshold: u32) -> Result<Box<dyn CaptureSource>, String> {
    match &state.simulate {
        Some(path) => SimulatedSource::from_file(
            path,
            SimulatedOptions { speed: 1.0, time_shift: TimeShift::ToNow, chunk: 1000 },
        )
        .map(|s| Box::new(s) as Box<dyn CaptureSource>)
        .map_err(|e| e.to_string()),
        None => capture::platform_source(idle_threshold).map_err(|e| e.to_string()),
    }
}

fn tray_text(s: &AgentStatus) -> String {
    let day = match (s.day_number, s.total_days) {
        (Some(d), Some(t)) => format!("Day {d} of {t} · "),
        _ => String::new(),
    };
    let mode = match s.mode {
        Mode::Capturing => "Observing",
        Mode::Paused => "Paused",
        Mode::AutoStopped => "Finished",
        Mode::Stopped => "Stopped",
        Mode::Idle if s.paired => "Waiting for audit",
        Mode::Idle => "Not paired",
    };
    format!("{day}{mode}")
}

/// The capture loop. The source is only polled while capturing, so nothing is even read
/// from the screen while paused, stopped or after the audit window ends.
fn capture_loop(app: AppHandle) {
    let mut source: Option<Box<dyn CaptureSource>> = None;
    let mut last_tray = Instant::now() - Duration::from_secs(60);
    loop {
        let state = app.state::<AppState>();
        let (mode, exclusions, idle_threshold) = {
            let a = state.agent.lock().expect("agent lock");
            (a.mode(), a.state().exclusions.clone(), a.state().idle_threshold_seconds)
        };
        if mode == Mode::Capturing {
            if source.is_none() {
                match make_source(&state, idle_threshold) {
                    Ok(s) => {
                        source = Some(s);
                        *state.capture_error.lock().expect("lock") = None;
                    }
                    Err(e) => {
                        log::error!("capture unavailable: {e}");
                        *state.capture_error.lock().expect("lock") = Some(e);
                    }
                }
            }
            if let Some(src) = source.as_mut() {
                src.set_exclusions(&exclusions);
                src.set_idle_threshold(idle_threshold);
                match src.next_samples(Duration::from_secs(1)) {
                    Ok(SourcePoll::Samples(v)) => {
                        if let Err(e) = state.agent.lock().expect("agent lock").ingest(&v) {
                            log::error!("storing events failed: {e}");
                        }
                    }
                    Ok(SourcePoll::Idle) => {}
                    Ok(SourcePoll::Exhausted) => {
                        let mut a = state.agent.lock().expect("agent lock");
                        let _ = a.stop(Utc::now(), "replay finished");
                        source = None;
                    }
                    Err(e) => {
                        log::error!("capture error: {e}");
                        source = None;
                        std::thread::sleep(Duration::from_secs(5));
                    }
                }
            } else {
                std::thread::sleep(Duration::from_secs(10));
            }
        } else {
            source = None;
            std::thread::sleep(Duration::from_secs(1));
        }

        let status = {
            let mut a = state.agent.lock().expect("agent lock");
            if let Err(e) = a.tick(Utc::now()) {
                log::warn!("tick: {e}");
            }
            a.status().ok()
        };
        if last_tray.elapsed() >= Duration::from_secs(5) {
            last_tray = Instant::now();
            if let (Some(s), Some(items)) = (status, app.try_state::<TrayItems>()) {
                let _ = items.status.set_text(tray_text(&s));
                let _ = items.toggle.set_text(if s.mode == Mode::Paused { "Resume" } else { "Pause" });
                let _ = items.toggle.set_enabled(matches!(s.mode, Mode::Capturing | Mode::Paused));
            }
        }
    }
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let state = init_state(app.handle())?;
            let first_run = !state.agent.lock().expect("agent lock").status().map(|s| s.paired).unwrap_or(false);
            app.manage(state);

            let status = MenuItem::with_id(app, "status", "Starting…", false, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Pause", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Tracer…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Tracer", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&status, &sep1, &toggle, &open, &sep2, &quit])?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("tracer")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("Tracer")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => {
                        let state = app.state::<AppState>();
                        let mut a = state.agent.lock().expect("agent lock");
                        let res = if a.mode() == Mode::Paused {
                            a.resume(Utc::now())
                        } else {
                            a.pause(Utc::now(), Some("paused from the menu bar"))
                        };
                        if let Err(e) = res {
                            log::error!("pause/resume: {e}");
                        }
                    }
                    "open" => show_window(app),
                    // Pending events stay encrypted on disk and upload on next launch.
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            app.manage(TrayItems { status, toggle });

            let handle = app.handle().clone();
            std::thread::Builder::new().name("tracer-capture".into()).spawn(move || capture_loop(handle))?;
            if first_run {
                show_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the agent in the menu bar.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::status,
            commands::pause,
            commands::resume,
            commands::today,
            commands::get_exclusions,
            commands::set_exclusions,
            commands::delete_everything,
            commands::pair,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tracer");
}
