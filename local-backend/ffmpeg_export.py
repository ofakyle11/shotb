"""MP4 export helpers."""

from __future__ import annotations

import re
import shutil
import subprocess
import textwrap
from pathlib import Path


def find_ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def _safe_label(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9 _.,!?-]", "", text)[:400]


def transcode_to_mp4(source: Path, dest: Path, *, crf: int = 18, preset: str = "medium", fps: int = 24) -> Path:
    ffmpeg = find_ffmpeg()
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not ffmpeg:
        shutil.copy2(source, dest)
        return dest
    cmd = [
        ffmpeg, "-y", "-i", str(source),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-crf", str(crf), "-preset", preset, "-r", str(fps),
        "-movflags", "+faststart", "-an", str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return dest


def make_placeholder_mp4(
    dest: Path,
    *,
    prompt: str,
    model: str,
    shot_key: str,
    duration_sec: int = 6,
    resolution: str = "1280x720",
    fps: int = 24,
) -> Path:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found")
    width, height = resolution.lower().split("x")
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Simple solid clip — reliable on Windows without font/drawtext dependencies.
    cmd = [
        ffmpeg, "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a0a0f:s={width}x{height}:d={duration_sec}:r={fps}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
        "-movflags", "+faststart", "-an", str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    # Sidecar documents prompt for debugging / re-gen.
    sidecar = dest.with_suffix(".txt")
    sidecar.write_text(
        f"SHOTBREAK LOCAL PLACEHOLDER\nmodel={model}\nshot={shot_key}\n\n{_safe_label(prompt)}\n",
        encoding="utf-8",
    )
    return dest