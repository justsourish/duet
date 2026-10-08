use std::fs;
use std::path::Path;

/// Read a UTF-8 text file. Used to open a project's design.json.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Write a text file safely: write to a temp file next to it, then rename.
/// A crash mid-save can never leave a half-written design behind.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create folder: {e}"))?;
    }
    let tmp = format!("{path}.tmp");
    fs::write(&tmp, contents).map_err(|e| format!("Could not write {path}: {e}"))?;
    fs::rename(&tmp, target).map_err(|e| format!("Could not save {path}: {e}"))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Could not create {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            path_exists,
            make_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running Duet");
}
