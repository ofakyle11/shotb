"""The bridge runs on the operator's own workstation, inside their network.

An unguarded fetch there is worth more to an attacker than one on a server:
it reads the loopback ComfyUI, the LAN, and anything else the machine can
reach. These are the shapes that used to get through.

Run: python local-backend/test_safe_fetch.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import safe_fetch  # noqa: E402

PASS = 0
FAIL = 0


def refuses(label, url, hosts=None):
    global PASS, FAIL
    try:
        safe_fetch.check_url(url, hosts)
    except safe_fetch.UnsafeUrl:
        PASS += 1
        return
    except Exception as exc:                      # resolution failures still count
        if isinstance(exc, safe_fetch.UnsafeUrl):
            PASS += 1
            return
        FAIL += 1
        print(f"  x {label}: raised {type(exc).__name__} instead of UnsafeUrl")
        return
    FAIL += 1
    print(f"  x {label}: ACCEPTED {url}")


def ok(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"  x {label}{(': ' + detail) if detail else ''}")


# ── the original exploit: loopback and LAN reads ─────────────────────────
refuses("loopback by name", "http://localhost:8188/history")
refuses("loopback by address", "http://127.0.0.1:8188/history")
refuses("the co-located ComfyUI over https", "https://127.0.0.1:8188/history")
refuses("IPv6 loopback", "https://[::1]:8188/history")
refuses("IPv4-mapped IPv6 loopback", "https://[::ffff:127.0.0.1]/history")
refuses("RFC1918 10/8", "https://10.0.0.5/admin")
refuses("RFC1918 192.168/16", "https://192.168.1.1/")
refuses("RFC1918 172.16/12", "https://172.16.0.1/")
refuses("link-local cloud metadata", "https://169.254.169.254/latest/meta-data/")
refuses("carrier-grade NAT", "https://100.64.0.1/")
refuses("0.0.0.0", "https://0.0.0.0/")

# ── scheme tricks ────────────────────────────────────────────────────────
refuses("plain http even to a listed host", "http://image.tmdb.org/t/p/w500/x.jpg")
refuses("file scheme", "file:///C:/Users/operator/.ssh/id_rsa")
refuses("gopher scheme", "gopher://127.0.0.1:8188/_x")
refuses("no scheme", "//127.0.0.1/x")

# ── host allow-list ──────────────────────────────────────────────────────
refuses("unlisted host", "https://evil.example/x.jpg")
refuses("listed host as a subdomain of an attacker domain",
        "https://image.tmdb.org.evil.example/x.jpg")
refuses("listed host in the userinfo, not the host",
        "https://image.tmdb.org@evil.example/x.jpg")
refuses("trailing-dot form of an unlisted host", "https://evil.example./x.jpg")

# ── the guard must still allow the real feature ──────────────────────────
try:
    host = safe_fetch.check_url("https://image.tmdb.org/t/p/w500/abc.jpg")
    ok("a real poster URL is still allowed", host == "image.tmdb.org", host)
except safe_fetch.UnsafeUrl as exc:
    # No DNS in a sandbox — that is a resolution failure, not a policy failure.
    ok("a real poster URL is still allowed",
       "could not resolve" in str(exc), f"unexpected refusal: {exc}")

# ── address classifier, checked directly ─────────────────────────────────
ok("public IPv4 is public", safe_fetch._is_public_address("8.8.8.8"))
ok("public IPv6 is public", safe_fetch._is_public_address("2001:4860:4860::8888"))
ok("127.0.0.1 is not public", not safe_fetch._is_public_address("127.0.0.1"))
ok("::1 is not public", not safe_fetch._is_public_address("::1"))
ok("::ffff:10.0.0.1 is not public", not safe_fetch._is_public_address("::ffff:10.0.0.1"))
ok("garbage is not public", not safe_fetch._is_public_address("not-an-ip"))

# ── redirects are refused, not followed ──────────────────────────────────
ok("a redirect handler that refuses is installed",
   safe_fetch._NoRedirect is not None)
try:
    safe_fetch._NoRedirect().redirect_request(None, None, 302, "Found", {},
                                              "http://127.0.0.1:8188/history")
    FAIL += 1
    print("  x a redirect inward is refused: it was allowed")
except safe_fetch.UnsafeUrl:
    PASS += 1
except Exception as exc:
    FAIL += 1
    print(f"  x a redirect inward is refused: raised {type(exc).__name__}")

# ── reads are bounded ────────────────────────────────────────────────────
ok("image reads are capped", safe_fetch.MAX_IMAGE_BYTES <= 32 * 1024 * 1024,
   str(safe_fetch.MAX_IMAGE_BYTES))
ok("video reads are capped", safe_fetch.MAX_VIDEO_BYTES <= 1024 * 1024 * 1024,
   str(safe_fetch.MAX_VIDEO_BYTES))

print(f"test_safe_fetch: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
