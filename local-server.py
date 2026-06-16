"""
Shotbreak local UI server with COOP/COEP headers required for ffmpeg.wasm stitch export.
"""

from __future__ import annotations

import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8080


class LocalUIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def guess_type(self, path: str) -> str:
        ctype = super().guess_type(path)
        if path.endswith(".wasm"):
            return "application/wasm"
        if path.endswith(".js"):
            return "text/javascript"
        return ctype


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), LocalUIHandler)
    print(f"Shotbreak local UI on http://localhost:{PORT}/app.html")
    print("  COOP/COEP enabled for ffmpeg.wasm stitch export")
    server.serve_forever()


if __name__ == "__main__":
    main()