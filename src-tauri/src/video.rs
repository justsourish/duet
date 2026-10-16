//! Cutting video: read what a clip is, and join trimmed clips into one file.
//! The work is done by ffmpeg. Duet carries its own copy next to the app; one installed on the
//! computer is used only when that copy is missing (as while Duet is being built).

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// Where a tool such as ffmpeg lives. An app started from the Dock does not get the folders a terminal knows.
fn find(program: &str) -> Option<PathBuf> {
    // the copy that ships with Duet sits next to the app itself
    let mut dirs: Vec<PathBuf> = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.to_path_buf())).into_iter().collect();
    dirs.extend(std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default());
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(d.into());
    }
    let names = if cfg!(windows) { vec![format!("{program}.exe")] } else { vec![program.to_string()] };
    dirs.iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file())
}

const MISSING: &str = "Cutting video needs ffmpeg on this computer. Install it, then open Duet again.";

/// The H.264 encoder settings for a finished video. The ffmpeg that ships with Duet uses the computer's
/// own video chip; a full ffmpeg installed for development may have x264, which is used when present.
/// `quality` is on ffmpeg's crf scale: lower is finer.
fn h264(quality: u32) -> Vec<String> {
    static HAS_X264: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let x264 = *HAS_X264.get_or_init(|| {
        find("ffmpeg")
            .and_then(|f| Command::new(f).args(["-hide_banner", "-encoders"]).output().ok())
            .is_some_and(|o| String::from_utf8_lossy(&o.stdout).contains("libx264"))
    });
    let crf = quality.clamp(10, 34);
    // the chip's own 1 to 100 quality scale, higher is finer
    let q = (100 - crf * 2).to_string();
    let args: Vec<&str> = if x264 {
        return ["-c:v", "libx264", "-preset", "veryfast", "-crf"].iter().map(|s| s.to_string()).chain([crf.to_string()]).collect();
    } else if cfg!(target_os = "macos") {
        vec!["-c:v", "h264_videotoolbox", "-q:v", &q]
    } else if cfg!(windows) {
        vec!["-c:v", "h264_mf", "-rate_control", "quality", "-quality", &q]
    } else {
        vec!["-c:v", "libx264", "-crf", "20"]
    };
    args.into_iter().map(String::from).collect()
}

/// True when this computer has what cutting video needs.
#[tauri::command]
pub fn video_ready() -> bool {
    find("ffmpeg").is_some()
}

#[derive(Serialize)]
pub struct VideoInfo {
    /// Seconds.
    duration: f64,
    width: u32,
    height: u32,
    sound: bool,
}

fn probe(path: &str) -> Result<VideoInfo, String> {
    let text = describe(path)?;
    parse_info(&text).ok_or_else(|| "That file has no picture in it.".to_string())
}

/// What ffmpeg says about a file when asked to read it and do nothing else. Only ffmpeg ships with
/// Duet, so this stands in for a separate probing tool.
fn describe(path: &str) -> Result<String, String> {
    let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
    let out = Command::new(ffmpeg).args(["-hide_banner", "-i", path]).output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stderr).to_string();
    if !text.contains("Stream #") {
        return Err("That file could not be read as a video.".into());
    }
    Ok(text)
}

/// Length, picture size and sound, read from ffmpeg's description of a file.
fn parse_info(text: &str) -> Option<VideoInfo> {
    let duration = text.split("Duration: ").nth(1).and_then(|r| r.split(',').next()).and_then(|t| {
        let parts: Vec<f64> = t.trim().split(':').filter_map(|p| p.parse().ok()).collect();
        (parts.len() == 3).then(|| parts[0] * 3600.0 + parts[1] * 60.0 + parts[2])
    });
    let picture = text.lines().find(|l| l.contains("Stream #") && l.contains("Video:") && !l.contains("attached pic"))?;
    // the size is the first "wide x high" pair of plain numbers on the picture line
    let (mut width, mut height) = picture
        .split(|c: char| c == ',' || c == ' ')
        .find_map(|w| {
            let (a, b) = w.split_once('x')?;
            Some((a.parse::<u32>().ok()?, b.parse::<u32>().ok()?))
        })?;
    // a phone clip filmed upright is stored on its side with a note to turn it
    let turned = text
        .split("rotation of ")
        .nth(1)
        .and_then(|r| r.split_whitespace().next())
        .and_then(|n| n.parse::<f64>().ok())
        .unwrap_or(0.0);
    if (turned.abs().round() as i64) % 180 == 90 {
        std::mem::swap(&mut width, &mut height);
    }
    Some(VideoInfo { duration: duration.unwrap_or(0.0), width, height, sound: text.lines().any(|l| l.contains("Stream #") && l.contains("Audio:")) })
}

/// Whether a file has sound in it. Works for a sound file too, which has no picture.
fn has_sound(path: &str) -> Result<bool, String> {
    Ok(describe(path)?.lines().any(|l| l.contains("Stream #") && l.contains("Audio:")))
}

/// What a clip is: how long, how big, and whether it has sound.
#[tauri::command]
pub async fn video_info(path: String) -> Result<VideoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || probe(&path)).await.map_err(|e| e.to_string())?
}

#[derive(Deserialize, Clone)]
pub struct Clip {
    path: String,
    /// Seconds into the file where the part to keep starts and ends.
    start: f64,
    end: f64,
}

/// The ffmpeg arguments that join the kept part of each clip into one file of the given size.
/// Every clip is fitted inside the frame with black around it, so mixed shapes still join.
fn join_args(clips: &[(Clip, bool)], width: u32, height: u32, out: &str) -> Vec<String> {
    let (w, h) = (width - width % 2, height - height % 2);
    let mut args: Vec<String> = vec!["-y".into(), "-hide_banner".into(), "-loglevel".into(), "error".into()];
    let mut graph = String::new();
    for (i, (clip, sound)) in clips.iter().enumerate() {
        let length = (clip.end - clip.start).max(0.05);
        args.extend(["-ss".into(), format!("{:.3}", clip.start.max(0.0)), "-t".into(), format!("{length:.3}"), "-i".into(), clip.path.clone()]);
        graph += &format!("[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}];");
        if *sound {
            graph += &format!("[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}];");
        } else {
            // a silent clip still needs sound of its own length, or the join fails
            graph += &format!("anullsrc=r=48000:cl=stereo,atrim=duration={length:.3}[a{i}];");
        }
    }
    for i in 0..clips.len() {
        graph += &format!("[v{i}][a{i}]");
    }
    graph += &format!("concat=n={}:v=1:a=1[v][a]", clips.len());
    args.extend(["-filter_complex".into(), graph, "-map".into(), "[v]".into(), "-map".into(), "[a]".into()]);
    args.extend(h264(20));
    args.extend(["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"].map(String::from));
    args.push(out.into());
    args
}

/// Join the kept part of each clip, in order, into one video file.
#[tauri::command]
pub async fn video_export(clips: Vec<Clip>, width: u32, height: u32, out: String) -> Result<(), String> {
    if clips.is_empty() {
        return Err("Add a clip first.".into());
    }
    if width < 16 || height < 16 {
        return Err("That size is too small.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
        let mut with_sound = Vec::new();
        for clip in clips {
            let sound = probe(&clip.path)?.sound;
            with_sound.push((clip, sound));
        }
        let done = Command::new(ffmpeg).args(join_args(&with_sound, width, height, &out)).output().map_err(|e| e.to_string())?;
        if done.status.success() {
            return Ok(());
        }
        let said = String::from_utf8_lossy(&done.stderr);
        let last: Vec<&str> = said.lines().rev().take(3).collect();
        Err(format!("The video could not be made. {}", last.into_iter().rev().collect::<Vec<_>>().join(" ")))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- a clip dropped onto Duet: the window is handed its contents, not where it is ----------

/// The copy being written right now.
static COPYING: Mutex<Option<std::fs::File>> = Mutex::new(None);

#[derive(Serialize)]
pub struct Kept {
    path: String,
    /// True when a file of this name and size was kept before, so nothing has to be copied.
    already: bool,
}

/// Start keeping a dropped clip or sound in the Clips folder beside the projects. Its contents follow
/// with `clip_keep_part`, and `clip_keep_end` finishes it. A video is played from a file, so it needs a place.
#[tauri::command]
pub fn clip_keep_begin(name: String, size: u64) -> Result<Kept, String> {
    let dir = PathBuf::from(crate::default_projects_dir()?).join("Clips");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // only the name itself, never a way out of the folder
    let plain: String = name.rsplit(['/', '\\']).next().unwrap_or("clip").chars().filter(|c| !c.is_control()).collect();
    let plain = if plain.trim().is_empty() || plain.starts_with('.') { format!("clip{plain}") } else { plain };
    let (stem, ext) = match plain.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (plain.clone(), String::new()),
    };
    let mut path = dir.join(&plain);
    let mut n = 2;
    while path.exists() {
        if std::fs::metadata(&path).map(|m| m.len() == size).unwrap_or(false) {
            return Ok(Kept { path: path.to_string_lossy().to_string(), already: true });
        }
        path = dir.join(format!("{stem} {n}{ext}"));
        n += 1;
    }
    let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    *COPYING.lock().map_err(|e| e.to_string())? = Some(file);
    Ok(Kept { path: path.to_string_lossy().to_string(), already: false })
}

/// The next part of the clip being kept.
#[tauri::command]
pub fn clip_keep_part(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("That was not part of a file.".into());
    };
    let mut copying = COPYING.lock().map_err(|e| e.to_string())?;
    copying.as_mut().ok_or("No clip is being kept.")?.write_all(bytes).map_err(|e| e.to_string())
}

/// The whole clip has been handed in.
#[tauri::command]
pub fn clip_keep_end() -> Result<(), String> {
    if let Some(mut file) = COPYING.lock().map_err(|e| e.to_string())?.take() {
        file.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- a frame that plays: its pictures arrive one by one and become one video ----------

#[derive(Deserialize, Clone)]
pub struct Sound {
    path: String,
    /// Seconds into the file where the sound to keep starts.
    from: f64,
    /// The second of the video where it is heard.
    at: f64,
    length: f64,
    /// 0 to 1.
    volume: f64,
}

/// The video being made right now: ffmpeg, waiting for pictures.
static MAKING: Mutex<Option<Child>> = Mutex::new(None);

/// The ffmpeg arguments that turn pictures handed in one by one, and the sound of the clips, into one file.
fn scene_args(fps: u32, seconds: f64, quality: u32, sounds: &[Sound], out: &str) -> Vec<String> {
    let mut args: Vec<String> = ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate"].map(String::from).to_vec();
    args.extend([fps.to_string(), "-c:v".into(), "mjpeg".into(), "-i".into(), "-".into()]);
    let mut graph = String::new();
    for (i, s) in sounds.iter().enumerate() {
        args.extend(["-ss".into(), format!("{:.3}", s.from.max(0.0)), "-t".into(), format!("{:.3}", s.length.max(0.05)), "-i".into(), s.path.clone()]);
        let wait = (s.at.max(0.0) * 1000.0).round() as u64;
        graph += &format!("[{}:a]aresample=48000,aformat=channel_layouts=stereo,volume={:.3},adelay={wait}:all=1[a{i}];", i + 1, s.volume.clamp(0.0, 1.0));
    }
    args.extend(["-map".into(), "0:v".into()]);
    if !sounds.is_empty() {
        for i in 0..sounds.len() {
            graph += &format!("[a{i}]");
        }
        // the sound runs exactly as long as the picture, with silence where no clip is heard
        graph += &format!("amix=inputs={}:normalize=0,apad,atrim=duration={seconds:.3}[a]", sounds.len());
        args.extend(["-filter_complex".into(), graph, "-map".into(), "[a]".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "160k".into()]);
    }
    // quality is ffmpeg's own scale: lower is finer and makes a bigger file
    args.extend(h264(quality));
    args.extend(["-pix_fmt", "yuv420p", "-movflags", "+faststart"].map(String::from));
    args.push(out.into());
    args
}

/// Start making a video. Pictures follow with `scene_export_frame`, and `scene_export_end` finishes it.
#[tauri::command]
pub async fn scene_export_begin(out: String, fps: u32, seconds: f64, quality: Option<u32>, sounds: Vec<Sound>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
        // a clip with no sound in it has nothing to add
        let mut heard = Vec::new();
        for s in sounds {
            if has_sound(&s.path)? {
                heard.push(s);
            }
        }
        let child = Command::new(ffmpeg)
            .args(scene_args(fps.clamp(1, 120), seconds, quality.unwrap_or(18), &heard, &out))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(mut old) = MAKING.lock().map_err(|e| e.to_string())?.replace(child) {
            let _ = old.kill();
            let _ = old.wait();
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One picture of the video, as a JPEG.
#[tauri::command]
pub fn scene_export_frame(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("That was not a picture.".into());
    };
    let mut making = MAKING.lock().map_err(|e| e.to_string())?;
    let child = making.as_mut().ok_or("No video is being made.")?;
    let pipe = child.stdin.as_mut().ok_or("No video is being made.")?;
    pipe.write_all(bytes).map_err(|_| "The video could not be made. ffmpeg stopped early.".to_string())
}

/// The last picture has been handed in: finish the file.
#[tauri::command]
pub async fn scene_export_end() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = MAKING.lock().map_err(|e| e.to_string())?.take().ok_or("No video is being made.")?;
        drop(child.stdin.take());
        let done = child.wait_with_output().map_err(|e| e.to_string())?;
        if done.status.success() {
            return Ok(());
        }
        let said = String::from_utf8_lossy(&done.stderr);
        let last: Vec<&str> = said.lines().rev().take(3).collect();
        Err(format!("The video could not be made. {}", last.into_iter().rev().collect::<Vec<_>>().join(" ")))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Give up on the video being made.
#[tauri::command]
pub fn scene_export_stop() {
    if let Ok(mut making) = MAKING.lock() {
        if let Some(mut child) = making.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_length_size_and_sound_from_ffmpeg_text() {
        let text = "  Duration: 00:16:10.20, start: 0.000000, bitrate: 6168 kb/s\n  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuvj420p(pc, bt709), 3684x1080, 5996 kb/s, 60 fps\n  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo";
        let info = parse_info(text).unwrap();
        assert!((info.duration - 970.2).abs() < 0.01);
        assert_eq!((info.width, info.height, info.sound), (3684, 1080, true));
        // an upright phone clip stored on its side
        let phone = "  Duration: 00:00:05.00, start: 0\n  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 30 fps\n      Side data:\n        displaymatrix: rotation of -90.00 degrees";
        let info = parse_info(phone).unwrap();
        assert_eq!((info.width, info.height, info.sound), (1080, 1920, false));
    }

    fn clip(path: &str, start: f64, end: f64) -> Clip {
        Clip { path: path.into(), start, end }
    }

    #[test]
    fn joins_clips_in_order_and_gives_a_silent_one_sound() {
        let args = join_args(&[(clip("a.mp4", 1.0, 3.5), true), (clip("b.mov", 0.0, 2.0), false)], 1081, 1920, "out.mp4");
        let at = |s: &str| args.iter().position(|a| a == s).unwrap();
        assert!(at("a.mp4") < at("b.mov"));
        assert_eq!(args[at("a.mp4") - 2], "2.500");
        let graph = &args[at("-filter_complex") + 1];
        // an odd size is made even, which the video format needs
        assert!(graph.contains("scale=1080:1920"));
        assert!(graph.contains("[0:a]aresample"));
        assert!(graph.contains("anullsrc=r=48000:cl=stereo,atrim=duration=2.000[a1]"));
        assert!(graph.ends_with("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"));
        assert_eq!(args.last().unwrap(), "out.mp4");
    }

    #[test]
    fn a_frame_that_plays_gets_its_pictures_and_each_clip_heard_at_its_moment() {
        let sounds = vec![Sound { path: "a.mp4".into(), from: 1.0, at: 2.5, length: 3.0, volume: 0.5 }];
        let args = scene_args(30, 10.0, 18, &sounds, "out.mp4").join(" ");
        assert!(args.contains("-f image2pipe -framerate 30 -c:v mjpeg -i -"));
        assert!(args.contains("-ss 1.000 -t 3.000 -i a.mp4"));
        assert!(args.contains("volume=0.500,adelay=2500:all=1[a0]"));
        assert!(args.contains("atrim=duration=10.000[a]"));
        let silent = scene_args(30, 10.0, 18, &[], "out.mp4").join(" ");
        assert!(!silent.contains("filter_complex"));
    }
}

/// A light copy of a clip for playing and scrubbing on the canvas: smaller, with a picture to land on
/// every few frames. Kept in Duet's own folder and made once per file. Making a video still uses the
/// original. Returns where the copy is.
#[tauri::command(async)]
pub fn clip_preview(path: String) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    meta.len().hash(&mut h);
    meta.modified().ok().hash(&mut h);
    let name = format!("{:016x}", h.finish());
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|e| e.to_string())?;
    let dir = PathBuf::from(home).join(crate::duet_dir_name()).join("previews");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("{name}.mp4"));
    if out.is_file() {
        return Ok(out.to_string_lossy().to_string());
    }
    let ffmpeg = find("ffmpeg").ok_or(MISSING)?;
    let part = dir.join(format!("{name}.part.mp4"));
    // the computer's own video chip, so the copy is made quickly and quietly
    let encoder: &[&str] = if cfg!(target_os = "macos") {
        &["-c:v", "h264_videotoolbox", "-b:v", "4M"]
    } else if cfg!(windows) {
        &["-c:v", "h264_mf", "-b:v", "4M"]
    } else {
        &["-c:v", "libx264", "-preset", "veryfast", "-crf", "26"]
    };
    let status = Command::new(&ffmpeg)
        .args(["-y", "-v", "error", "-i", &path, "-vf", "scale=w=min(1280\\,iw):h=min(1280\\,ih):force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-g", "12", "-pix_fmt", "yuv420p"])
        .args(encoder)
        .args(["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"])
        .arg(&part)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        let _ = std::fs::remove_file(&part);
        return Err("A light copy of this clip could not be made. The original plays instead.".into());
    }
    std::fs::rename(&part, &out).map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().to_string())
}
