//! Commands exposed to the settings UI (ui/src/adapter.ts). Every command works on local
//! state only, except `pair` (which calls POST /v1/devices/pair) and the config refresh
//! that follows it.

use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tracer_core::api::ApiClient;
use tracer_core::model::Exclusions;
use tracer_core::{pairing, AgentStatus, TodayView};

use crate::AppState;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn status(state: State<'_, AppState>) -> Result<AgentStatus, String> {
    state.agent.lock().map_err(err)?.status().map_err(err)
}

#[tauri::command]
pub fn pause(state: State<'_, AppState>) -> Result<AgentStatus, String> {
    let mut a = state.agent.lock().map_err(err)?;
    a.pause(Utc::now(), Some("paused on this computer")).map_err(err)?;
    a.status().map_err(err)
}

#[tauri::command]
pub fn resume(state: State<'_, AppState>) -> Result<AgentStatus, String> {
    let mut a = state.agent.lock().map_err(err)?;
    a.resume(Utc::now()).map_err(err)?;
    a.status().map_err(err)
}

#[tauri::command]
pub fn today(state: State<'_, AppState>) -> Result<TodayView, String> {
    state.agent.lock().map_err(err)?.today().map_err(err)
}

#[tauri::command]
pub fn get_exclusions(state: State<'_, AppState>) -> Result<Exclusions, String> {
    Ok(state.agent.lock().map_err(err)?.state().exclusions.clone())
}

/// Local exclusions apply immediately on this device. (The server copy is edited on the
/// web; the next config poll replaces the local list with the server's.)
#[tauri::command]
pub fn set_exclusions(state: State<'_, AppState>, exclusions: Exclusions) -> Result<Exclusions, String> {
    let mut a = state.agent.lock().map_err(err)?;
    a.set_exclusions(exclusions).map_err(err)?;
    Ok(a.state().exclusions.clone())
}

/// Deletes everything stored locally, including the device token. Calls nothing
/// server-side.
#[tauri::command]
pub fn delete_everything(state: State<'_, AppState>) -> Result<(), String> {
    let mut a = state.agent.lock().map_err(err)?;
    a.delete_everything().map_err(err)?;
    a.set_api(None);
    state.secrets.delete(tracer_core::secrets::DEVICE_TOKEN).map_err(err)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairResult {
    device_id: String,
}

/// Async + spawn_blocking: the blocking HTTP call must not run on the UI thread.
#[tauri::command]
pub async fn pair(app: AppHandle, code: String, device_name: String) -> Result<PairResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut api = ApiClient::new(&state.api_base, None).map_err(err)?;
        let resp = pairing::pair(&mut api, state.secrets.as_ref(), &code, &device_name, state.platform).map_err(err)?;
        let mut a = state.agent.lock().map_err(err)?;
        a.set_api(Some(api));
        a.set_device_id(resp.device_id).map_err(err)?;
        if let Err(e) = a.poll_config(Utc::now()) {
            log::warn!("config fetch after pairing failed: {e}");
        }
        Ok(PairResult { device_id: resp.device_id.to_string() })
    })
    .await
    .map_err(err)?
}
