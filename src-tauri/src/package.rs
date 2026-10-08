//! A Duet project as one file.
//!
//! A `.duet` file is a zip holding everything a project is: the design, its pictures, its preview and
//! its whole history. While you work, Duet keeps an unpacked copy in its own folder (~/.duet/work), and
//! packs it back into your file every time you save. Nothing about the history or the design changes.

use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn work_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find your home folder.".to_string())?;
    let dir = Path::new(&home).join(".duet").join("work");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// The working folder for a project file. The same file always gets the same folder.
pub fn work_dir_for_file(file: &str) -> Result<PathBuf, String> {
    let mut h = DefaultHasher::new();
    file.hash(&mut h);
    let name = Path::new(file).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "project".into());
    let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    Ok(work_root()?.join(format!("{safe}-{:016x}", h.finish())))
}

fn already_compressed(name: &str) -> bool {
    let n = name.to_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip"].iter().any(|e| n.ends_with(e)) || n.contains("/objects/pack/")
}

fn add_dir(zip: &mut ZipWriter<File>, root: &Path, dir: &Path) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(err)?.flatten() {
        let path = entry.path();
        let rel = path.strip_prefix(root).map_err(err)?.to_string_lossy().replace('\\', "/");
        if rel.ends_with(".tmp") {
            continue;
        }
        if path.is_dir() {
            zip.add_directory(format!("{rel}/"), SimpleFileOptions::default()).map_err(err)?;
            add_dir(zip, root, &path)?;
        } else {
            let method = if already_compressed(&rel) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
            zip.start_file(rel, SimpleFileOptions::default().compression_method(method)).map_err(err)?;
            let mut f = File::open(&path).map_err(err)?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(err)?;
            zip.write_all(&buf).map_err(err)?;
        }
    }
    Ok(())
}

/// Pack a project folder into one file. Written beside it first, then swapped in, so a crash never
/// leaves half a file behind.
pub fn pack(dir: &Path, file: &Path) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = PathBuf::from(format!("{}.tmp", file.to_string_lossy()));
    {
        let out = File::create(&tmp).map_err(err)?;
        let mut zip = ZipWriter::new(out);
        add_dir(&mut zip, dir, dir)?;
        zip.finish().map_err(err)?;
    }
    fs::rename(&tmp, file).map_err(err)
}

/// Unpack a project file into a folder, replacing what was there. Names that try to climb out of the
/// folder are refused.
pub fn unpack(file: &Path, dir: &Path) -> Result<(), String> {
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(err)?;
    }
    fs::create_dir_all(dir).map_err(err)?;
    let mut zip = ZipArchive::new(File::open(file).map_err(|e| format!("Could not open {}: {e}", file.display()))?).map_err(|_| "That file is not a Duet project.".to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(err)?;
        let Some(rel) = entry.enclosed_name() else { continue };
        let target = dir.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(err)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(err)?;
            }
            let mut out = File::create(&target).map_err(err)?;
            std::io::copy(&mut entry, &mut out).map_err(err)?;
        }
    }
    if !dir.join("design.json").is_file() {
        return Err("That file is not a Duet project.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("duet-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_project_survives_packing_and_unpacking() {
        let src = temp("src");
        fs::write(src.join("design.json"), "{\"version\":1}").unwrap();
        fs::create_dir_all(src.join("assets")).unwrap();
        fs::write(src.join("assets/pic.png"), [1u8, 2, 3, 4]).unwrap();
        fs::create_dir_all(src.join(".git/objects")).unwrap();
        fs::write(src.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let file = temp("out").join("p.duet");
        pack(&src, &file).unwrap();
        let back = temp("back");
        unpack(&file, &back).unwrap();
        assert_eq!(fs::read_to_string(back.join("design.json")).unwrap(), "{\"version\":1}");
        assert_eq!(fs::read(back.join("assets/pic.png")).unwrap(), vec![1u8, 2, 3, 4]);
        assert_eq!(fs::read_to_string(back.join(".git/HEAD")).unwrap(), "ref: refs/heads/main\n");
    }

    #[test]
    fn a_file_that_is_not_a_project_is_refused() {
        let junk = temp("junk").join("x.duet");
        fs::write(&junk, "hello").unwrap();
        assert!(unpack(&junk, &temp("dest")).is_err());
        // a zip with no design in it is refused too
        let src = temp("empty");
        fs::write(src.join("readme.txt"), "hi").unwrap();
        let f = temp("o2").join("e.duet");
        pack(&src, &f).unwrap();
        assert!(unpack(&f, &temp("dest2")).is_err());
    }

    #[test]
    fn the_same_file_always_gets_the_same_working_folder() {
        let a = work_dir_for_file("/a/b/Burger Barn.duet").unwrap();
        let b = work_dir_for_file("/a/b/Burger Barn.duet").unwrap();
        let c = work_dir_for_file("/a/c/Burger Barn.duet").unwrap();
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
}
