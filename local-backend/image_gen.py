"""Local reference image generation — ComfyUI T2I when available, Pillow fallback."""

from __future__ import annotations

import re
import textwrap
import uuid
from pathlib import Path
from typing import Any

from comfy_client import ComfyUIClient, ComfyUIError
from workflow_builder import (
    inject_dimensions,
    inject_prompt,
    inject_reference_image,
    load_workflow,
    resolve_workflow_path,
)

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = ImageDraw = ImageFont = None  # type: ignore


ASPECT_MAP = {
    "1:1": (1, 1),
    "16:9": (16, 9),
    "9:16": (9, 16),
    "4:3": (4, 3),
    "3:4": (3, 4),
    "3:2": (3, 2),
    "2:3": (2, 3),
}


def parse_dimensions(aspect_ratio: str | None, resolution: str | int | None) -> tuple[int, int]:
    ar = ASPECT_MAP.get(str(aspect_ratio or "1:1").strip(), (1, 1))
    base = 1024
    if resolution:
        res_s = str(resolution).lower().replace("p", "")
        if "x" in res_s:
            w, h = res_s.split("x", 1)
            return max(256, int(w)), max(256, int(h))
        if res_s.isdigit():
            base = max(256, min(2048, int(res_s)))
    ratio = ar[0] / ar[1]
    if ratio >= 1:
        return base, max(256, int(base / ratio))
    return max(256, int(base * ratio)), base


def _parse_traits(text: str) -> dict[str, Any]:
    t = (text or "").lower()
    return {
        "leather": "leather" in t or "jacket" in t,
        "military": any(k in t for k in ("military", "soldier", "ex-military", "tactical")),
        "scar": "scar" in t,
        "weathered": "weathered" in t or "rugged" in t,
        "night": any(k in t for k in ("night", "neon", "sodium", "rain", "wet")),
        "urban": any(k in t for k in ("street", "alley", "city", "urban", "concrete")),
    }


def _font(size: int) -> Any:
    if not ImageFont:
        return None
    for name in ("arial.ttf", "Arial.ttf", "segoeui.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _wrap(draw: Any, text: str, font: Any, max_width: int) -> list[str]:
    words = re.sub(r"\s+", " ", (text or "").strip()).split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        bbox = draw.textbbox((0, 0), trial, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines[:8]


def render_reference_card(
    dest: Path,
    *,
    kind: str,
    name: str,
    prompt: str,
    width: int,
    height: int,
    model: str,
) -> Path:
    if not Image:
        raise RuntimeError("Pillow required for local image fallback (pip install pillow)")

    traits = _parse_traits(prompt)
    img = Image.new("RGB", (width, height), "#0a0a12")
    draw = ImageDraw.Draw(img)

    # Cinematic gradient background
    for y in range(height):
        t = y / max(height - 1, 1)
        r = int(8 + t * 18)
        g = int(10 + t * 22)
        b = int(20 + t * 35)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    accent = "#f4a261" if kind == "character" else "#e9c46a"
    title_font = _font(max(18, width // 28))
    body_font = _font(max(12, width // 42))
    small_font = _font(max(10, width // 50))

    margin = max(24, width // 24)
    draw.rounded_rectangle(
        (margin, margin, width - margin, height - margin),
        radius=18,
        outline=accent,
        width=3,
    )

    label = "CHARACTER REFERENCE" if kind == "character" else "LOCATION PLATE"
    draw.text((margin + 20, margin + 16), label, fill=accent, font=title_font)
    draw.text((margin + 20, margin + 52), name.upper()[:48], fill="#f0f0f0", font=title_font)

    cx = width // 2
    cy = int(height * 0.52)
    skin = "#c9a88a" if traits["weathered"] else "#d2b48c"
    jacket = "#2f2a22" if traits["leather"] else "#1f2a3a"

    if kind == "character":
        # Stylized portrait silhouette (not stick-figure)
        head_r = int(min(width, height) * 0.09)
        draw.ellipse(
            (cx - head_r, cy - head_r * 2, cx + head_r, cy),
            fill=skin,
            outline=accent,
            width=2,
        )
        if traits["scar"]:
            draw.line(
                (cx - head_r // 2, cy - head_r, cx + head_r // 3, cy - head_r * 1.4),
                fill="#8b0000",
                width=3,
            )
        torso_w = int(head_r * 1.6)
        torso_h = int(head_r * 2.2)
        draw.rounded_rectangle(
            (cx - torso_w, cy, cx + torso_w, cy + torso_h),
            radius=12,
            fill=jacket,
            outline="#111",
            width=2,
        )
        if traits["military"]:
            draw.rectangle(
                (cx - torso_w + 8, cy + torso_h - 18, cx + torso_w - 8, cy + torso_h - 8),
                fill="#111",
            )
    else:
        # Environment plate frame
        frame_top = int(height * 0.28)
        frame_bot = int(height * 0.78)
        draw.rectangle(
            (margin + 40, frame_top, width - margin - 40, frame_bot),
            outline=accent,
            width=2,
        )
        if traits["night"]:
            draw.ellipse(
                (width // 2 - 30, frame_top + 30, width // 2 + 30, frame_top + 90),
                fill="#ffd27a",
                outline="#ff9f1c",
            )
        if traits["urban"]:
            for i, h in enumerate((60, 90, 45, 110, 70)):
                x = margin + 60 + i * ((width - 2 * margin - 120) // 5)
                draw.rectangle((x, frame_bot - h, x + 40, frame_bot), fill="#1a1a24", outline="#333")

    prompt_y = int(height * 0.8)
    for i, line in enumerate(_wrap(draw, prompt, body_font, width - 2 * margin - 40)):
        draw.text((margin + 20, prompt_y + i * 18), line, fill="#bbbbbb", font=body_font)

    chips = []
    if traits["leather"]:
        chips.append("leather")
    if traits["military"]:
        chips.append("military")
    if traits["scar"]:
        chips.append("scar")
    if traits["night"]:
        chips.append("night")
    if traits["urban"]:
        chips.append("urban")
    chip_text = " • ".join(chips) if chips else f"model: {model}"
    draw.text((margin + 20, height - margin - 28), chip_text, fill="#888", font=small_font)
    draw.text(
        (width - margin - 180, height - margin - 28),
        "Shotbreak local",
        fill="#666",
        font=small_font,
    )

    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, format="PNG", optimize=True)
    return dest


def run_comfy_image(
    config: dict[str, Any],
    workflows_dir: Path,
    *,
    model: str,
    prompt: str,
    ref_path: Path | None,
    aspect_ratio: str | None,
    resolution: str | int | None,
    uploads_dir: Path,
) -> Path:
    workflow_path = resolve_workflow_path(
        workflows_dir,
        model,
        config.get("model_image_workflows", {}),
        config.get("default_image_workflow", "txt2img.api.json"),
    )
    if not workflow_path:
        raise ComfyUIError("No image workflow JSON in workflows/")

    client = ComfyUIClient(config["comfy_host"])
    client.health()
    workflow = load_workflow(workflow_path)
    inject_prompt(workflow, prompt)
    w, h = parse_dimensions(aspect_ratio, resolution)
    inject_dimensions(workflow, w, h)
    if ref_path and ref_path.exists():
        uploaded = client.upload_image(ref_path)
        inject_reference_image(workflow, uploaded)

    prompt_id = client.queue_prompt(workflow)
    files = client.wait_for_outputs(
        prompt_id,
        poll_interval=config.get("poll_interval_sec", 2),
        max_wait_sec=config.get("max_wait_sec", 1800),
    )
    # Prefer still images for picture gen
    image_files = [f for f in files if f.get("kind") == "images"] or files
    raw = client.download_view(image_files[0])
    ext = Path(image_files[0]["filename"]).suffix or ".png"
    out = uploads_dir / f"comfy_{uuid.uuid4().hex[:12]}{ext}"
    out.write_bytes(raw)
    return out


def build_image_prompt(body: dict[str, Any]) -> str:
    name = body.get("name") or "subject"
    desc = body.get("desc") or body.get("prompt") or ""
    points = body.get("points") or []
    kind = body.get("type") or "character"
    loc = body.get("location") or {}
    loc_bits = []
    if isinstance(loc, dict):
        for key in ("weather", "tod", "mood", "setting"):
            if loc.get(key):
                loc_bits.append(str(loc[key]))
    points_str = "; ".join(str(p) for p in points[:6]) if points else ""
    parts = [
        f"cinematic {'character portrait' if kind == 'character' else 'location plate'}",
        f"subject: {name}",
        desc,
    ]
    if points_str:
        parts.append(f"key traits: {points_str}")
    if loc_bits:
        parts.append("environment: " + ", ".join(loc_bits))
    parts.append("high detail, film still, consistent lighting, production reference")
    return " | ".join(p for p in parts if p)