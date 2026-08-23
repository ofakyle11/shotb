"""Plain-English status of the Cinamate generation machine.
Run via CHECK_CINAMATE.bat (or: py _health_report.py)."""
import json
import urllib.request
import urllib.error

def get(url, timeout=6):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def line(label, ok, good, bad):
    print("  [%s] %-22s %s" % ("OK" if ok else "--", label, good if ok else bad))

print()
print("=" * 66)
print("  CINAMATE - generation machine status")
print("=" * 66)
print()

try:
    h = get("http://127.0.0.1:3456/health")
except Exception as e:
    print("  [--] BRIDGE IS NOT RUNNING on http://127.0.0.1:3456")
    print()
    print("       Start it with START_CINAMATE.bat and run this again.")
    print("       (detail: %s)" % e)
    print()
    raise SystemExit(0)

print("  [OK] Bridge is running on http://127.0.0.1:3456")
print()
line("ffmpeg", bool(h.get("ffmpeg")),
     "found - can write MP4s",
     "MISSING - installing this is step one")
gpu = h.get("gpu") or {}
line("local GPU", bool(gpu.get("ready")),
     "ready (%s)" % (gpu.get("device") or "?"),
     "not set up - %s" % (gpu.get("error") or "run install-local-gpu.bat"))
line("ComfyUI", bool(h.get("comfy")),
     "reachable at %s" % h.get("comfy_host"),
     "not running at %s" % h.get("comfy_host"))
api = h.get("api") or {}
line("cloud API keys", bool(api.get("ready")),
     "configured (optional)",
     "none in .env (optional - only for cloud fallback)")
modes = h.get("modes") or {}
if modes:
    print()
    print("  Right now this machine would generate:")
    for k, v in modes.items():
        print("     %-7s -> %s" % (k, v))

try:
    get("http://127.0.0.1:3457/research/health")
    print()
    print("  [OK] Research service is running on http://127.0.0.1:3457")
except Exception:
    print()
    print("  [--] Research service is not running (prop-house lookups off)")

print()
print("=" * 66)
print("  Copy this whole window (or screenshot it) and send it to Claude.")
print("=" * 66)
print()
