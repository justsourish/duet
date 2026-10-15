//! Making new files for an AI tool, anywhere on this computer, with or without Duet open.
//!
//! These two tools are answered by the bridge itself (`duet --mcp-bridge`), so an AI tool can make a
//! design or a picture, sound or video file without Duet running. They only ever make something new:
//! a file that already exists is never replaced.

use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Biggest file an AI can bring in by copying it. Bytes sent inline are held to a smaller limit.
const MAX_COPY: u64 = 500 * 1024 * 1024;
const MAX_INLINE: usize = 20 * 1024 * 1024;

/// What an AI may put in a folder: pictures, sound, video, and the plain files that go with them.
const ALLOWED: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "svg", "mp3", "wav", "m4a", "aac", "ogg", "flac", "mp4", "mov", "webm", "m4v", "md", "txt", "json", "srt", "vtt", "csv",
];

pub const TOOL_NAMES: &[&str] = &["create_design_file", "create_media_file"];

pub fn tools() -> Value {
    json!([
        {
            "name": "create_design_file",
            "description": "Make a new Duet design file (ends in .duet) in any folder on this computer. Works even when Duet is closed. Never replaces a file that already exists. Open it in Duet later to see and change it. Optional `design` is a Duet design as JSON text; leave it out for an empty page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Full path of the new file, or starting with ~. `.duet` is added if missing. Folders are made as needed."},
                    "design": {"type": "string", "description": "Optional. The design as JSON text (version 1)."}
                },
                "required": ["path"]
            }
        },
        {
            "name": "create_media_file",
            "description": "Make a new picture, sound, video or text file in any folder on this computer. Works even when Duet is closed. Never replaces a file that already exists. Give `from_path` to copy a file, `text` for a text or SVG file, or `data_base64` for bytes (up to 20 MB).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Full path of the new file, or starting with ~. Folders are made as needed."},
                    "from_path": {"type": "string", "description": "A file to copy."},
                    "text": {"type": "string", "description": "What to write, for a text, SVG, JSON or Markdown file."},
                    "data_base64": {"type": "string", "description": "The bytes, as base64."}
                },
                "required": ["path"]
            }
        }
    ])
}

fn home() -> Option<PathBuf> {
    std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok().map(PathBuf::from)
}

/// A path the AI gave, made plain and safe, or the reason it cannot be used.
fn safe_path(raw: &str) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("Give a path for the new file.".into());
    }
    let path = match raw.strip_prefix("~/") {
        Some(rest) => home().ok_or("Could not find your home folder.")?.join(rest),
        None => PathBuf::from(raw),
    };
    if !path.is_absolute() {
        return Err("Use a full path, starting with / or ~.".into());
    }
    let mut parts = Vec::new();
    for c in path.components() {
        match c {
            Component::ParentDir => return Err("A path cannot climb out with ..".into()),
            Component::Normal(n) => parts.push(n.to_string_lossy().to_string()),
            _ => {}
        }
    }
    // hidden folders hold other programs' settings and keys; the secret for Duet lives in one
    if parts.iter().any(|p| p.starts_with('.')) {
        return Err("Hidden files and folders are off limits. Choose a normal folder.".into());
    }
    let first = parts.first().map(String::as_str).unwrap_or("");
    if cfg!(unix) && ["System", "usr", "bin", "sbin", "etc", "var", "private", "Library", "Applications", "dev", "proc", "sys", "boot"].contains(&first) {
        return Err("That is a system folder. Choose a folder of your own.".into());
    }
    if parts.is_empty() {
        return Err("Give a path for the new file.".into());
    }
    Ok(path)
}

fn extension(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn prepare(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err(format!("{} already exists. Choose a new name; nothing was changed.", path.display()));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A design given as text must at least look like one. Duet checks it fully when it is opened.
fn check_design(text: &str) -> Result<(), String> {
    let v: Value = serde_json::from_str(text).map_err(|_| "The design is not valid JSON.".to_string())?;
    if v["version"] != 1 || !v["rootIds"].is_array() || !v["elements"].is_object() {
        return Err("The design is not a Duet design (version 1, with rootIds and elements).".into());
    }
    Ok(())
}

pub fn create_design_file(args: &Value) -> Result<String, String> {
    let mut path = safe_path(args["path"].as_str().unwrap_or(""))?;
    if extension(&path) != "duet" {
        path = PathBuf::from(format!("{}.duet", path.to_string_lossy()));
    }
    let design = match args["design"].as_str() {
        Some(text) => {
            check_design(text)?;
            let mut t = text.trim_end().to_string();
            t.push('\n');
            t
        }
        None => "{\n  \"version\": 1,\n  \"rootIds\": [],\n  \"elements\": {}\n}\n".to_string(),
    };
    prepare(&path)?;
    let file = path.to_string_lossy().to_string();
    // the same working folder Duet itself would use, so opening the file later finds nothing odd
    let work = crate::package::work_dir_for_file(&file)?;
    if work.exists() {
        fs::remove_dir_all(&work).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let built = (|| -> Result<(), String> {
        fs::write(work.join("design.json"), design).map_err(|e| e.to_string())?;
        crate::git_commit(work.to_string_lossy().to_string(), "Start of project".into())?;
        crate::package::pack(&work, &path)
    })();
    let _ = fs::remove_dir_all(&work);
    built?;
    Ok(format!("Made {}. Open it in Duet to see it.", path.display()))
}

pub fn create_media_file(args: &Value) -> Result<String, String> {
    let path = safe_path(args["path"].as_str().unwrap_or(""))?;
    let ext = extension(&path);
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!("A .{ext} file is not one an AI can make here. Allowed: {}.", ALLOWED.join(", ")));
    }
    let given = ["from_path", "text", "data_base64"].iter().filter(|k| args[**k].is_string()).count();
    if given != 1 {
        return Err("Give exactly one of from_path, text or data_base64.".into());
    }
    if let Some(from) = args["from_path"].as_str() {
        let from = {
            let p = from.trim();
            match p.strip_prefix("~/") {
                Some(rest) => home().ok_or("Could not find your home folder.")?.join(rest),
                None => PathBuf::from(p),
            }
        };
        let meta = fs::metadata(&from).map_err(|_| format!("Could not find {}.", from.display()))?;
        if !meta.is_file() {
            return Err("from_path must be a file.".into());
        }
        if meta.len() > MAX_COPY {
            return Err("That file is over 500 MB.".into());
        }
        // a file is copied to somewhere new, so the same rule as for the new path keeps secrets out
        let from_safe = safe_path(&from.to_string_lossy())?;
        prepare(&path)?;
        fs::copy(&from_safe, &path).map_err(|e| e.to_string())?;
    } else if let Some(text) = args["text"].as_str() {
        if text.len() > MAX_INLINE {
            return Err("That text is over 20 MB.".into());
        }
        prepare(&path)?;
        fs::write(&path, text).map_err(|e| e.to_string())?;
    } else if let Some(data) = args["data_base64"].as_str() {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|_| "The data was not valid base64.".to_string())?;
        if bytes.len() > MAX_INLINE {
            return Err("That is over 20 MB. Save it somewhere and use from_path.".into());
        }
        prepare(&path)?;
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(format!("Made {}.", path.display()))
}

/// The answer to a call of one of these tools, in the shape MCP expects.
pub fn call(name: &str, args: &Value, id: &Value) -> String {
    let outcome = match name {
        "create_design_file" => create_design_file(args),
        _ => create_media_file(args),
    };
    let (text, is_error) = match outcome {
        Ok(t) => (t, false),
        Err(e) => (e, true),
    };
    json!({"jsonrpc": "2.0", "id": id, "result": {"content": [{"type": "text", "text": text}], "isError": is_error}}).to_string()
}

/// A tool list with these two tools added, if they are not there already.
pub fn add_to_list(answer: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<Value>(answer) else { return answer.to_string() };
    if let Some(list) = v["result"]["tools"].as_array_mut() {
        for t in tools().as_array().cloned().unwrap_or_default() {
            if !list.iter().any(|x| x["name"] == t["name"]) {
                list.push(t);
            }
        }
    }
    v.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        // a Mac's temp folder is under /var, which is rightly off limits, so tests use a plain folder at home
        let d = home().unwrap().join(format!("duet-files-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn refuses_paths_that_are_not_safe() {
        for bad in ["", "relative/file.png", "/tmp/../etc/x.png", "/Users/x/.ssh/key.png", "/etc/x.png", "/System/x.png"] {
            assert!(safe_path(bad).is_err(), "{bad}");
        }
        assert!(safe_path("/tmp/art/a.png").is_ok());
    }

    #[test]
    fn makes_a_media_file_once_and_never_replaces_it() {
        let dir = temp("media");
        let file = dir.join("deep/folder/note.md");
        let args = json!({"path": file.to_string_lossy(), "text": "hello"});
        assert!(create_media_file(&args).is_ok());
        assert_eq!(fs::read_to_string(&file).unwrap(), "hello");
        assert!(create_media_file(&json!({"path": file.to_string_lossy(), "text": "changed"})).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "hello");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copies_and_decodes_and_refuses_odd_files() {
        let dir = temp("copy");
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("a.png");
        fs::write(&src, [1u8, 2, 3]).unwrap();
        let copy = dir.join("out/b.png");
        assert!(create_media_file(&json!({"path": copy.to_string_lossy(), "from_path": src.to_string_lossy()})).is_ok());
        assert_eq!(fs::read(&copy).unwrap(), vec![1, 2, 3]);
        let raw = dir.join("c.wav");
        assert!(create_media_file(&json!({"path": raw.to_string_lossy(), "data_base64": "AQID"})).is_ok());
        assert_eq!(fs::read(&raw).unwrap(), vec![1, 2, 3]);
        assert!(create_media_file(&json!({"path": dir.join("x.exe").to_string_lossy(), "text": "x"})).is_err());
        assert!(create_media_file(&json!({"path": dir.join("y.png").to_string_lossy()})).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_design_must_look_like_one() {
        assert!(check_design("{\"version\":1,\"rootIds\":[],\"elements\":{}}").is_ok());
        assert!(check_design("{\"version\":2}").is_err());
        assert!(check_design("nope").is_err());
    }

    #[test]
    fn adds_its_tools_to_a_list_once() {
        let list = json!({"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "get_context"}]}}).to_string();
        let once = add_to_list(&list);
        let twice = add_to_list(&once);
        let v: Value = serde_json::from_str(&twice).unwrap();
        assert_eq!(v["result"]["tools"].as_array().unwrap().len(), 3);
    }
}
