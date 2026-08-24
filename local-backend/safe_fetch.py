"""Guarded outbound image fetch for the Cinamate local bridge.

The bridge used to hand any string starting with "http" straight to
urllib.request.urlopen() and write the whole response to disk, then serve it
back at /images/<id>.jpg. Because the bridge also answered cross-origin
requests from any site and bound 0.0.0.0, that turned the operator's
workstation into a read proxy for everything it can reach that the attacker
cannot: the ComfyUI instance on 127.0.0.1:8188 (whose /history and /queue
leak every prompt and output path), other loopback services, and the whole
LAN behind the machine — router admin pages, NAS interfaces, intranet hosts.
The attacker got the bytes back through a plain fetch of the /images/ URL.

The feature that needs outbound fetching is narrow: pulling a reference still
from a poster/still provider. So this is an allow-list, not a filter. Only
https, only hosts we actually source images from, only addresses that are not
on a private network, no redirects, a size ceiling, and the response has to
actually be an image.

Three separate things are checked because each defeats a different trick:
  · the HOST must be listed          — stops arbitrary destinations
  · every RESOLVED ADDRESS must be public — stops a listed-looking name (or a
    wildcard subdomain) that resolves to 127.0.0.1 or 10.x
  · redirects are refused outright   — stops a public URL bouncing inward,
    which a check on the original URL alone would never see
"""

from __future__ import annotations

import ipaddress
import socket
from typing import Iterable
from urllib import error as urlerror
from urllib import request as urlreq
from urllib.parse import urlsplit

# Hosts the Studio actually sources reference imagery from. Anything not here
# is refused — adding a provider is a deliberate edit, not a runtime surprise.
DEFAULT_IMAGE_HOSTS = (
    "image.tmdb.org",
    "upload.wikimedia.org",
    "commons.wikimedia.org",
    "m.media-amazon.com",
)

MAX_IMAGE_BYTES = 12 * 1024 * 1024  # a reference still, not a video
CONNECT_TIMEOUT = 15


class UnsafeUrl(Exception):
    """The URL is not one we are willing to fetch."""


def _is_public_address(raw: str) -> bool:
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return False
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        # Carrier-grade NAT: not marked private by ipaddress, still not the
        # public internet, and reachable from many office networks.
        or ip in ipaddress.ip_network("100.64.0.0/10")
        or (ip.version == 6 and ip.ipv4_mapped is not None
            and not _is_public_address(str(ip.ipv4_mapped)))
    )


def _resolved_addresses(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeUrl(f"could not resolve {host}") from exc
    return [i[4][0] for i in infos]


class _NoRedirect(urlreq.HTTPRedirectHandler):
    """A validated URL that redirects is no longer the URL we validated."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        raise UnsafeUrl(f"refused redirect to {newurl}")


def check_url(url: str, hosts: Iterable[str] | None = None) -> str:
    """Return the host if `url` is safe to fetch, else raise UnsafeUrl."""
    allowed = {h.lower() for h in (hosts if hosts is not None else DEFAULT_IMAGE_HOSTS)}
    try:
        parts = urlsplit(url)
    except ValueError as exc:
        raise UnsafeUrl("unparseable URL") from exc

    if parts.scheme.lower() != "https":
        raise UnsafeUrl("only https:// image URLs are fetched")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise UnsafeUrl("no host in URL")
    if host not in allowed:
        raise UnsafeUrl(f"{host} is not an allowed image host")

    # A listed name still has to point somewhere public. Checking the string
    # and not the address is what makes most SSRF filters fail.
    addresses = _resolved_addresses(host)
    if not addresses:
        raise UnsafeUrl(f"{host} resolved to nothing")
    for addr in addresses:
        if not _is_public_address(addr):
            raise UnsafeUrl(f"{host} resolves to non-public address {addr}")
    return host


def fetch_image(url: str, hosts: Iterable[str] | None = None,
                max_bytes: int = MAX_IMAGE_BYTES) -> bytes:
    """Fetch an image from an allowed host, or raise UnsafeUrl.

    Reads at most `max_bytes`. The previous code called resp.read() with no
    limit, so a single request pointed at a large or endless stream filled the
    operator's disk and memory — a denial of service that needed no
    authentication and left no trace beyond a full drive.
    """
    check_url(url, hosts)
    opener = urlreq.build_opener(_NoRedirect)
    try:
        with opener.open(url, timeout=CONNECT_TIMEOUT) as resp:
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if not ctype.startswith("image/"):
                raise UnsafeUrl(f"response was {ctype or 'untyped'}, not an image")
            data = resp.read(max_bytes + 1)
    except UnsafeUrl:
        raise
    except (urlerror.URLError, OSError, ValueError) as exc:
        raise UnsafeUrl(f"fetch failed: {exc}") from exc

    if len(data) > max_bytes:
        raise UnsafeUrl(f"image exceeds {max_bytes} bytes")
    if not data:
        raise UnsafeUrl("empty response")
    return data


MAX_VIDEO_BYTES = 512 * 1024 * 1024


def fetch_provider_asset(url: str, max_bytes: int, timeout: int = 180) -> bytes:
    """Download a result asset from the configured generation provider.

    Provider result URLs are signed, single-use and live on hosts that change,
    so a host allow-list is the wrong shape here. What still applies is that
    the address must be public — a provider response is attacker-influenced
    input the moment an API key is wrong, stolen, or pointed at a different
    endpoint — and that the read must be bounded. Both `cache_remote_image`
    and `_cache_remote_video` previously called resp.read() with no ceiling,
    so one oversized or endless response filled the operator's disk.
    """
    try:
        parts = urlsplit(url)
    except ValueError as exc:
        raise UnsafeUrl("unparseable URL") from exc
    if parts.scheme.lower() != "https":
        raise UnsafeUrl("provider assets must be https")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise UnsafeUrl("no host in URL")
    for addr in _resolved_addresses(host):
        if not _is_public_address(addr):
            raise UnsafeUrl(f"{host} resolves to non-public address {addr}")

    opener = urlreq.build_opener(_NoRedirect)
    try:
        with opener.open(url, timeout=timeout) as resp:
            data = resp.read(max_bytes + 1)
    except UnsafeUrl:
        raise
    except (urlerror.URLError, OSError, ValueError) as exc:
        raise UnsafeUrl(f"fetch failed: {exc}") from exc
    if len(data) > max_bytes:
        raise UnsafeUrl(f"asset exceeds {max_bytes} bytes")
    if not data:
        raise UnsafeUrl("empty response")
    return data
