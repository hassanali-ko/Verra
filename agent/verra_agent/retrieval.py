"""Size-bounded public-page retrieval with DNS pinning and per-hop validation."""
import hashlib
import ipaddress
import socket
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit, urlunsplit

import urllib3
from bs4 import BeautifulSoup
from .contracts import Source

MAX_BYTES = 512_000
MAX_TEXT = 12_000


class RetrievalError(Exception):
    """A fixed error code safe to expose without raw request/transport details."""


def parse_url(url: str):
    if len(url) > 2000 or any(ord(c) < 33 for c in url) or "\\" in url:
        raise RetrievalError("invalid_url")
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username is not None or parsed.password is not None:
            raise ValueError()
        host = parsed.hostname.encode("idna").decode("ascii").lower()
        if "%" in host or host.endswith("."):
            raise ValueError()
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if port != (443 if parsed.scheme == "https" else 80):
            raise ValueError()
        return parsed, host, port
    except (ValueError, UnicodeError):
        raise RetrievalError("invalid_url") from None


def public_addresses(host: str, port: int, resolver=socket.getaddrinfo) -> list[str]:
    try:
        addresses = list(dict.fromkeys(result[4][0] for result in resolver(host, port, type=socket.SOCK_STREAM)))
    except OSError:
        raise RetrievalError("dns_unavailable") from None
    if not addresses:
        raise RetrievalError("dns_unavailable")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global or ip.is_multicast or getattr(ip, "ipv4_mapped", None) or getattr(ip, "sixtofour", None) or getattr(ip, "teredo", None):
            raise RetrievalError("private_address_blocked")
        if ip.version == 6 and (ip in ipaddress.ip_network("64:ff9b::/96") or ip in ipaddress.ip_network("64:ff9b:1::/48")):
            raise RetrievalError("private_address_blocked")
    return addresses


def pinned_pool(scheme: str, address: str, host: str, port: int):
    # Connect to the validated numeric address, preserving TLS SNI and hostname verification.
    if scheme == "https":
        return urllib3.HTTPSConnectionPool(address, port=port, server_hostname=host, assert_hostname=host, cert_reqs="CERT_REQUIRED")
    return urllib3.HTTPConnectionPool(address, port=port)


class PageReader:
    def __init__(self, *, resolver=socket.getaddrinfo, pool_factory=pinned_pool):
        self.resolver = resolver
        self.pool_factory = pool_factory

    def fetch(self, url: str, allowed_origin: str) -> Source:
        _, allowed_host, allowed_port = parse_url(allowed_origin)
        allowed_scheme = urlsplit(allowed_origin).scheme
        deadline = time.monotonic() + 25
        for _ in range(4):
            parsed, host, port = parse_url(url)
            if (host, port, parsed.scheme) != (allowed_host, allowed_port, allowed_scheme):
                raise RetrievalError("outside_venue_origin")
            addresses = public_addresses(host, port, self.resolver)
            pool = self.pool_factory(parsed.scheme, addresses[0], host, port)
            response = None
            try:
                path = urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
                response = pool.urlopen("GET", path, headers={"Host": f"[{host}]" if ":" in host else host,
                    "User-Agent": "VerraResearch/0.1", "Accept": "text/html,text/plain", "Accept-Encoding": "identity"},
                    preload_content=False, redirect=False, retries=False,
                    timeout=urllib3.Timeout(connect=5, read=5, total=15))
                if response.status in (301, 302, 303, 307, 308):
                    location = response.headers.get("Location")
                    if not location:
                        raise RetrievalError("invalid_redirect")
                    url = urljoin(url, location)
                    continue
                if response.status != 200:
                    raise RetrievalError("page_unavailable")
                media = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
                if media not in ("text/html", "text/plain", "application/xhtml+xml"):
                    raise RetrievalError("unsupported_content")
                if response.headers.get("Content-Encoding", "identity").lower() not in ("identity", ""):
                    raise RetrievalError("compressed_content_blocked")
                try:
                    if int(response.headers.get("Content-Length", "0")) > MAX_BYTES:
                        raise RetrievalError("page_too_large")
                except ValueError:
                    raise RetrievalError("invalid_content_length") from None
                chunks, size = [], 0
                for chunk in response.stream(16_384, decode_content=False):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise RetrievalError("page_too_large")
                    if time.monotonic() > deadline:
                        raise RetrievalError("page_timeout")
                    chunks.append(chunk)
                body = b"".join(chunks).decode("utf-8", errors="replace")
                soup = BeautifulSoup(body, "html.parser")
                title = soup.title.get_text(" ", strip=True)[:200] if soup.title else host
                for tag in soup(["script", "style", "nav", "footer", "noscript", "template"]):
                    tag.decompose()
                text = " ".join(soup.get_text(" ", strip=True).split())[:MAX_TEXT] if media != "text/plain" else body[:MAX_TEXT]
                if not text.strip():
                    raise RetrievalError("empty_page")
                canonical = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
                return Source(id=hashlib.sha256((canonical+text).encode()).hexdigest()[:24], url=canonical,
                              title=title, text=text, retrieved_at=datetime.now(timezone.utc).isoformat())
            except (urllib3.exceptions.HTTPError, OSError):
                raise RetrievalError("page_unavailable") from None
            finally:
                if response is not None:
                    response.close()
                pool.close()
        raise RetrievalError("too_many_redirects")

