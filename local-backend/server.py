"""
Shotbreak local video bridge — mirrors netlify/functions/generate-video contract.
POST /generate-video  { action: submit|status|result|generate_picture|balance, ... }
GET  /output/<file>   served MP4 clips
GET  /images/<file>   served PNG/JPG reference images
GET  /health          bridge + ComfyUI status
"""

from __future__ import annotations

import sys
from pathlib import Path as _Path

sys.path.insert(0, str(_Path(__file__).resolve().parent))

import base64
import json
import mimetypes
import shutil
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from api_bridge import (
    ApiBridgeError,
    api_status,
    cache_remote_image,
    generate_picture as api_generate_picture,
    is_api_job,
    submit_video as api_submit_video,
    video_result as api_video_result,
    video_status as api_video_status,
)
from comfy_client import ComfyUIClient, ComfyUIError
from env_loader import load_env
from ffmpeg_export import make_placeholder_mp4, transcode_to_mp4
from diffusers_infer import device_name, init_error, is_available as gpu_available, is_ready as gpu_ready, packages_installed as gpu_packages
from frame_video import make_ai_motion_mp4
from image_gen import build_image_prompt, parse_dimensions, render_reference_card, run_comfy_image
from workflow_builder import (
    inject_duration,
    inject_prompt,
    inject_reference_image,
    load_workflow,
    resolve_workflow_path,
)

ROOT = Path(__file__).resolve().parent
load_env()
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
OUTPUT_DIR = ROOT / CONFIG["output_dir"]
UPLOADS_DIR = ROOT / CONFIG["uploads_dir"]
IMAGES_DIR = ROOT / CONFIG.get("images_dir", "images")
WORKFLOWS_DIR = ROOT / CONFIG["workflows_dir"]
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

JOBS: dict[str, dict[str, Any]] = {}
EXTERNAL_JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


def api_ready() -> bool:
    return api_status().get("ready", False)


def prefer_api() -> bool:
    return bool(CONFIG.get("prefer_api", False) and api_ready())


def _local_bridge_host(host: str) -> bool:
    h = (host or "").split(":")[0].lower()
    return h in ("localhost", "127.0.0.1", "0.0.0.0", "[::1]")


def resolve_ref_for_cloud(ref_url: str | None, base_url: str) -> str | None:
    """Turn localhost bridge URLs into data: URLs so cloud APIs can read refs."""
    if not ref_url:
        return None
    if ref_url.startswith("data:"):
        return ref_url
    parsed = urlparse(ref_url)
    if parsed.scheme in ("http", "https") and _local_bridge_host(parsed.hostname or ""):
        path = parsed.path or ""
        local_path: Path | None = None
        if path.startswith("/images/"):
            name = path.split("/images/", 1)[-1]
            if ".." not in name and "/" not in name:
                local_path = IMAGES_DIR / name
        elif path.startswith("/output/"):
            name = path.split("/output/", 1)[-1]
            if ".." not in name and "/" not in name:
                local_path = OUTPUT_DIR / name
        if local_path and local_path.exists():
            raw = local_path.read_bytes()
            mime = mimetypes.guess_type(local_path.name)[0] or "image/jpeg"
            b64 = base64.b64encode(raw).decode("ascii")
            return f"data:{mime};base64,{b64}"
        return None
    if ref_url.startswith(("http://", "https://")):
        return ref_url
    return None


def _is_external_job(request_id: str) -> bool:
    if not request_id:
        return False
    if request_id.startswith("sb_"):
        return False
    with JOBS_LOCK:
        if request_id in EXTERNAL_JOBS:
            return True
    return is_api_job(request_id)


def cors_headers(handler: BaseHTTPRequestHandler) -> None:
    origin = handler.headers.get("Origin", "*")
    handler.send_header("Access-Control-Allow-Origin", origin or "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Access-Control-Max-Age", "86400")


def json_response(handler: BaseHTTPRequestHandler, status: int, body: Any) -> None:
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    cors_headers(handler)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    try:
        handler.wfile.write(payload)
    except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
        pass  # client closed before response finished (browser timeout/navigate away)


def save_ref_image(url_or_data: str, job_id: str) -> Path | None:
    if not url_or_data:
        return None
    if url_or_data.startswith("data:"):
        try:
            header, b64 = url_or_data.split(",", 1)
            ext = "png"
            if "image/jpeg" in header:
                ext = "jpg"
            elif "image/webp" in header:
                ext = "webp"
            raw = base64.b64decode(b64)
            path = UPLOADS_DIR / f"{job_id}_ref.{ext}"
            path.write_bytes(raw)
            return path
        except Exception:
            return None
    if url_or_data.startswith("http"):
        try:
            from urllib import request as urlreq

            with urlreq.urlopen(url_or_data, timeout=30) as resp:
                data = resp.read()
            path = UPLOADS_DIR / f"{job_id}_ref.jpg"
            path.write_bytes(data)
            return path
        except Exception:
            return None
    return None


_COMFY_CACHE: tuple[bool, float] | None = None


def comfy_reachable() -> bool:
    global _COMFY_CACHE
    now = time.time()
    if _COMFY_CACHE and now - _COMFY_CACHE[1] < 15:
        return _COMFY_CACHE[0]
    try:
        ComfyUIClient(CONFIG["comfy_host"]).health(timeout=2.0)
        _COMFY_CACHE = (True, now)
        return True
    except ComfyUIError:
        _COMFY_CACHE = (False, now)
        return False


def gpu_status() -> dict[str, Any]:
    if not gpu_packages():
        return {
            "packages": False,
            "ready": False,
            "device": "none",
            "error": "Run install-local-gpu.bat to enable real SD 1.5 on your AMD GPU",
        }
    ready = gpu_ready()
    return {
        "packages": True,
        "ready": ready,
        "device": device_name() if ready else "loads on first generation",
        "error": init_error() if ready else None,
    }


def image_mode(*, comfy_online: bool | None = None) -> str:
    if prefer_api():
        st = api_status()
        if st.get("xai"):
            return "xai-imagine"
        if st.get("wavespeed"):
            return "wavespeed"
    if comfy_online if comfy_online is not None else comfy_reachable():
        return "comfyui-local"
    if CONFIG.get("use_local_gpu", True) and gpu_packages():
        return "diffusers-local"
    return "pillow-local"


def video_mode(*, comfy_online: bool | None = None) -> str:
    if prefer_api():
        st = api_status()
        if st.get("xai"):
            return "xai-imagine"
        if st.get("wavespeed"):
            return "wavespeed"
    if comfy_online if comfy_online is not None else comfy_reachable():
        return "comfyui-local"
    if CONFIG.get("use_local_gpu", True) and gpu_packages():
        return "diffusers-local"
    return "ffmpeg-local"


def _resolve_comfy_file(file_info: dict[str, str]) -> Path | None:
    """Filesystem fallback when /view is unavailable."""
    name = file_info.get("filename")
    subfolder = file_info.get("subfolder", "")
    ftype = file_info.get("type", "output")
    if not name:
        return None
    extra = CONFIG.get("comfy_output_dir")
    candidates = [
        Path(name),
        ROOT.parent / "ComfyUI" / ftype / subfolder / name,
        Path.home() / "ComfyUI" / ftype / subfolder / name,
    ]
    if extra:
        candidates.insert(0, Path(extra) / ftype / subfolder / name)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _download_comfy_output(client: ComfyUIClient, file_info: dict[str, str], dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        raw = client.download_view(file_info)
        dest.write_bytes(raw)
        return dest
    except ComfyUIError:
        src = _resolve_comfy_file(file_info)
        if src and src.exists():
            shutil.copy2(src, dest)
            return dest
        raise


def run_comfy_job(job_id: str, body: dict[str, Any]) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job["status"] = "IN_PROGRESS"

    prompt = body.get("prompt") or "cinematic shot"
    model = body.get("model") or "wan-2.7"
    duration = int(body.get("duration") or 6)
    shot_key = body.get("shotKey") or job_id
    resolution = body.get("resolution") or "720p"
    res_map = {"720p": "1280x720", "1080p": "1920x1080", "480p": "854x480"}
    resolution_str = res_map.get(str(resolution).lower(), CONFIG["export"]["default_resolution"])

    out_path = OUTPUT_DIR / f"{job_id}.mp4"
    with JOBS_LOCK:
        job = JOBS.get(job_id) or {}
    ref_raw = job.get("ref_path")
    ref_path = Path(ref_raw) if ref_raw else None

    workflow_path = resolve_workflow_path(
        WORKFLOWS_DIR,
        model,
        CONFIG.get("model_workflows", {}),
        CONFIG.get("default_workflow", "wan_i2v.api.json"),
    )

    used_comfy = False
    provider = "ffmpeg-local"
    if workflow_path and comfy_reachable():
        try:
            client = ComfyUIClient(CONFIG["comfy_host"])
            workflow = load_workflow(workflow_path)
            inject_prompt(workflow, prompt)
            inject_duration(workflow, duration, CONFIG["export"].get("default_fps", 24))
            if ref_path and ref_path.exists():
                uploaded = client.upload_image(ref_path)
                inject_reference_image(workflow, uploaded)
            prompt_id = client.queue_prompt(workflow)
            with JOBS_LOCK:
                JOBS[job_id]["comfy_prompt_id"] = prompt_id

            deadline = time.time() + CONFIG.get("max_wait_sec", 1800)
            while time.time() < deadline:
                history = client.get_history(prompt_id)
                entry = history.get(prompt_id) if isinstance(history, dict) else None
                if entry and entry.get("outputs"):
                    files = client.extract_output_files(entry)
                    if files:
                        # Prefer video outputs; fall back to any file type
                        video_files = [f for f in files if f.get("kind") in ("videos", "gifs")] or files
                        raw_dest = OUTPUT_DIR / f"{job_id}_raw{Path(video_files[0]['filename']).suffix or '.mp4'}"
                        _download_comfy_output(client, video_files[0], raw_dest)
                        transcode_to_mp4(raw_dest, out_path)
                        used_comfy = True
                        provider = "comfyui-local"
                        break
                time.sleep(CONFIG.get("poll_interval_sec", 2))
        except Exception as exc:
            with JOBS_LOCK:
                JOBS[job_id]["error"] = str(exc)

    if not used_comfy and CONFIG.get("use_local_gpu", True) and gpu_packages():
        try:
            make_ai_motion_mp4(
                out_path,
                prompt=prompt,
                ref_path=ref_path,
                duration_sec=duration,
                resolution=resolution_str,
                fps=CONFIG["export"].get("default_fps", 24),
                work_dir=OUTPUT_DIR,
            )
            used_comfy = True
            provider = "diffusers-local"
        except Exception as exc:
            with JOBS_LOCK:
                JOBS[job_id]["error"] = f"GPU video: {exc}"

    if not used_comfy and CONFIG.get("fallback_ffmpeg_when_comfy_offline", True):
        try:
            make_placeholder_mp4(
                out_path,
                prompt=prompt,
                model=model,
                shot_key=str(shot_key),
                duration_sec=duration,
                resolution=resolution_str,
                fps=CONFIG["export"].get("default_fps", 24),
            )
            used_comfy = True
            provider = "ffmpeg-local"
        except Exception as exc:
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "FAILED"
                JOBS[job_id]["error"] = str(exc)
            return

    with JOBS_LOCK:
        JOBS[job_id]["status"] = "COMPLETED" if used_comfy and out_path.exists() else "FAILED"
        JOBS[job_id]["video_path"] = str(out_path) if out_path.exists() else None
        JOBS[job_id]["provider"] = provider


def handle_generate_picture(body: dict[str, Any], base_url: str) -> dict[str, Any]:
    image_id = f"img_{uuid.uuid4().hex[:12]}"
    model = body.get("model") or "flux-xai"
    kind = body.get("type") or "character"
    name = body.get("name") or ("location-plate" if kind == "location" else "subject")
    prompt = build_image_prompt(body)
    aspect = body.get("aspect_ratio")
    resolution = body.get("resolution")
    width, height = parse_dimensions(aspect, resolution)

    if prefer_api():
        api_body = dict(body)
        api_body["prompt"] = prompt
        for ref_key in ("character_image_url", "reference_image", "charPhoto", "locationPhoto"):
            raw_ref = body.get(ref_key)
            if raw_ref:
                api_body[ref_key] = resolve_ref_for_cloud(raw_ref, base_url) or raw_ref
        if body.get("referenceImages"):
            api_body["referenceImages"] = [
                {**(item or {}), "url": resolve_ref_for_cloud((item or {}).get("url"), base_url) or (item or {}).get("url")}
                for item in body["referenceImages"]
            ]
        try:
            api_res = api_generate_picture(api_body)
            remote_url = api_res.get("url") or api_res.get("demo_url")
            if remote_url:
                out_path = IMAGES_DIR / f"{image_id}.png"
                cache_remote_image(remote_url, out_path)
                image_url = f"{base_url}/images/{image_id}.png"
                return {
                    "prompt": api_res.get("prompt") or prompt,
                    "url": image_url,
                    "demo_url": image_url,
                    "grok_enriched": False,
                    "vision_used": bool(body.get("character_image_url") or body.get("reference_image")),
                    "model": model,
                    "provider": api_res.get("provider", "xai-imagine"),
                    "note": api_res.get("note", "Cloud API generation (cached locally)."),
                }
        except ApiBridgeError as exc:
            pass  # fall through to local chain

    ref_path: Path | None = None
    for ref_key in ("character_image_url", "reference_image", "charPhoto", "locationPhoto"):
        ref_url = body.get(ref_key)
        if ref_url:
            ref_path = save_ref_image(ref_url, image_id)
            if ref_path:
                break
    if not ref_path and body.get("referenceImages"):
        for item in body["referenceImages"]:
            url = (item or {}).get("url")
            if url:
                ref_path = save_ref_image(url, image_id)
                if ref_path:
                    break

    out_path = IMAGES_DIR / f"{image_id}.png"
    provider = "pillow-local"
    note = "Pillow reference card fallback."

    if comfy_reachable():
        try:
            comfy_path = run_comfy_image(
                CONFIG,
                WORKFLOWS_DIR,
                model=model,
                prompt=prompt,
                ref_path=ref_path,
                aspect_ratio=aspect,
                resolution=resolution,
                uploads_dir=IMAGES_DIR,
            )
            shutil.copy2(comfy_path, out_path)
            provider = "comfyui-local"
            note = f"Generated via ComfyUI ({model})."
        except ComfyUIError:
            pass
        except Exception as exc:
            note = f"ComfyUI failed ({exc}); trying local GPU."

    if provider != "comfyui-local" and CONFIG.get("use_local_gpu", True) and gpu_packages():
        try:
            generate_image = __import__("diffusers_infer", fromlist=["generate_image"]).generate_image
            generate_image(
                out_path,
                prompt=prompt,
                width=width,
                height=height,
                ref_path=ref_path,
                steps=int(CONFIG.get("gpu", {}).get("steps", 20)),
            )
            provider = "diffusers-local"
            note = f"Stable Diffusion 1.5 on {device_name()} (512px, AMD-friendly)."
        except Exception as exc:
            note = f"Local GPU failed ({exc}); using Pillow fallback."

    if provider not in ("comfyui-local", "diffusers-local"):
        render_reference_card(
            out_path,
            kind=kind,
            name=name,
            prompt=prompt,
            width=width,
            height=height,
            model=model,
        )

    image_url = f"{base_url}/images/{image_id}.png"
    return {
        "prompt": prompt,
        "url": image_url,
        "demo_url": image_url,
        "grok_enriched": False,
        "vision_used": ref_path is not None,
        "model": model,
        "provider": provider,
        "note": note,
    }


def handle_submit(body: dict[str, Any], base_url: str) -> dict[str, Any]:
    if prefer_api():
        api_body = dict(body)
        ref_raw = body.get("character_image_url") or body.get("reference_image")
        if ref_raw:
            cloud_ref = resolve_ref_for_cloud(ref_raw, base_url)
            if cloud_ref:
                api_body["character_image_url"] = cloud_ref
                api_body["reference_image"] = cloud_ref
        try:
            res = api_submit_video(api_body)
            rid = res.get("request_id") or f"api_{uuid.uuid4().hex[:12]}"
            with JOBS_LOCK:
                EXTERNAL_JOBS[rid] = {
                    "provider": res.get("provider", "wavespeed"),
                    "model": body.get("model") or "wan-2.7",
                    "created": time.time(),
                }
            return {
                "request_id": rid,
                "status": res.get("status") or "SUBMITTED",
                "model": body.get("model") or "wan-2.7",
                "note": res.get("note", "Cloud API video job"),
                "provider": res.get("provider", "wavespeed"),
            }
        except ApiBridgeError:
            pass  # fall through to local job

    job_id = f"sb_{uuid.uuid4().hex[:12]}"
    ref_url = body.get("character_image_url") or body.get("reference_image")
    ref_path = save_ref_image(ref_url, job_id) if ref_url else None

    with JOBS_LOCK:
        JOBS[job_id] = {
            "status": "SUBMITTED",
            "model": body.get("model") or "wan-2.7",
            "prompt": body.get("prompt") or "",
            "shot_key": body.get("shotKey") or "",
            "ref_path": str(ref_path) if ref_path else None,
            "created": time.time(),
        }

    thread = threading.Thread(target=run_comfy_job, args=(job_id, body), daemon=True)
    thread.start()
    return {
        "request_id": job_id,
        "status": "SUBMITTED",
        "model": body.get("model") or "wan-2.7",
        "note": "Local bridge — ComfyUI if workflow+GPU available, else ffmpeg placeholder MP4",
        "provider": "shotbreak-local",
    }


def handle_status(request_id: str) -> dict[str, Any]:
    if _is_external_job(request_id):
        with JOBS_LOCK:
            meta = EXTERNAL_JOBS.get(request_id) or {}
        try:
            res = api_video_status(request_id, provider=meta.get("provider"))
            return {
                "request_id": request_id,
                "status": res.get("status", "IN_PROGRESS"),
                "model": meta.get("model"),
                "provider": res.get("provider", meta.get("provider")),
            }
        except ApiBridgeError as exc:
            return {"request_id": request_id, "status": "FAILED", "error": str(exc)}

    with JOBS_LOCK:
        job = JOBS.get(request_id)
    if not job:
        return {"request_id": request_id, "status": "FAILED", "error": "unknown job"}
    return {"request_id": request_id, "status": job.get("status", "IN_PROGRESS"), "model": job.get("model")}


def handle_upload_image(body: dict[str, Any], base_url: str) -> dict[str, Any]:
    data_url = body.get("image_data_url") or body.get("data_url")
    fname = body.get("filename") or "ref.jpg"
    if not data_url:
        return {"error": "image_data_url required"}
    ref_id = f"up_{uuid.uuid4().hex[:10]}"
    ref_path = save_ref_image(data_url, ref_id)
    url = data_url
    if ref_path and ref_path.exists():
        ext = ref_path.suffix or ".jpg"
        dest = IMAGES_DIR / f"{ref_id}{ext}"
        shutil.copy2(ref_path, dest)
        url = f"{base_url}/images/{ref_id}{ext}"
    return {
        "url": url,
        "filename": fname,
        "note": "Local bridge upload — data URL echoed; image cached for XAI refs",
    }


def handle_result(request_id: str, base_url: str) -> dict[str, Any]:
    if _is_external_job(request_id):
        with JOBS_LOCK:
            meta = EXTERNAL_JOBS.get(request_id) or {}
        try:
            res = api_video_result(request_id, cache_dir=OUTPUT_DIR, provider=meta.get("provider"))
            video_url = res.get("video_url")
            if video_url and video_url.startswith("/"):
                video_url = f"{base_url}{video_url}"
            return {
                "request_id": request_id,
                "status": res.get("status", "COMPLETED"),
                "video_url": video_url,
                "model": meta.get("model"),
                "provider": res.get("provider", meta.get("provider")),
            }
        except ApiBridgeError as exc:
            return {"request_id": request_id, "status": "FAILED", "error": str(exc)}

    with JOBS_LOCK:
        job = JOBS.get(request_id)
    if not job:
        return {"request_id": request_id, "status": "FAILED", "error": "unknown job"}
    status = job.get("status", "IN_PROGRESS")
    video_url = None
    if status == "COMPLETED" and job.get("video_path"):
        video_url = f"{base_url}/output/{request_id}.mp4"
    return {
        "request_id": request_id,
        "status": status,
        "video_url": video_url,
        "model": job.get("model"),
        "provider": job.get("provider", "shotbreak-local"),
        "error": job.get("error"),
    }


def serve_static_file(handler: BaseHTTPRequestHandler, file_path: Path, default_mime: str) -> None:
    if not file_path.exists():
        handler.send_error(404)
        return
    data = file_path.read_bytes()
    mime = mimetypes.guess_type(file_path.name)[0] or default_mime
    handler.send_response(200)
    cors_headers(handler)
    handler.send_header("Content-Type", mime)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "ShotbreakLocalBridge/1.2"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[bridge] {self.address_string()} - {fmt % args}")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        cors_headers(self)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            comfy_online = comfy_reachable()
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "comfy": comfy_online,
                    "comfy_host": CONFIG["comfy_host"],
                    "jobs": len(JOBS),
                    "max_wait_sec": CONFIG.get("max_wait_sec", 1800),
                    "poll_interval_sec": CONFIG.get("poll_interval_sec", 2),
                    "gpu": gpu_status(),
                    "api": api_status(),
                    "prefer_api": CONFIG.get("prefer_api", False),
                    "modes": {
                        "image": image_mode(comfy_online=comfy_online),
                        "video": video_mode(comfy_online=comfy_online),
                    },
                    "workflows": {
                        "video": [p.name for p in WORKFLOWS_DIR.glob("*.api.json")],
                        "image_workflow": CONFIG.get("default_image_workflow"),
                    },
                },
            )
            return
        if parsed.path.startswith("/output/"):
            name = parsed.path.split("/output/", 1)[-1]
            if ".." in name or "/" in name:
                self.send_error(400)
                return
            serve_static_file(self, OUTPUT_DIR / name, "video/mp4")
            return
        if parsed.path.startswith("/images/"):
            name = parsed.path.split("/images/", 1)[-1]
            if ".." in name or "/" in name:
                self.send_error(400)
                return
            serve_static_file(self, IMAGES_DIR / name, "image/png")
            return
        self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in ("/generate-video", "/"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            json_response(self, 400, {"error": "Bad JSON"})
            return

        action = body.get("action", "submit")
        host = self.headers.get("Host", "localhost:3456")
        base_url = f"http://{host}"

        if action == "submit":
            json_response(self, 200, handle_submit(body, base_url))
            return
        if action == "status":
            json_response(self, 200, handle_status(body.get("request_id", "")))
            return
        if action == "result":
            json_response(self, 200, handle_result(body.get("request_id", ""), base_url))
            return
        if action == "generate_picture":
            json_response(self, 200, handle_generate_picture(body, base_url))
            return
        if action == "upload_image":
            json_response(self, 200, handle_upload_image(body, base_url))
            return
        if action == "balance":
            json_response(self, 200, {"credits": 999999, "tier": "local"})
            return
        json_response(self, 400, {"error": f"Unknown action: {action}"})


def _bridge_already_running(port: int) -> bool:
    try:
        from urllib import request as urlreq

        with urlreq.urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return bool(data.get("ok"))
    except Exception:
        return False


def main() -> None:
    port = int(CONFIG.get("bridge_port", 3456))
    try:
        server = ThreadingHTTPServer(("0.0.0.0", port), BridgeHandler)
    except OSError as exc:
        if getattr(exc, "winerror", None) == 10048 or exc.errno in (48, 98, 10048):
            if _bridge_already_running(port):
                print(f"Bridge already running on http://localhost:{port} — leave that window open.")
                return
            print(f"Port {port} is in use but health check failed. Close the other process and retry.")
        raise
    print(f"Shotbreak local bridge on http://localhost:{port}")
    print(f"  generate-video -> POST http://localhost:{port}/generate-video")
    print(f"  images         -> GET  http://localhost:{port}/images/<file>")
    print(f"  health         -> GET  http://localhost:{port}/health")
    print(f"  ComfyUI target -> {CONFIG['comfy_host']}")
    api = api_status()
    if api.get("ready"):
        print(f"  Cloud API      -> XAI={api.get('xai')} WaveSpeed={api.get('wavespeed')} (prefer_api={CONFIG.get('prefer_api', False)})")
    else:
        print("  Cloud API      -> no keys (copy .env.example to .env)")
    server.serve_forever()


if __name__ == "__main__":
    main()