# ComfyUI Workflows for Shotbreak Local

Starter templates are included. **Replace checkpoint/model names** with what you have installed, or re-export from your working ComfyUI graph as **API Format JSON**.

| File | Shotbreak model |
|------|-----------------|
| `txt2img.api.json` | flux-xai, wan-2.7, nano-banana*, gpt-image-2 (character + location photos) |
| `wan_i2v.api.json` | wan-2.7 video (default) |
| `quality_i2v.api.json` | grok-imagine, sora-2, veo-3.1 |
| `svd_xt.api.json` | seedance-2.0-turbo |

## Requirements

- **Images:** `CLIPTextEncode` with `inputs.text` + `EmptyLatentImage` for width/height injection.
- **Video:** `CLIPTextEncode` for prompt + `LoadImage` for character reference (I2V).
- Shotbreak downloads outputs via ComfyUI `GET /view` — no shared filesystem required.

## ComfyUI on GPU machine

```bash
python main.py --listen 0.0.0.0 --port 8188
```

Set `comfy_host` in `local-backend/config.json` to your GPU machine IP, e.g. `http://192.168.1.50:8188`.

Optional: set `comfy_output_dir` if you want filesystem fallback in addition to `/view`.

## Without ComfyUI

- **Images:** Pillow reference cards at `GET /images/<id>.png` (much better than browser canvas).
- **Video:** ffmpeg placeholder MP4 so stitch/export still works.