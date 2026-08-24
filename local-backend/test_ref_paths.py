"""The bridge mints its own reference URLs and feeds them back to itself.

handle_generate_picture and handle_upload_image return
http://127.0.0.1:<port>/images/<id>, and ordinary character-consistency work
sends those straight back into save_ref_image. A blanket "https only, public
addresses only" rule would refuse them — and save_ref_image swallows every
exception, so the operator would just silently stop getting reference
continuity with no error anywhere.

So our own media URLs are read off disk instead, and this pins both halves:
the real workflow keeps working, and dressing a hostile URL up as one of ours
does not get it fetched or read.

Run: python local-backend/test_ref_paths.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"  x {label}{(': ' + str(detail)) if detail else ''}")


server.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
server.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
probe = server.IMAGES_DIR / "test_ref_probe.jpg"
probe.write_bytes(b"\xff\xd8REFERENCE-BYTES")

port = int(server.CONFIG.get("bridge_port", 3456))

# ── our own refs resolve to a file ───────────────────────────────────────
for label, url in [
    ("a ref this bridge minted", f"http://127.0.0.1:{port}/images/test_ref_probe.jpg"),
    ("the localhost spelling", f"http://localhost:{port}/images/test_ref_probe.jpg"),
    ("a different port on loopback", f"http://127.0.0.1:9999/images/test_ref_probe.jpg"),
]:
    check(label, server._local_media_path(url) is not None, url)

check("an output clip resolves",
      server._local_media_path(f"http://127.0.0.1:{port}/output/x.mp4") is not None)
check("an uploads path resolves",
      server._local_media_path(f"http://127.0.0.1:{port}/uploads/x.jpg") is not None)

# ── everything else does not ─────────────────────────────────────────────
for label, url in [
    ("traversal out of the media directory", f"http://127.0.0.1:{port}/images/../config.json"),
    ("an encoded traversal", f"http://127.0.0.1:{port}/images/..%2Fconfig.json"),
    ("a nested path", f"http://127.0.0.1:{port}/images/sub/x.jpg"),
    ("a backslash path", f"http://127.0.0.1:{port}/images/sub\\x.jpg"),
    ("an empty name", f"http://127.0.0.1:{port}/images/"),
    ("a non-media endpoint on our own port", f"http://127.0.0.1:{port}/health"),
    ("the co-located ComfyUI", "http://127.0.0.1:8188/history"),
    ("a LAN host", "http://192.168.1.1/admin"),
    ("cloud metadata", "http://169.254.169.254/latest/meta-data/"),
    ("a foreign host", "https://evil.example/images/x.jpg"),
    ("a foreign host with a loopback-looking path",
     "https://evil.example/images/../../127.0.0.1/images/x.jpg"),
]:
    check(f"refuses {label}", server._local_media_path(url) is None, url)

# ── end to end through save_ref_image ────────────────────────────────────
got = server.save_ref_image(f"http://127.0.0.1:{port}/images/test_ref_probe.jpg", "testjob")
check("our own ref is saved without any network call", got is not None and got.exists())
if got:
    check("the bytes came from our file", got.read_bytes() == b"\xff\xd8REFERENCE-BYTES")
    got.unlink(missing_ok=True)

check("the co-located ComfyUI is refused",
      server.save_ref_image("http://127.0.0.1:8188/history", "testjob2") is None)
check("a LAN address is refused",
      server.save_ref_image("http://192.168.1.1/admin", "testjob3") is None)
check("cloud metadata is refused",
      server.save_ref_image("http://169.254.169.254/latest/meta-data/", "testjob4") is None)
check("a data: image still works",
      server.save_ref_image(
          "data:image/png;base64,iVBORw0KGgo=", "testjob5") is not None)

# ── the bridge key gate ──────────────────────────────────────────────────
class _H:
    def __init__(self, headers):
        self.headers = headers


saved_key = server.CONFIG.get("api_key")
server.CONFIG["api_key"] = ""
check("with no key configured the bridge stays open", server.check_api_key(_H({})))
server.CONFIG["api_key"] = "a-long-random-bridge-key"
check("a configured key is required", not server.check_api_key(_H({})))
check("a wrong key is refused", not server.check_api_key(_H({"X-API-Key": "wrong"})))
check("the right key is accepted",
      server.check_api_key(_H({"X-API-Key": "a-long-random-bridge-key"})))
if saved_key is None:
    server.CONFIG.pop("api_key", None)
else:
    server.CONFIG["api_key"] = saved_key

# ── CORS is an allow-list, not a mirror ──────────────────────────────────
origins = server.allowed_origins()
check("the studio origin is allowed", "https://cinamate-studio.netlify.app" in origins)
check("loopback is allowed", f"http://127.0.0.1:{port}" in origins)
check("an arbitrary site is not allowed", "https://evil.example" not in origins)

for leftover in ("testjob2_ref.jpg", "testjob3_ref.jpg", "testjob4_ref.jpg"):
    (server.UPLOADS_DIR / leftover).unlink(missing_ok=True)
for stray in server.UPLOADS_DIR.glob("testjob5_ref.*"):
    stray.unlink(missing_ok=True)
probe.unlink(missing_ok=True)

# ── Windows path semantics ───────────────────────────────────────────────
# This bridge runs on the operator's Windows workstation. pathlib follows the
# host's rules, so a name the old ".." / "/" filter allowed could still leave
# the directory entirely: a root-relative path replaces the base, a UNC path
# makes the machine authenticate to someone else's SMB server, and a drive
# letter hops volume. None of those contain ".." or a forward slash.
from pathlib import PureWindowsPath  # noqa: E402

_win_base = PureWindowsPath(r"C:\cinamate\local-backend\output")
for label, name, expected_escape in [
    ("a root-relative path", r"\Windows\win.ini",
     r"C:\Windows\win.ini"),
    ("a UNC path", r"\\attacker.example\share\x",
     r"\\attacker.example\share\x"),
    ("a drive-relative path", "D:secret.txt", "D:secret.txt"),
]:
    # First: prove the escape is real on Windows, so this test keeps meaning
    # something if anyone ever loosens the filter.
    check(f"{label} really does escape on Windows",
          str(_win_base / name) == expected_escape, str(_win_base / name))
    # Then: prove safe_media_path refuses it.
    check(f"safe_media_path refuses {label}",
          server.safe_media_path(server.OUTPUT_DIR, name) is None, name)

for label, name in [
    ("a backslash separator", r"sub\x.mp4"),
    ("a reserved device name", "CON"),
    ("a reserved device with an extension", "con.mp4"),
    ("a serial device", "COM1"),
    ("an alternate data stream", "x.mp4:hidden"),
    ("an embedded NUL", "x\x00.mp4"),
    ("an over-long name", "a" * 300),
    ("an empty name", ""),
    ("a parent reference", "../config.json"),
]:
    check(f"safe_media_path refuses {label}",
          server.safe_media_path(server.OUTPUT_DIR, name) is None, repr(name))

check("safe_media_path still allows an ordinary file",
      server.safe_media_path(server.OUTPUT_DIR, "job_123.mp4") is not None)

# ── the GET handlers must authorise, not just POST ───────────────────────
import inspect  # noqa: E402
_get_src = inspect.getsource(server.BridgeHandler.do_GET)
check("do_GET checks the bridge key", "check_api_key" in _get_src)
check("do_GET still lets media through without a header",
      "/images/" in _get_src and "/output/" in _get_src)
_post_src = inspect.getsource(server.BridgeHandler.do_POST)
check("do_POST refuses a foreign Origin before dispatching",
      "allowed_origins()" in _post_src and _post_src.index("allowed_origins()") < _post_src.index('action = body.get'))
check("do_POST requires application/json",
      "application/json" in _post_src)

print(f"test_ref_paths: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
