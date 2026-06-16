"""AI still + motion — real SD image animated with ffmpeg (works on 1GB AMD)."""

from __future__ import annotations

import subprocess
import uuid
from pathlib import Path

from diffusers_infer import generate_image
from ffmpeg_export import find_ffmpeg


def make_ai_motion_mp4(
    dest: Path,
    *,
    prompt: str,
    ref_path: Path | None,
    duration_sec: int = 6,
    resolution: str = "1280x720",
    fps: int = 24,
    work_dir: Path,
) -> Path:
    """Generate one SD still, then ken-burns zoom to MP4."""
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found")

    width, height = resolution.lower().split("x")
    out_w, out_h = int(width), int(height)
    still = work_dir / f"still_{uuid.uuid4().hex[:10]}.png"
    gen_w = min(768, out_w)
    gen_h = min(512, int(gen_w * out_h / max(out_w, 1)))

    generate_image(
        still,
        prompt=prompt + ", cinematic film still, high detail, dramatic lighting",
        width=gen_w,
        height=gen_h,
        ref_path=ref_path,
        steps=18,
    )

    frames = max(24, duration_sec * fps)
    # Slow zoom + subtle pan — reads as "video" from a single AI still.
    zoom_expr = f"zoom+0.0008"
    vf = (
        f"scale={out_w}:{out_h}:force_original_aspect_ratio=increase,"
        f"crop={out_w}:{out_h},"
        f"zoompan=z='{zoom_expr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s={out_w}x{out_h}:fps={fps}"
    )

    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg, "-y",
        "-loop", "1", "-i", str(still),
        "-vf", vf,
        "-t", str(duration_sec),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-crf", "20", "-preset", "medium",
        "-movflags", "+faststart", "-an",
        str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return dest