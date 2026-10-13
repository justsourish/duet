//! Cutting video: read what a clip is, and join trimmed clips into one file.
//! The work is done by ffmpeg, which has to be on the computer already. Duet does not ship it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// Where a tool such as ffmpeg lives. An app started from the Dock does not get the folders a terminal knows.
fn find(program: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(d.into());
    }
    let names = if cfg!(windows) { vec![format!("{program}.exe")] } else { vec![program.to_string()] };
    dirs.iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file())
}

const MISSING: &str = "Cutting video needs ffmpeg on this computer. Install it, then open Duet again.";

/// True when this computer has what cutting video needs.
#[tauri::command]
pub fn video_ready() -> bool {
    find("ffmpeg").is_some() && find("ffprobe").is_some()
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
    let ffprobe = find("ffprobe").ok_or(MISSING)?;
    let out = Command::new(ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
        .output()
        .map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_slice(&out.stdout).map_err(|_| "That file could not be read as a video.".to_string())?;
    let streams = json["streams"].as_array().cloned().unwrap_or_default();
    let picture = streams.iter().find(|s| s["codec_type"] == "video").ok_or("That file has no picture in it.")?;
    let number = |v: &Value| v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64());
    let (mut width, mut height) = (picture["width"].as_u64().unwrap_or(0) as u32, picture["height"].as_u64().unwrap_or(0) as u32);
    // a phone clip filmed upright is stored on its side with a note to turn it
    let turned = picture["side_data_list"].as_array().and_then(|l| l.iter().find_map(|d| d["rotation"].as_i64())).unwrap_or(0);
    if turned.abs() % 180 == 90 {
        std::mem::swap(&mut width, &mut height);
    }
    Ok(VideoInfo {
        duration: number(&json["format"]["duration"]).or_else(|| number(&picture["duration"])).unwrap_or(0.0),
        width,
        height,
        sound: streams.iter().any(|s| s["codec_type"] == "audio"),
    })
}

/// Whether a file has sound in it. Works for a sound file too, which has no picture.
fn has_sound(path: &str) -> Result<bool, String> {
    let ffprobe = find("ffprobe").ok_or(MISSING)?;
    let out = Command::new(ffprobe)
        .args(["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", path])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).contains("audio"))
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
    args.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"].map(String::from));
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
fn scene_args(fps: u32, seconds: f64, sounds: &[Sound], out: &str) -> Vec<String> {
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
    args.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"].map(String::from));
    args.push(out.into());
    args
}

/// Start making a video. Pictures follow with `scene_export_frame`, and `scene_export_end` finishes it.
#[tauri::command]
pub async fn scene_export_begin(out: String, fps: u32, seconds: f64, sounds: Vec<Sound>) -> Result<(), String> {
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
            .args(scene_args(fps.clamp(1, 120), seconds, &heard, &out))
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
        let args = scene_args(30, 10.0, &sounds, "out.mp4").join(" ");
        assert!(args.contains("-f image2pipe -framerate 30 -c:v mjpeg -i -"));
        assert!(args.contains("-ss 1.000 -t 3.000 -i a.mp4"));
        assert!(args.contains("volume=0.500,adelay=2500:all=1[a0]"));
        assert!(args.contains("atrim=duration=10.000[a]"));
        let silent = scene_args(30, 10.0, &[], "out.mp4").join(" ");
        assert!(!silent.contains("filter_complex"));
    }
}
