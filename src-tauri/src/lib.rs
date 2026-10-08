use git2::{Repository, Signature};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------- files ----------

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

// ---------- history ----------
// Git runs inside the app (libgit2), so designers never need to install it.
// The words "commit" and "tag" never reach the interface.

const DESIGN_FILE: &str = "design.json";

fn open_or_init(path: &str) -> Result<Repository, String> {
    match Repository::open(path) {
        Ok(r) => Ok(r),
        Err(_) => Repository::init(path).map_err(err),
    }
}

fn signature(repo: &Repository) -> Result<Signature<'static>, String> {
    match repo.signature() {
        Ok(s) => Ok(s.to_owned()),
        Err(_) => Signature::now("Duet", "duet@localhost").map_err(err),
    }
}

/// Make sure the project folder has a history store.
#[tauri::command]
fn git_prepare(path: String) -> Result<(), String> {
    open_or_init(&path).map(|_| ())
}

/// Record the current design.json as a new step. Returns false if nothing changed.
#[tauri::command]
fn git_commit(path: String, message: String) -> Result<bool, String> {
    let repo = open_or_init(&path)?;
    let mut index = repo.index().map_err(err)?;
    index.add_path(Path::new(DESIGN_FILE)).map_err(err)?;
    index.write().map_err(err)?;
    let tree_id = index.write_tree().map_err(err)?;
    let tree = repo.find_tree(tree_id).map_err(err)?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if let Some(p) = &parent {
        if p.tree_id() == tree_id {
            return Ok(false);
        }
    }
    let sig = signature(&repo)?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(err)?;
    Ok(true)
}

#[derive(Serialize)]
struct HistoryItem {
    hash: String,
    time: i64,
    label: String,
    actor: String,
    doc: String,
    versions: Vec<String>,
}

/// The saved steps of a project, oldest first, each with the design as it was then.
#[tauri::command]
fn git_history(path: String, limit: usize) -> Result<Vec<HistoryItem>, String> {
    let repo = match Repository::open(&path) {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };
    if repo.head().is_err() {
        return Ok(vec![]);
    }

    // named versions, keyed by the commit they point at
    let mut named: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    let names = repo.tag_names(None).map_err(err)?;
    for raw in names.iter_bytes() {
        let name = String::from_utf8_lossy(raw).to_string();
        let reference = match repo.find_reference(&format!("refs/tags/{name}")) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let commit = match reference.peel_to_commit() {
            Ok(c) => c,
            Err(_) => continue,
        };
        let title = reference
            .peel_to_tag()
            .ok()
            .and_then(|t| t.message().ok().flatten().map(|m| m.trim().to_string()))
            .unwrap_or_else(|| name.clone());
        named.entry(commit.id()).or_default().push(title);
    }

    let mut walk = repo.revwalk().map_err(err)?;
    walk.push_head().map_err(err)?;
    walk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)
        .map_err(err)?;

    let mut items = Vec::new();
    for oid in walk.take(limit) {
        let oid = oid.map_err(err)?;
        let commit = repo.find_commit(oid).map_err(err)?;
        let message = commit.message().unwrap_or("").to_string();
        let mut lines = message.lines();
        let label = lines.next().unwrap_or("").trim().to_string();
        let actor = if message.lines().any(|l| l.trim() == "Actor: ai") {
            "ai"
        } else {
            "you"
        };
        let tree = commit.tree().map_err(err)?;
        let entry = match tree.get_path(Path::new(DESIGN_FILE)) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let blob = match entry.to_object(&repo).and_then(|o| o.peel_to_blob()) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let doc = String::from_utf8_lossy(blob.content()).to_string();
        items.push(HistoryItem {
            hash: oid.to_string(),
            time: commit.time().seconds(),
            label,
            actor: actor.to_string(),
            doc,
            versions: named.get(&oid).cloned().unwrap_or_default(),
        });
    }
    items.reverse();
    Ok(items)
}

/// Give the latest saved step a name, like "Client round 1".
#[tauri::command]
fn git_name_version(path: String, tag: String, title: String) -> Result<(), String> {
    let repo = open_or_init(&path)?;
    let target = repo
        .head()
        .map_err(err)?
        .peel(git2::ObjectType::Commit)
        .map_err(err)?;
    let sig = signature(&repo)?;
    repo.tag(&tag, &target, &sig, &title, false)
        .map_err(err)?;
    Ok(())
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
            make_dir,
            git_prepare,
            git_commit,
            git_history,
            git_name_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running Duet");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("duet-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().to_string()
    }

    fn write(path: &str, text: &str) {
        write_text_file(format!("{path}/design.json"), text.to_string()).unwrap();
    }

    #[test]
    fn keeps_steps_and_who_made_them() {
        let p = project("steps");
        write(&p, "{\"n\":1}");
        git_prepare(p.clone()).unwrap();
        assert!(git_commit(p.clone(), "Start of project\n\nActor: you".into()).unwrap());
        write(&p, "{\"n\":2}");
        assert!(git_commit(p.clone(), "Add rectangle\n\nActor: ai".into()).unwrap());

        let h = git_history(p.clone(), 50).unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].label, "Start of project");
        assert_eq!(h[0].actor, "you");
        assert_eq!(h[0].doc, "{\"n\":1}");
        assert_eq!(h[1].label, "Add rectangle");
        assert_eq!(h[1].actor, "ai");
        assert_eq!(h[1].doc, "{\"n\":2}");
    }

    #[test]
    fn does_not_record_an_unchanged_design() {
        let p = project("same");
        write(&p, "{}");
        assert!(git_commit(p.clone(), "one".into()).unwrap());
        assert!(!git_commit(p.clone(), "two".into()).unwrap());
        assert_eq!(git_history(p, 50).unwrap().len(), 1);
    }

    #[test]
    fn names_a_version_and_finds_it_again() {
        let p = project("version");
        write(&p, "{\"n\":1}");
        git_commit(p.clone(), "first".into()).unwrap();
        git_name_version(p.clone(), "v1-client-round-1".into(), "Client round 1".into()).unwrap();
        write(&p, "{\"n\":2}");
        git_commit(p.clone(), "second".into()).unwrap();

        let h = git_history(p, 50).unwrap();
        assert_eq!(h[0].versions, vec!["Client round 1".to_string()]);
        assert!(h[1].versions.is_empty());
    }

    #[test]
    fn empty_project_has_no_history() {
        let p = project("empty");
        assert!(git_history(p.clone(), 10).unwrap().is_empty());
        git_prepare(p.clone()).unwrap();
        assert!(git_history(p, 10).unwrap().is_empty());
    }

    #[test]
    fn writes_files_without_leaving_temp_files() {
        let p = project("atomic");
        write(&p, "hello");
        assert_eq!(read_text_file(format!("{p}/design.json")).unwrap(), "hello");
        assert!(!Path::new(&format!("{p}/design.json.tmp")).exists());
    }
}
