"""The bridge must never sit on a render that ComfyUI has already finished.

Reproduces the failure seen on the generation machine: ComfyUI reported
success and wrote the file, but the bridge could not resolve it and kept the
job queued for the full timeout instead of saying so.
Run: python3 scripts/test_comfy_wait.py
"""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "local-backend"))
from comfy_client import ComfyUIClient, ComfyUIError

passed = failed = 0
def check(name, cond):
    global passed, failed
    if cond: passed += 1
    else:
        failed += 1
        print("  x " + name)

class Fake(ComfyUIClient):
    def __init__(self, entry):
        self._entry = entry
        self.host = "http://127.0.0.1:8188"
    def get_history(self, prompt_id):
        return {prompt_id: self._entry}

# 1. finished + success, but the output key is one the bridge cannot read
started = time.time()
try:
    Fake({"outputs": {"58": {"audio": [{"filename": "x.flac"}]}},
          "status": {"status_str": "success", "completed": True}}).wait_for_outputs("p1", poll_interval=0.1)
    check("unreadable-but-finished raises", False)
except ComfyUIError as e:
    took = time.time() - started
    check("unreadable-but-finished raises", True)
    check("it raises immediately, not after the timeout", took < 2)
    check("the error names the keys actually seen", "audio" in str(e))
    check("the error points at ComfyUI's output folder", "output folder" in str(e))

# 2. ComfyUI reporting an error surfaces the reason
try:
    Fake({"outputs": {}, "status": {"status_str": "error", "completed": False,
          "messages": [["execution_error", {"exception_message": "CUDA out of memory",
                                            "node_type": "KSampler"}]]}}).wait_for_outputs("p2", poll_interval=0.1)
    check("comfy error raises", False)
except ComfyUIError as e:
    check("comfy error raises", True)
    check("the reason is carried through", "CUDA out of memory" in str(e))
    check("the failing node is named", "KSampler" in str(e))

# 3. a real success still returns its files (mp4 under the images key, as seen on the rig)
files = Fake({"outputs": {"58": {"images": [
    {"filename": "i2v5_00001_.mp4", "subfolder": "cinamate", "type": "output"}]}},
    "status": {"status_str": "success", "completed": True}}).wait_for_outputs("p3", poll_interval=0.1)
check("a finished render still returns its file", len(files) == 1)
check("filename preserved", files[0]["filename"] == "i2v5_00001_.mp4")
check("subfolder preserved", files[0]["subfolder"] == "cinamate")

# 4. still running -> keeps waiting, then times out rather than lying
started = time.time()
try:
    Fake({"outputs": {}, "status": {"status_str": "", "completed": False}}).wait_for_outputs(
        "p4", poll_interval=0.1, max_wait_sec=0.4)
    check("an unfinished run times out", False)
except ComfyUIError as e:
    check("an unfinished run times out", "Timed out" in str(e))
    check("it actually waited", time.time() - started >= 0.3)

print("test_comfy_wait: %d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
