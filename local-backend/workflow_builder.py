"""Load ComfyUI API workflows and inject Shotbreak fields."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any


PROMPT_NODE_CLASSES = {"CLIPTextEncode", "CLIPTextEncodeSDXL", "TextEncodeQwenImageEditPlus"}
IMAGE_NODE_CLASSES = {"LoadImage", "LoadImageMask"}
LATENT_NODE_CLASSES = {"EmptyLatentImage", "EmptySD3LatentImage"}
DURATION_NODE_HINTS = ("duration", "length", "frames", "frame_count")


def load_workflow(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "prompt" in data and isinstance(data["prompt"], dict):
        return copy.deepcopy(data["prompt"])
    return copy.deepcopy(data)


def inject_prompt(workflow: dict[str, Any], prompt: str) -> None:
    for _node_id, node in workflow.items():
        if isinstance(node, dict) and node.get("class_type") in PROMPT_NODE_CLASSES:
            inputs = node.setdefault("inputs", {})
            if "text" in inputs:
                inputs["text"] = prompt
                return
    raise ValueError(f"No prompt node in workflow {path_hint(workflow)}")


def path_hint(_workflow: dict[str, Any]) -> str:
    return "(export API JSON from ComfyUI into local-backend/workflows/)"


def inject_reference_image(workflow: dict[str, Any], image_name: str) -> bool:
    for _node_id, node in workflow.items():
        if isinstance(node, dict) and node.get("class_type") in IMAGE_NODE_CLASSES:
            inputs = node.setdefault("inputs", {})
            if "image" in inputs:
                inputs["image"] = image_name
                return True
    return False


def inject_duration(workflow: dict[str, Any], duration_sec: int, fps: int = 24) -> None:
    frame_count = max(8, int(duration_sec * fps))
    for _node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs") or {}
        for key in list(inputs.keys()):
            key_l = key.lower()
            if any(hint in key_l for hint in DURATION_NODE_HINTS) and isinstance(inputs[key], (int, float)):
                inputs[key] = frame_count


def inject_dimensions(workflow: dict[str, Any], width: int, height: int) -> None:
    for _node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") not in LATENT_NODE_CLASSES:
            continue
        inputs = node.setdefault("inputs", {})
        if "width" in inputs:
            inputs["width"] = width
        if "height" in inputs:
            inputs["height"] = height


def resolve_workflow_path(workflows_dir: Path, model: str, model_map: dict[str, str], default: str) -> Path | None:
    filename = model_map.get(model) or default
    path = workflows_dir / filename
    return path if path.exists() else None