import { useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  addFiles,
  exportCut,
  getCut,
  moveClip,
  removeClip,
  setCut,
  setShape,
  SHAPES,
  srcOf,
  timeText,
  totalLength,
  trimClip,
  useCut,
  videoReady,
} from "../video/cut";

export default function VideoCut({ onClose }: { onClose: () => void }) {
  const cut = useCut();
  const [ready, setReady] = useState<boolean | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedFile, setExportedFile] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let alive = true;
    void videoReady().then((ok) => {
      if (alive) setReady(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const picked = cut.clips.find((c) => c.id === pickedId) ?? cut.clips[0] ?? null;

  useEffect(() => {
    const v = videoRef.current;
    if (v && picked) {
      v.pause();
      setPlaying(false);
      v.currentTime = picked.start;
    }
  }, [picked?.id]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || !picked) return;
    if (v.paused) {
      if (v.currentTime < picked.start || v.currentTime >= picked.end) {
        v.currentTime = picked.start;
      }
      void v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  };

  const onStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!picked) return;
    const val = Number(e.target.value);
    const nextCut = trimClip(getCut(), picked.id, { start: val });
    setCut(nextCut);
    const updated = nextCut.clips.find((c) => c.id === picked.id);
    const target = updated ? updated.start : val;
    const v = videoRef.current;
    if (v) {
      v.pause();
      setPlaying(false);
      v.currentTime = target;
    }
  };

  const onEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!picked) return;
    const val = Number(e.target.value);
    const nextCut = trimClip(getCut(), picked.id, { end: val });
    setCut(nextCut);
    const updated = nextCut.clips.find((c) => c.id === picked.id);
    const target = updated ? updated.end : val;
    const v = videoRef.current;
    if (v) {
      v.pause();
      setPlaying(false);
      v.currentTime = target;
    }
  };

  const handleAddFiles = async () => {
    try {
      const issues = await addFiles();
      setProblems(issues);
    } catch (e) {
      setProblems([String(e)]);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    setExportedFile(null);
    try {
      const file = await exportCut();
      if (file) {
        setExportedFile(file);
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  if (ready === false) {
    return (
      <div className="vc-screen">
        <header className="vc-bar">
          <span className="vc-title">Video</span>
          <span className="spacer" />
          <button className="pill" onClick={onClose} title="Close">
            Close
          </button>
        </header>
        <div className="vc-notice">Cutting video needs ffmpeg on this computer.</div>
      </div>
    );
  }

  return (
    <div className="vc-screen">
      <header className="vc-bar">
        <span className="vc-title">Video</span>
        <div className="vc-top-right">
          <button className="pill" onClick={handleAddFiles} title="Add video files">
            Bring in clips
          </button>
          <select
            className="vc-select"
            value={cut.shape}
            onChange={(e) => setCut(setShape(getCut(), e.target.value as (typeof SHAPES)[number]["id"]))}
            title="Shape of finished video"
          >
            {SHAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="vc-total" title="Total length of the finished video">
            {timeText(totalLength(cut))}
          </span>
          <button
            className="pill primary"
            disabled={exporting}
            onClick={handleExport}
            title="Export video"
          >
            {exporting ? "Making your video..." : "Export video"}
          </button>
          {exportedFile && (
            <span className="vc-done">
              <span className="vc-file" title={exportedFile}>
                {exportedFile.split(/[\\/]/).pop() ?? exportedFile}
              </span>
              <button
                className="pill"
                onClick={() => void revealItemInDir(exportedFile)}
                title="Show in Finder"
              >
                Show in Finder
              </button>
            </span>
          )}
          {exportError && <span className="vc-error">{exportError}</span>}
          <button className="pill" onClick={onClose} title="Close">
            Close
          </button>
        </div>
      </header>

      {problems.length > 0 && (
        <div className="vc-problems">
          {problems.map((p, i) => (
            <div key={i} className="vc-problem">
              {p}
            </div>
          ))}
        </div>
      )}

      <main className="vc-main">
        <aside className="vc-left">
          <div className="vc-left-title">Clips</div>
          <div className="vc-clips-list">
            {cut.clips.map((clip, index) => {
              const isPicked = picked?.id === clip.id;
              return (
                <div
                  key={clip.id}
                  className={`vc-row ${isPicked ? "vc-picked" : ""}`}
                  onClick={() => setPickedId(clip.id)}
                >
                  <span className="vc-name" title={clip.name}>
                    {clip.name}
                  </span>
                  <span className="vc-time">{timeText(clip.end - clip.start)}</span>
                  <div className="vc-actions">
                    <button
                      className="mini vc-btn"
                      title="Move up"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCut(moveClip(getCut(), clip.id, index - 1));
                      }}
                    >
                      Up
                    </button>
                    <button
                      className="mini vc-btn"
                      title="Move down"
                      disabled={index === cut.clips.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCut(moveClip(getCut(), clip.id, index + 1));
                      }}
                    >
                      Down
                    </button>
                    <button
                      className="mini vc-btn"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCut(removeClip(getCut(), clip.id));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="vc-middle">
          {picked ? (
            <div className="vc-player-wrap">
              <video
                ref={videoRef}
                className="vc-player"
                src={srcOf(picked)}
                playsInline
                onLoadedMetadata={(e) => {
                  e.currentTarget.currentTime = picked.start;
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.currentTime >= picked.end) {
                    v.pause();
                    v.currentTime = picked.end;
                    setPlaying(false);
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
              <div className="vc-controls">
                <button className="pill primary vc-play-btn" onClick={togglePlay}>
                  {playing ? "Pause" : "Play"}
                </button>
              </div>
              <div className="vc-sliders">
                <label className="vc-slider-row">
                  <span className="vc-slider-label">Start</span>
                  <input
                    type="range"
                    className="vc-slider"
                    min={0}
                    max={picked.duration}
                    step={0.1}
                    value={picked.start}
                    onChange={onStartChange}
                    aria-label="Start"
                  />
                  <span className="vc-slider-time">{timeText(picked.start)}</span>
                </label>
                <label className="vc-slider-row">
                  <span className="vc-slider-label">End</span>
                  <input
                    type="range"
                    className="vc-slider"
                    min={0}
                    max={picked.duration}
                    step={0.1}
                    value={picked.end}
                    onChange={onEndChange}
                    aria-label="End"
                  />
                  <span className="vc-slider-time">{timeText(picked.end)}</span>
                </label>
              </div>
            </div>
          ) : (
            <div className="vc-empty">Bring in a clip to start.</div>
          )}
        </section>
      </main>
    </div>
  );
}
