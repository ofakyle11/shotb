"""Cloud API bridge — XAI Grok Imagine + WaveSpeed (mirrors netlify/functions/generate-video.js)."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any
from urllib import error, request

from env_loader import get_key

class ApiBridgeError(Exception):
    pass


def _has_grok_key() -> bool:
    return bool(get_key("XAI_API_KEY", "GROK_API_KEY"))


def _has_wavespeed_key() -> bool:
    return bool(get_key("WAVESPEED_API_KEY"))


def api_status() -> dict[str, Any]:
    gk = _has_grok_key()
    wk = _has_wavespeed_key()
    return {
        "xai": gk,
        "wavespeed": wk,
        "ready": gk or wk,
        "xai_masked": _mask(get_key("XAI_API_KEY", "GROK_API_KEY")),
        "wavespeed_masked": _mask(get_key("WAVESPEED_API_KEY")),
    }


def _mask(val: str | None) -> str | None:
    if not val:
        return None
    if len(val) <= 8:
        return "***"
    return val[:4] + "..." + val[-4:]


def _http_json(
    host: str,
    path: str,
    *,
    method: str = "POST",
    payload: dict[str, Any] | None = None,
    bearer: str,
    timeout: float = 120,
) -> Any:
    data = json.dumps(payload or {}).encode("utf-8") if method.upper() != "GET" else None
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {bearer}",
    }
    if data:
        headers["Content-Length"] = str(len(data))
    req = request.Request(f"https://{host}{path}", data=data, method=method, headers=headers)
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise ApiBridgeError(f"HTTP {exc.code} {host}{path}: {body[:800]}") from exc
    except error.URLError as exc:
        raise ApiBridgeError(f"Cannot reach {host}{path}: {exc}") from exc


def get_wavespeed_path(model_id: str, has_ref: bool = False) -> str:
    m = (model_id or "").lower()
    if "seedance" in m:
        return (
            "bytedance/seedance-2.0/image-to-video-turbo"
            if has_ref
            else "bytedance/seedance-2.0/text-to-video-turbo"
        )
    if "wan" in m:
        return "alibaba/wan-2.7/image-to-video" if has_ref else "alibaba/wan-2.7/text-to-video"
    if "sora" in m:
        return "wavespeed-ai/sora-2"
    if "veo" in m:
        return "google/veo-3.1/i2v" if has_ref else "google/veo-3.1/t2v"
    if "nano-banana" in m:
        return f"wavespeed-ai/{'nano-banana-pro' if 'pro' in m else 'nano-banana'}"
    if "gpt-image" in m or "gpt-2" in m:
        return "openai/gpt-image-2"
    return f"wavespeed-ai/{model_id or 'flux-dev'}"


def _ref_for_api(url: str | None) -> str | None:
    if not url:
        return None
    if url.startswith(("http://", "https://", "data:")):
        return url
    return None


def generate_picture(body: dict[str, Any]) -> dict[str, Any]:
    model = body.get("model") or "flux-xai"
    prompt = body.get("prompt") or body.get("desc") or "cinematic reference photo"
    aspect = body.get("aspect_ratio")
    resolution = body.get("resolution")

    ref_url = None
    for key in ("character_image_url", "reference_image", "charPhoto", "locationPhoto"):
        ref_url = ref_url or _ref_for_api(body.get(key))
    if not ref_url and body.get("referenceImages"):
        for item in body["referenceImages"]:
            ref_url = _ref_for_api((item or {}).get("url"))
            if ref_url:
                break

    is_xai = model == "flux-xai" or "flux" in model or "grok-imagine-image" in model
    if is_xai and _has_grok_key():
        payload: dict[str, Any] = {
            "model": "grok-imagine-image-quality",
            "prompt": prompt[:2000],
        }
        if aspect:
            payload["aspect_ratio"] = aspect
        if resolution:
            payload["resolution"] = resolution
        if ref_url:
            payload["image"] = {"url": ref_url}
        res = _http_json("api.x.ai", "/v1/images/generations", payload=payload, bearer=get_key("XAI_API_KEY", "GROK_API_KEY") or "")
        url = (
            res.get("url")
            or (res.get("data") or [{}])[0].get("url")
            or (res.get("images") or [{}])[0].get("url")
        )
        if not url:
            raise ApiBridgeError(f"No image URL from XAI: {res}")
        return {
            "prompt": prompt,
            "url": url,
            "demo_url": url,
            "provider": "xai-imagine",
            "model": model,
            "note": "Real pixels from Grok Imagine via XAI API.",
        }

    if _has_wavespeed_key():
        has_ref = bool(ref_url)
        ws_path = "/api/v3/" + get_wavespeed_path(model, has_ref)
        ws_body: dict[str, Any] = {"model": model, "prompt": prompt[:2000]}
        if aspect:
            ws_body["aspect_ratio"] = aspect
        if resolution:
            ws_body["resolution"] = resolution
        if ref_url:
            ws_body["reference_image"] = ref_url
        res = _http_json(
            "api.wavespeed.ai",
            ws_path,
            payload=ws_body,
            bearer=get_key("WAVESPEED_API_KEY") or "",
        )
        url = (
            (res.get("data") or {}).get("outputs", [None])[0]
            or res.get("url")
            or res.get("image_url")
            or (res.get("data") or {}).get("url")
        )
        if not url and (res.get("data") or {}).get("id"):
            # Async image job — poll predictions
            rid = res["data"]["id"]
            url = _poll_wavespeed_image(rid)
        if not url:
            raise ApiBridgeError(f"No image URL from WaveSpeed: {res}")
        return {
            "prompt": prompt,
            "url": url,
            "demo_url": url,
            "provider": "wavespeed",
            "model": model,
            "note": f"Generated via {model} on WaveSpeed.",
        }

    raise ApiBridgeError("No API keys — set XAI_API_KEY and/or WAVESPEED_API_KEY in local-backend/.env")


def _poll_wavespeed_image(request_id: str, max_wait: int = 180) -> str | None:
    import time

    bearer = get_key("WAVESPEED_API_KEY") or ""
    for _ in range(max_wait // 3):
        res = _http_json("api.wavespeed.ai", f"/api/v3/predictions/{request_id}", method="GET", bearer=bearer)
        st = ((res.get("data") or {}).get("status") or res.get("status") or "").lower()
        out = (res.get("data") or {}).get("outputs") or res.get("outputs")
        if out and out[0]:
            return out[0]
        if st in ("completed", "succeeded", "success"):
            break
        if st in ("failed", "error"):
            raise ApiBridgeError(f"WaveSpeed image failed: {res}")
        time.sleep(3)
    return None


def submit_video(body: dict[str, Any]) -> dict[str, Any]:
    model = body.get("model") or "wan-2.7"
    prompt = body.get("prompt") or "cinematic shot"
    duration = int(body.get("duration") or 6)
    aspect = body.get("aspect_ratio") or "16:9"
    ref = _ref_for_api(body.get("character_image_url") or body.get("reference_image"))

    if (model == "grok-imagine" or "grok-imagine" in model) and _has_grok_key():
        payload: dict[str, Any] = {
            "model": "grok-imagine-video",
            "prompt": prompt[:2000],
            "duration": duration,
            "aspect_ratio": aspect,
            "resolution": body.get("resolution") or "720p",
        }
        if ref:
            payload["image"] = {"url": ref}
        if body.get("shotKey"):
            payload["shot_key"] = body["shotKey"]
        res = _http_json("api.x.ai", "/v1/videos/generations", payload=payload, bearer=get_key("XAI_API_KEY", "GROK_API_KEY") or "")
        rid = res.get("id") or res.get("request_id") or f"grok_{uuid.uuid4().hex[:12]}"
        return {
            "request_id": rid,
            "status": res.get("status") or "SUBMITTED",
            "model": model,
            "provider": "xai-imagine",
            "note": "Video via XAI Grok Imagine API",
        }

    if _has_wavespeed_key():
        has_ref = bool(ref)
        ws_path = "/api/v3/" + get_wavespeed_path(model, has_ref)
        ws_body: dict[str, Any] = {
            "prompt": prompt[:2000],
            "duration": duration,
            "aspect_ratio": aspect,
        }
        if body.get("resolution"):
            ws_body["resolution"] = body["resolution"]
        if ref:
            ws_body["reference_image"] = ref
        if body.get("shotKey"):
            ws_body["shot_key"] = body["shotKey"]
        res = _http_json("api.wavespeed.ai", ws_path, payload=ws_body, bearer=get_key("WAVESPEED_API_KEY") or "")
        rid = (res.get("data") or {}).get("id") or res.get("id") or res.get("request_id") or f"ws_{uuid.uuid4().hex[:12]}"
        st = (res.get("data") or {}).get("status") or res.get("status") or "SUBMITTED"
        return {
            "request_id": rid,
            "status": st,
            "model": model,
            "provider": "wavespeed",
            "note": f"Video via WaveSpeed ({model})",
        }

    raise ApiBridgeError("No API keys for video — set XAI_API_KEY and/or WAVESPEED_API_KEY in local-backend/.env")


def is_api_job(request_id: str) -> bool:
    if not request_id:
        return False
    if request_id.startswith("sb_"):
        return False
    return True


def video_status(request_id: str, provider: str | None = None) -> dict[str, Any]:
    use_xai = provider == "xai-imagine" or request_id.startswith("grok_")
    if use_xai and _has_grok_key():
        res = _http_json("api.x.ai", f"/v1/videos/{request_id}", method="GET", bearer=get_key("XAI_API_KEY", "GROK_API_KEY") or "")
        return {
            "request_id": request_id,
            "status": (res.get("status") or res.get("state") or "IN_PROGRESS").upper(),
            "provider": "xai-imagine",
        }

    if _has_wavespeed_key():
        res = _http_json(
            "api.wavespeed.ai",
            f"/api/v3/predictions/{request_id}",
            method="GET",
            bearer=get_key("WAVESPEED_API_KEY") or "",
        )
        st = (res.get("data") or {}).get("status") or res.get("status") or "processing"
        return {"request_id": request_id, "status": str(st).upper(), "provider": "wavespeed"}

    raise ApiBridgeError("No API keys configured")


def video_result(request_id: str, cache_dir: Path | None = None, provider: str | None = None) -> dict[str, Any]:
    video_url = None
    prov = provider or "wavespeed"
    status = "COMPLETED"

    use_xai = provider == "xai-imagine" or request_id.startswith("grok_")
    if use_xai and _has_grok_key():
        res = _http_json("api.x.ai", f"/v1/videos/{request_id}", method="GET", bearer=get_key("XAI_API_KEY", "GROK_API_KEY") or "")
        video_url = (
            res.get("video_url")
            or res.get("url")
            or (res.get("video") or {}).get("url")
            or ((res.get("outputs") or [None])[0])
            or (res.get("data") or {}).get("video_url")
        )
        status = (res.get("status") or "COMPLETED").upper()
        prov = "xai-imagine"

    if not video_url and _has_wavespeed_key():
        bearer = get_key("WAVESPEED_API_KEY") or ""
        try:
            res = _http_json("api.wavespeed.ai", f"/api/v3/predictions/{request_id}/result", method="GET", bearer=bearer)
        except ApiBridgeError:
            res = _http_json("api.wavespeed.ai", f"/api/v3/predictions/{request_id}", method="GET", bearer=bearer)
        video_url = (
            (res.get("data") or {}).get("outputs", [None])[0]
            or (res.get("outputs") or [None])[0]
            or res.get("video_url")
            or res.get("url")
            or (res.get("data") or {}).get("video_url")
        )
        status = ((res.get("data") or {}).get("status") or res.get("status") or "COMPLETED").upper()
        prov = "wavespeed"

    if not video_url:
        raise ApiBridgeError(f"No video URL for job {request_id}")

    local_url = video_url
    if cache_dir and video_url.startswith("http"):
        local_url = _cache_remote_video(video_url, request_id, cache_dir)

    return {
        "request_id": request_id,
        "status": status,
        "video_url": local_url,
        "provider": prov,
    }


def cache_remote_image(url: str, dest: Path) -> Path:
    if url.startswith("data:"):
        import base64

        header, b64 = url.split(",", 1)
        dest.write_bytes(base64.b64decode(b64))
        return dest
    with request.urlopen(url, timeout=120) as resp:
        dest.write_bytes(resp.read())
    return dest


def _cache_remote_video(url: str, request_id: str, cache_dir: Path) -> str:
    safe_id = request_id.replace("/", "_").replace("..", "")
    dest = cache_dir / f"{safe_id}.mp4"
    if dest.exists() and dest.stat().st_size > 1000:
        return f"/output/{dest.name}"
    try:
        with request.urlopen(url, timeout=180) as resp:
            dest.write_bytes(resp.read())
        return f"/output/{dest.name}"
    except Exception:
        return url