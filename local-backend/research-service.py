#!/usr/bin/env python3
"""CINAMATE research service — runs on the generation machine, next to the
AI bridge (api_bridge.py on :3456). Serves internet lookups the browser
cannot do itself and caches them on disk so repeat queries are instant.

    python3 research-service.py            # listens on http://127.0.0.1:3457

Endpoints
    GET /research/health                    -> {"ok": true}
    GET /research/prophouses?city=Toronto   -> {"city", "lat", "lon", "houses":[...]}

The Props module probes :3457 automatically (same host as the bridge) and
falls back to direct keyless lookups when this service is not running.
Stdlib only — no pip installs needed.
"""
import json
import re
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 3457
UA = {"User-Agent": "CinamateResearch/1.0 (production-planning tool)"}
CACHE_FILE = Path(__file__).with_name("research-cache.json")
CACHE_TTL = 7 * 24 * 3600  # a week — prop houses do not move often

NOMINATIM = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q="
OVERPASS = "https://overpass-api.de/api/interpreter"


def load_cache():
    try:
        return json.loads(CACHE_FILE.read_text())
    except Exception:
        return {}


def save_cache(cache):
    try:
        CACHE_FILE.write_text(json.dumps(cache))
    except Exception:
        pass


def fetch_json(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def overpass_ql(lat, lon, km=40):
    around = f"(around:{int(km * 1000)},{lat},{lon})"
    names = "prop house|prop rental|props|prop shop|film rental|movie rental|studio rental"
    return (
        "[out:json][timeout:25];("
        f'node["name"~"{names}",i]{around};'
        f'way["name"~"{names}",i]{around};'
        f'node["shop"~"props|theatrical|costume",i]{around};'
        ");out center tags 60;"
    )


def prophouses(city):
    cache = load_cache()
    key = "prophouses:" + city.lower().strip()
    hit = cache.get(key)
    if hit and time.time() - hit["t"] < CACHE_TTL:
        return hit["v"]

    geo = fetch_json(NOMINATIM + urllib.parse.quote(city))
    if not geo:
        return {"city": city, "houses": [], "note": "city not found"}
    lat, lon = float(geo[0]["lat"]), float(geo[0]["lon"])

    time.sleep(1)  # Nominatim usage policy: max 1 req/s — stay polite
    ql = overpass_ql(lat, lon)
    osm = fetch_json(OVERPASS, data=("data=" + urllib.parse.quote(ql)).encode())
    houses = []
    for el in osm.get("elements", []):
        tags = el.get("tags", {})
        if not tags.get("name"):
            continue
        addr = " ".join(
            filter(None, [tags.get("addr:housenumber"), tags.get("addr:street"), tags.get("addr:city")])
        )
        houses.append(
            {
                "name": tags["name"],
                "spec": ("Map listing — " + tags["shop"]) if tags.get("shop") else "Map listing",
                "phone": tags.get("phone") or tags.get("contact:phone"),
                "website": tags.get("website") or tags.get("contact:website"),
                "address": addr or None,
                "source": "osm",
                "lat": el.get("lat") or (el.get("center") or {}).get("lat"),
                "lon": el.get("lon") or (el.get("center") or {}).get("lon"),
            }
        )
    result = {"city": city, "lat": lat, "lon": lon, "houses": houses}
    cache[key] = {"t": time.time(), "v": result}
    save_cache(cache)
    return result


# Only the Studio and this machine's own pages may call across origins.
# "*" meant every site the operator visited could drive this service, run
# lookups through their address, and read the answers — and the results are
# written to research-cache.json on their disk.
ALLOWED_ORIGINS = {
    "https://cinamate-studio.netlify.app",
    f"http://127.0.0.1:{PORT}",
    f"http://localhost:{PORT}",
}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = (self.headers.get("Origin") or "").strip().rstrip("/")
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/research/health":
            return self._send(200, {"ok": True, "service": "cinamate-research"})
        if url.path == "/research/prophouses":
            city = urllib.parse.parse_qs(url.query).get("city", [""])[0].strip()
            if not city:
                return self._send(400, {"error": "city parameter required"})
            if not re.match(r"^[\w\s,.'\-]{2,80}$", city):
                return self._send(400, {"error": "city looks invalid"})
            try:
                return self._send(200, prophouses(city))
            except Exception as e:  # network trouble — the browser falls back
                return self._send(502, {"error": str(e)})
        return self._send(404, {"error": "unknown endpoint"})

    def log_message(self, fmt, *args):
        print("[research]", fmt % args)


if __name__ == "__main__":
    print(f"CINAMATE research service on http://127.0.0.1:{PORT}")
    print("Endpoints: /research/health  /research/prophouses?city=Toronto")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
