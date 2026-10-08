//! The bridge between Duet and AI agents.
//!
//! 1. A small web server on this computer only (127.0.0.1) speaks MCP, so any agent can read
//!    and change the design with the same commands the interface uses. A secret token guards it.
//! 2. A runner starts the agent tool the user already has (for now Claude Code), streams what it
//!    says back to the chat, and can stop it.
//!
//! The design itself lives in the interface. Requests from agents are handed to it and the
//! answer is sent back, so the interface stays the single owner of the document.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// How long an agent request may wait for the designer (for example, to approve something).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(330);

pub struct McpState {
    port: u16,
    token: String,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Sender<String>>>,
}

#[derive(Default)]
pub struct AgentState {
    child: Mutex<Option<Child>>,
}

fn json_header() -> tiny_http::Header {
    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap()
}

fn respond(req: tiny_http::Request, code: u16, body: &str) {
    let resp = tiny_http::Response::from_string(body)
        .with_status_code(code)
        .with_header(json_header());
    let _ = req.respond(resp);
}

fn rpc_error(id: &Value, code: i64, message: &str) -> String {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}).to_string()
}

fn handle(mut req: tiny_http::Request, state: Arc<McpState>, app: AppHandle) {
    if req.url() != "/mcp" {
        return respond(req, 404, "{}");
    }
    let expected = format!("Bearer {}", state.token);
    let authorised = req
        .headers()
        .iter()
        .any(|h| h.field.equiv("Authorization") && h.value.as_str() == expected);
    if !authorised {
        return respond(req, 401, "{\"error\":\"unauthorised\"}");
    }
    if req.method() != &tiny_http::Method::Post {
        // We do not offer a server-to-agent event stream.
        return respond(req, 405, "{\"error\":\"use POST\"}");
    }
    let mut body = String::new();
    if req.as_reader().read_to_string(&mut body).is_err() {
        return respond(req, 400, "{}");
    }
    let parsed: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return respond(req, 400, &rpc_error(&Value::Null, -32700, "Parse error")),
    };
    // Notifications carry no id and expect no answer.
    let Some(rpc_id) = parsed.get("id").cloned() else {
        let _ = req.respond(tiny_http::Response::empty(202));
        return;
    };

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel::<String>();
    state.pending.lock().unwrap().insert(id, tx);
    if app.emit("mcp-request", json!({"id": id, "body": parsed})).is_err() {
        state.pending.lock().unwrap().remove(&id);
        return respond(req, 500, &rpc_error(&rpc_id, -32603, "Duet is not ready"));
    }
    match rx.recv_timeout(REQUEST_TIMEOUT) {
        Ok(answer) => respond(req, 200, &answer),
        Err(_) => {
            state.pending.lock().unwrap().remove(&id);
            respond(req, 200, &rpc_error(&rpc_id, -32001, "Timed out waiting for Duet"));
        }
    }
}

/// Leave the address and secret in ~/.duet/session.json, readable only by this user,
/// so tools on this computer (and tests) can find the running Duet.
fn write_session_file(port: u16, token: &str) {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE"));
    let Ok(home) = home else { return };
    let dir = std::path::Path::new(&home).join(".duet");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = dir.join("session.json");
    let body = json!({"port": port, "token": token}).to_string();
    if std::fs::write(&file, body).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
        }
    }
}

/// Start the local server. Called once when the app starts.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("no port")?;
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let state = Arc::new(McpState {
        port,
        token,
        next_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
    });
    write_session_file(port, &state.token);
    app.manage(state.clone());
    app.manage(AgentState::default());
    let app = app.clone();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let state = state.clone();
            let app = app.clone();
            std::thread::spawn(move || handle(req, state, app));
        }
    });
    Ok(())
}

/// Address and secret for agents to connect with.
#[tauri::command]
pub fn mcp_info(state: State<Arc<McpState>>) -> Value {
    json!({"port": state.port, "token": state.token})
}

/// The interface answers a request that an agent made.
#[tauri::command]
pub fn mcp_reply(state: State<Arc<McpState>>, id: u64, response: String) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(response);
    }
}

#[cfg(unix)]
fn shell_command(program: &str, args: &[String]) -> Command {
    // Apps opened from the Dock do not get the terminal's PATH. Going through a login shell
    // finds tools the same way the terminal does.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut c = Command::new(shell);
    c.arg("-ilc").arg("exec \"$0\" \"$@\"").arg(program).args(args);
    c
}

#[cfg(windows)]
fn shell_command(program: &str, args: &[String]) -> Command {
    let mut c = Command::new("cmd");
    c.arg("/C").arg(program).args(args);
    c
}

/// Tools Duet can look for.
fn known(program: &str) -> bool {
    matches!(program, "claude" | "gemini" | "agy" | "codex" | "opencode")
}

/// Tools Duet knows how to drive.
fn supported(program: &str) -> bool {
    matches!(program, "claude" | "gemini")
}

/// Is this agent tool installed on this computer?
#[tauri::command]
pub fn agent_available(program: String) -> bool {
    if !known(&program) {
        return false;
    }
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        Command::new(shell)
            .args(["-ilc", "command -v \"$0\"", &program])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        Command::new("where")
            .arg(&program)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

/// Put the agent's instructions and connection details in files, so nothing tricky has to be
/// squeezed through a command line (quotes and line breaks break differently on every system).
/// The connection file holds the secret token, so only this user may read it.
#[tauri::command]
pub fn write_agent_files(system: String, mcp: String) -> Result<Value, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find your home folder.".to_string())?;
    let dir = std::path::Path::new(&home).join(".duet").join("agent-workspace");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let write = |name: &str, body: &str| -> Result<String, String> {
        let file = dir.join(name);
        std::fs::write(&file, body).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
        }
        Ok(file.to_string_lossy().to_string())
    };
    Ok(json!({"system": write("system.md", &system)?, "mcp": write("mcp.json", &mcp)?}))
}

/// Write one file inside Duet's agent workspace (for tools that read their settings from the
/// folder they run in). Only plain relative paths are accepted, so nothing can escape the workspace.
#[tauri::command]
pub fn write_agent_file(name: String, body: String) -> Result<String, String> {
    let rel = std::path::Path::new(&name);
    let plain = !name.is_empty()
        && rel.is_relative()
        && rel.components().all(|c| matches!(c, std::path::Component::Normal(_)));
    if !plain {
        return Err("That file name is not allowed.".to_string());
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find your home folder.".to_string())?;
    let file = std::path::Path::new(&home).join(".duet").join("agent-workspace").join(rel);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(file.to_string_lossy().to_string())
}

/// Start the agent. Its output arrives as `agent-line` events, and `agent-exit` ends the run.
#[tauri::command]
pub fn agent_run(
    app: AppHandle,
    state: State<AgentState>,
    program: String,
    args: Vec<String>,
    input: String,
    cwd: Option<String>,
) -> Result<(), String> {
    if !supported(&program) {
        return Err(format!("{program} is not supported yet."));
    }
    if state.child.lock().unwrap().is_some() {
        return Err("Duet is already working on something.".to_string());
    }
    let mut cmd = shell_command(&program, &args);
    if let Some(dir) = cwd {
        let _ = std::fs::create_dir_all(&dir);
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Could not start {program}: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    *state.child.lock().unwrap() = Some(child);

    if let Some(err) = stderr {
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                let _ = app.emit("agent-stderr", line);
            }
        });
    }
    std::thread::spawn(move || {
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = app.emit("agent-line", line);
            }
        }
        let code = {
            let state = app.state::<AgentState>();
            let child = state.child.lock().unwrap().take();
            match child {
                Some(mut c) => c.wait().ok().and_then(|s| s.code()),
                None => None,
            }
        };
        let _ = app.emit("agent-exit", code);
    });
    Ok(())
}

/// Stop the agent mid-task.
#[tauri::command]
pub fn agent_cancel(state: State<AgentState>) {
    if let Some(child) = state.child.lock().unwrap().as_mut() {
        let _ = child.kill();
    }
}
