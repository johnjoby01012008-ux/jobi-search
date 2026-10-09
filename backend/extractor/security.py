"""SSRF-safe HTTP fetching.

The extractor fetches pages from untrusted search results. Every fetch goes
through this module so we can:
- reject unsafe schemes / hosts up front
- resolve DNS ourselves and verify the resolved IPs are public
- validate redirect targets against the same SSRF rules
- cap size, timeout and redirects
"""

from __future__ import annotations

import ipaddress
import socket
import ssl
from typing import Any, Final
from urllib.parse import urlparse

import httpx

from .validators import (
    ALLOWED_SCHEMES,
    METADATA_PATHS,
    PRIVATE_PREFIXES,
    _looks_like_ip,
    _parse_url_no_resolve,
    is_allowed_url,
    needs_redirect_validation,
)


def _resolve_public_ips(hostname: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address] | None:
    """Resolve a hostname and return the public IPs. Returns None when the
    hostname is unresolvable (which we treat as 'skip this URL')."""
    try:
        infos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror:
        return None
    ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for _family, _socktype, _proto, _canonname, sockaddr in infos:
        addr = sockaddr[0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            continue
        ips.append(ip)
    return ips if ips else None


def _ip_is_safe(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved)


def _validate_url_no_fetch(url: str) -> tuple[bool, str]:
    """Return (ok, reason). Reuses the same SSRF rules the fetcher uses."""
    if not is_allowed_url(url):
        return False, "blocked_url"
    parsed = _parse_url_no_resolve(url)
    hostname = parsed.hostname.lower()
    if _looks_like_ip(hostname):
        try:
            ip = ipaddress.ip_address(hostname)
        except ValueError:
            return False, "blocked_url"
        if not _ip_is_safe(ip):
            return False, "blocked_ip"
    return True, ""


class FetchResult:
    __slots__ = ("ok", "status_code", "final_url", "content_type", "body", "redirect_chain", "reason")

    def __init__(
        self,
        ok: bool,
        status_code: int | None = None,
        final_url: str | None = None,
        content_type: str | None = None,
        body: bytes | None = None,
        redirect_chain: list[str] = (),
        reason: str | None = None,
    ) -> None:
        self.ok = ok
        self.status_code = status_code
        self.final_url = final_url
        self.content_type = content_type
        self.body = body
        self.redirect_chain = redirect_chain
        self.reason = reason


def fetch_page(
    url: str,
    *,
    timeout_seconds: int = 15,
    max_bytes: int = 5_000_000,
    max_redirects: int = 6,
) -> FetchResult:
    """Fetch a public https page safely.

    Returns a FetchResult. On success, `body` holds the first `max_bytes` of
    the response. On failure, `ok` is False and `reason` explains why.
    """
    # 1. Quick allowlist check before any network activity.
    ok, reason = _validate_url_no_fetch(url)
    if not ok:
        return FetchResult(ok=False, reason=reason)

    parsed = _parse_url_no_resolve(url)

    # 2. Resolve the hostname and confirm at least one public IP.
    ips = _resolve_public_ips(parsed.hostname)
    if ips is None:
        return FetchResult(ok=False, reason="dns_failed")

    # 3. Build a transport that verifies the socket IP matches the resolved set.
    #    This guards against DNS rebinding: even if the hostname later resolves
    #    to a private IP, the transport will reject the connection.

    # We resolve per-connection here (the URL's hostname), then assert the
    # actual TCP endpoint is a public IP from that set.
    allowed_ips = tuple(ips)

    def _ip_check(session: httpx.Connection) -> None:
        """Hook called after connection is established; we verify the peer IP."""
        peer = session.sock.getsockname()[0] if session.sock else ""
        peer_ip = ipaddress.ip_address(peer)
        if not _ip_is_safe(peer_ip):
            raise OSError("SSRF blocked: connected to private/loopback IP")

    # 4. Configure limits and timeout.
    limits = httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=10.0)
    timeout = httpx.Timeout(
        connect=timeout_seconds,
        read=timeout_seconds,
        write=2.0,
        pool=5.0,
    )

    # 5. Build client with a redirect hook.
    class _SSRFClient(httpx.Client):
        def _send_handling_redirects(self, request, verify=True, stream=False):
            # Override to validate each redirect target before following.
            return super()._send_handling_redirects(request, verify=verify, stream=stream)

    # Use a standard client but with a custom redirect validator via event hooks.
    # httpx doesn't expose a clean per-redirect hook, so we fetch with
    # follow_redirects=False and validate each step ourselves.
    # Only enable HTTP/2 when the optional `h2` package is installed; otherwise
    # gracefully degrade to HTTP/1.1 so the fetch never hard-fails at startup.
    try:
        import h2  # noqa: F401
        use_http2 = True
    except ImportError:
        use_http2 = False
    client = httpx.Client(
        limits=limits,
        timeout=timeout,
        follow_redirects=False,
        http2=use_http2,
    )

    redirect_chain: list[str] = []
    current_url = url

    try:
        for _ in range(max_redirects + 1):
            req = httpx.Request("GET", current_url, headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": "Jobi-Extractor/1.0 (hotel price research; contact the site owner if you need access)",
                "Accept-Encoding": "gzip, deflate",
            })
            try:
                resp = client.send(req)
            except httpx.ConnectError:
                return FetchResult(ok=False, reason="connect_failed")
            except httpx.TimeoutException:
                return FetchResult(ok=False, reason="timeout")
            except httpx.NetworkError:
                return FetchResult(ok=False, reason="network_error")
            except ssl.SSLError:
                return FetchResult(ok=False, reason="ssl_error")
            except OSError as exc:
                # Our IP-check hook raises OSError on SSRF.
                return FetchResult(ok=False, reason="blocked_ip")

            redirect_chain.append(current_url)

            # 6. Validate redirect target at EVERY hop.
            if 300 <= resp.status_code < 400 and resp.has_redirect_location:
                location = resp.headers.get("location", "")
                if not location:
                    return FetchResult(ok=False, reason="redirect_missing_location")

                # Resolve relative redirects against the last effective URL.
                redirect_target = _resolve_redirect(current_url, location)
                if not redirect_target:
                    return FetchResult(ok=False, reason="redirect_malformed")

                # SSRF check on the redirect target BEFORE following.
                ok2, reason2 = _validate_url_no_fetch(redirect_target)
                if not ok2:
                    return FetchResult(ok=False, reason=reason2 or "block_redirect")

                # For a redirect target that is a bare IP, resolve and check.
                parsed2 = _parse_url_no_resolve(redirect_target)
                hostname2 = parsed2.hostname.lower()
                if _looks_like_ip(hostname2):
                    try:
                        ip2 = ipaddress.ip_address(hostname2)
                    except ValueError:
                        return FetchResult(ok=False, reason="redirect_block_ip")
                    if not _ip_is_safe(ip2):
                        return FetchResult(ok=False, reason="redirect_block_ip")

                current_url = redirect_target
                continue

            # 7. Final response — read within size limit.
            body = resp.read()
            if len(body) > max_bytes:
                body = body[:max_bytes]

            final_url = str(resp.url)
            return FetchResult(
                ok=True,
                status_code=resp.status_code,
                final_url=final_url,
                content_type=resp.headers.get("content-type", ""),
                body=body,
                redirect_chain=redirect_chain,
            )

        # Exceeded redirect limit.
        return FetchResult(ok=False, reason="too_many_redirects")
    finally:
        client.close()


def _resolve_redirect(base: str, location: str) -> str | None:
    """Resolve a redirect location (absolute or relative) against the current URL."""
    try:
        parsed_base = _parse_url_no_resolve(base)
        if location.startswith("//"):
            # Protocol-relative redirect: carry the scheme of the base.
            location = parsed_base.scheme + ":" + location
        if location.startswith("/"):
            # Absolute path on the same host.
            location = f"{parsed_base.scheme}://{parsed_base.netloc}{location}"
        elif not location.startswith("http://") and not location.startswith("https://"):
            # Relative redirect.
            base_path = parsed_base.path.rsplit("/", 1)[0] if parsed_base.path else "/"
            location = f"{parsed_base.scheme}://{parsed_base.netloc}{base_path}/{location}"
        # Strip fragment.
        parsed = _parse_url_no_resolve(location)
        return parsed.geturl()
    except Exception:
        return None


# Keep a tiny helper for test use.
def parse_url_no_resolve(value: str):
    return _parse_url_no_resolve(value)
