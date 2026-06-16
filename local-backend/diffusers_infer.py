"""Local Stable Diffusion 1.5 via DirectML (AMD GPU) or CPU — fits 1GB iGPU."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

os.environ.setdefault("DIFFUSERS_NO_FLASH_ATTN", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

_LOCK = threading.Lock()
_T2I_PIPE: Any = None
_I2I_PIPE: Any = None
_DEVICE: Any = None
_DEVICE_NAME = "unavailable"
_AVAILABLE = False
_INIT_ERROR: str | None = None


def _cap_dims(width: int, height: int, device_label: str) -> tuple[int, int]:
    max_side = 256 if "DirectML" in device_label else 512
    width = max(256, min(width, 768))
    height = max(256, min(height, 768))
    if max(width, height) <= max_side:
        return (width // 8) * 8, (height // 8) * 8
    scale = max_side / max(width, height)
    return (int(width * scale) // 8) * 8, (int(height * scale) // 8) * 8


def _load_pipeline(device: Any, label: str) -> Any:
    import torch
    from diffusers import StableDiffusionPipeline

    model_id = "runwayml/stable-diffusion-v1-5"
    pipe = StableDiffusionPipeline.from_pretrained(
        model_id,
        safety_checker=None,
        requires_safety_checker=False,
    )
    pipe = pipe.to(device)
    pipe.enable_attention_slicing()
    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    global _DEVICE, _DEVICE_NAME, _T2I_PIPE, _I2I_PIPE, _AVAILABLE
    _DEVICE = device
    _DEVICE_NAME = label
    _T2I_PIPE = pipe
    _I2I_PIPE = None
    _AVAILABLE = True
    return pipe


def _pick_directml() -> tuple[Any, str] | None:
    try:
        import torch_directml

        return torch_directml.device(), "AMD DirectML (256px)"
    except Exception:
        return None


def packages_installed() -> bool:
    try:
        import diffusers  # noqa: F401
        import torch  # noqa: F401
        return True
    except ImportError:
        return False


def is_ready() -> bool:
    return _T2I_PIPE is not None and _AVAILABLE


def is_available() -> bool:
    _ensure_init()
    return _AVAILABLE


def device_name() -> str:
    _ensure_init()
    return _DEVICE_NAME


def init_error() -> str | None:
    _ensure_init()
    return _INIT_ERROR


def _ensure_init() -> None:
    global _AVAILABLE, _INIT_ERROR
    if _INIT_ERROR is not None or _T2I_PIPE is not None:
        return
    with _LOCK:
        if _INIT_ERROR is not None or _T2I_PIPE is not None:
            return
        try:
            import torch

            pref = os.environ.get("SHOTBREAK_GPU_DEVICE", "cpu")
            if pref == "cpu":
                _load_pipeline(torch.device("cpu"), "CPU")
                return
            dml = _pick_directml() if pref in ("auto", "directml") else None
            if dml:
                try:
                    _load_pipeline(dml[0], dml[1])
                    return
                except Exception as exc:
                    _INIT_ERROR = f"DirectML load failed: {exc}"
            _load_pipeline(torch.device("cpu"), "CPU (1GB iGPU uses CPU for SD 1.5)")
            _INIT_ERROR = None
        except Exception as exc:
            _INIT_ERROR = str(exc)
            _AVAILABLE = False


def _reinit_cpu() -> None:
    global _INIT_ERROR, _T2I_PIPE, _I2I_PIPE, _AVAILABLE
    import torch

    with _LOCK:
        _T2I_PIPE = None
        _I2I_PIPE = None
        _AVAILABLE = False
        _INIT_ERROR = None
        _load_pipeline(torch.device("cpu"), "CPU (GPU OOM fallback)")


def _get_i2i():
    global _I2I_PIPE
    _ensure_init()
    if not _AVAILABLE:
        raise RuntimeError(_INIT_ERROR or "diffusers not available")
    if _I2I_PIPE is not None:
        return _I2I_PIPE
    with _LOCK:
        if _I2I_PIPE is not None:
            return _I2I_PIPE
        from diffusers import StableDiffusionImg2ImgPipeline

        _I2I_PIPE = StableDiffusionImg2ImgPipeline(
            vae=_T2I_PIPE.vae,
            text_encoder=_T2I_PIPE.text_encoder,
            tokenizer=_T2I_PIPE.tokenizer,
            unet=_T2I_PIPE.unet,
            scheduler=_T2I_PIPE.scheduler,
            safety_checker=None,
            feature_extractor=None,
            requires_safety_checker=False,
        )
        _I2I_PIPE = _I2I_PIPE.to(_DEVICE)
        _I2I_PIPE.enable_attention_slicing()
        return _I2I_PIPE


def _run_pipe(
    *,
    prompt: str,
    width: int,
    height: int,
    ref_path: Path | None,
    steps: int,
    cfg: float,
    seed: int,
):
    import torch
    from PIL import Image

    w, h = _cap_dims(width, height, _DEVICE_NAME)
    generator = torch.Generator(device="cpu").manual_seed(seed)
    short_prompt = prompt[:380]

    if ref_path and ref_path.exists():
        i2i = _get_i2i()
        init_image = Image.open(ref_path).convert("RGB").resize((w, h))
        return i2i(
            prompt=short_prompt,
            image=init_image,
            strength=0.55,
            num_inference_steps=steps,
            guidance_scale=cfg,
            generator=generator,
        )
    return _T2I_PIPE(
        prompt=short_prompt,
        width=w,
        height=h,
        num_inference_steps=steps,
        guidance_scale=cfg,
        generator=generator,
    )


def generate_image(
    dest: Path,
    *,
    prompt: str,
    width: int,
    height: int,
    ref_path: Path | None = None,
    steps: int = 20,
    cfg: float = 7.0,
    seed: int = 42,
) -> Path:
    _ensure_init()
    if not _AVAILABLE:
        raise RuntimeError(_INIT_ERROR or "Install GPU deps: run install-local-gpu.bat")

    try:
        result = _run_pipe(
            prompt=prompt,
            width=width,
            height=height,
            ref_path=ref_path,
            steps=steps,
            cfg=cfg,
            seed=seed,
        )
    except RuntimeError as exc:
        if "not enough GPU video memory" in str(exc).lower() and "CPU" not in _DEVICE_NAME:
            _reinit_cpu()
            result = _run_pipe(
                prompt=prompt,
                width=width,
                height=height,
                ref_path=ref_path,
                steps=steps,
                cfg=cfg,
                seed=seed,
            )
        else:
            raise

    dest.parent.mkdir(parents=True, exist_ok=True)
    result.images[0].save(dest, format="PNG", optimize=True)
    return dest