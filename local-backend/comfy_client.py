"""ComfyUI HTTP client."""

from __future__ import annotations

import json
import mimetypes
import uuid
from pathlib import Path
from typing import Any
from urllib import error, parse, request


class ComfyUIError(Exception):
    pass


class ComfyUIClient:
    def __init__(self, host: str) -> None:
        self.host = host.rstrip("/")

    def _request(
        self,
        method: str,
        path: str,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        url = f"{self.host}{path}"
        req = request.Request(url, data=data, method=method, headers=headers or {})
        try:
            with request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
                if not raw:
                    return None
                return json.loads(raw.decode("utf-8"))
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ComfyUIError(f"HTTP {exc.code} {path}: {body[:500]}") from exc
        except error.URLError as exc:
            raise ComfyUIError(f"Cannot reach ComfyUI at {self.host}: {exc}") from exc

    def health(self, timeout: float = 3.0) -> dict[str, Any]:
        url = f"{self.host}/system_stats"
        try:
            with request.urlopen(url, timeout=timeout) as resp:
                raw = resp.read()
                return json.loads(raw.decode("utf-8")) if raw else {}
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ComfyUIError(f"HTTP {exc.code} /system_stats: {body[:500]}") from exc
        except error.URLError as exc:
            raise ComfyUIError(f"Cannot reach ComfyUI at {self.host}: {exc}") from exc

    def upload_image(self, image_path: Path, subfolder: str = "shotbreak") -> str:
        boundary = f"----ShotbreakBoundary{uuid.uuid4().hex}"
        mime = mimetypes.guess_type(image_path.name)[0] or "image/png"
        file_bytes = image_path.read_bytes()

        parts: list[bytes] = []
        for name, value in (("image", image_path.name), ("subfolder", subfolder), ("type", "input")):
            parts.append(f"--{boundary}\r\n".encode())
            parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            parts.append(value.encode("utf-8"))
            parts.append(b"\r\n")

        parts.append(f"--{boundary}\r\n".encode())
        parts.append(
            f'Content-Disposition: form-data; name="image"; filename="{image_path.name}"\r\n'.encode()
        )
        parts.append(f"Content-Type: {mime}\r\n\r\n".encode())
        parts.append(file_bytes)
        parts.append(b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())

        payload = b"".join(parts)
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        result = self._request("POST", "/upload/image", data=payload, headers=headers)
        if not result or "name" not in result:
            raise ComfyUIError(f"Upload failed: {result}")
        return result["name"]

    def queue_prompt(self, workflow: dict[str, Any], client_id: str | None = None) -> str:
        payload = {
            "prompt": workflow,
            "client_id": client_id or f"shotbreak_{uuid.uuid4().hex[:12]}",
        }
        result = self._request(
            "POST",
            "/prompt",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        prompt_id = (result or {}).get("prompt_id")
        if not prompt_id:
            raise ComfyUIError(f"No prompt_id from ComfyUI: {result}")
        return prompt_id

    def get_history(self, prompt_id: str) -> dict[str, Any]:
        return self._request("GET", f"/history/{prompt_id}") or {}

    def extract_output_files(self, history_entry: dict[str, Any]) -> list[dict[str, str]]:
        outputs: list[dict[str, str]] = []
        for node_out in (history_entry.get("outputs") or {}).values():
            for key in ("gifs", "videos", "images"):
                for item in node_out.get(key) or []:
                    if isinstance(item, dict) and item.get("filename"):
                        outputs.append(
                            {
                                "filename": item["filename"],
                                "subfolder": item.get("subfolder", ""),
                                "type": item.get("type", "output"),
                                "kind": key,
                            }
                        )
        return outputs

    def download_view(self, file_info: dict[str, str]) -> bytes:
        """Fetch a ComfyUI output via GET /view (works across machines)."""
        filename = file_info.get("filename")
        if not filename:
            raise ComfyUIError("download_view: missing filename")
        params = parse.urlencode(
            {
                "filename": filename,
                "subfolder": file_info.get("subfolder", ""),
                "type": file_info.get("type", "output"),
            }
        )
        url = f"{self.host}/view?{params}"
        try:
            with request.urlopen(url, timeout=120) as resp:
                return resp.read()
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ComfyUIError(f"HTTP {exc.code} /view: {body[:500]}") from exc
        except error.URLError as exc:
            raise ComfyUIError(f"Cannot download from ComfyUI at {url}: {exc}") from exc

    def wait_for_outputs(
        self,
        prompt_id: str,
        *,
        poll_interval: float = 2.0,
        max_wait_sec: float = 1800,
    ) -> list[dict[str, str]]:
        import time

        deadline = time.time() + max_wait_sec
        while time.time() < deadline:
            history = self.get_history(prompt_id)
            entry = history.get(prompt_id) if isinstance(history, dict) else None
            if entry and entry.get("outputs"):
                files = self.extract_output_files(entry)
                if files:
                    return files
            time.sleep(poll_interval)
        raise ComfyUIError(f"Timed out waiting for ComfyUI prompt {prompt_id}")