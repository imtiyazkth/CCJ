"""
CCJ Research Worker — SSRF Security
Validates ALL outbound URLs before fetching, including every redirect hop.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlparse


class SSRFError(Exception):
    """Raised when a URL is blocked due to SSRF risk."""

BLOCKED_HOSTNAMES: frozenset[str] = frozenset({
    "localhost",
    "metadata.google.internal",
    "169.254.169.254",
    "metadata.azure.internal",
    "100.100.100.200",
    "fd00::ec2",
})

ALLOWED_SCHEMES: frozenset[str] = frozenset({"http", "https"})

PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("100.64.0.0/10"),   # Shared address space (RFC 6598)
    ipaddress.ip_network("198.18.0.0/15"),   # Benchmark testing (RFC 2544)
    ipaddress.ip_network("198.51.100.0/24"), # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),  # TEST-NET-3
    ipaddress.ip_network("240.0.0.0/4"),     # Reserved
]


def is_private_ip(addr: str) -> bool:
    """Return True if IP address is private, loopback, link-local, or reserved."""
    try:
        ip = ipaddress.ip_address(addr)
        return any(ip in net for net in PRIVATE_NETWORKS)
    except ValueError:
        return False


def validate_fetch_url(raw_url: str) -> str:
    """
    Validate a URL is safe to fetch.
    - Checks scheme, hostname blocklist, raw IP literals
    - Resolves DNS and validates every returned address
    Raises SSRFError if blocked.
    Returns the validated URL string.
    """
    try:
        parsed = urlparse(raw_url)
    except Exception as e:
        raise SSRFError(f"Invalid URL: {e}") from e

    if parsed.scheme not in ALLOWED_SCHEMES:
        raise SSRFError(f"URL scheme not allowed: {parsed.scheme!r}")

    hostname = (parsed.hostname or "").lower().strip("[]")  # strip IPv6 brackets
    if not hostname:
        raise SSRFError("URL has no hostname")

    if hostname in BLOCKED_HOSTNAMES:
        raise SSRFError(f"Hostname is blocked: {hostname!r}")

    # Reject raw private IP literals
    if is_private_ip(hostname):
        raise SSRFError(f"URL is a private IP address: {hostname!r}")

    # DNS resolution — blocks DNS rebinding attacks
    try:
        results = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        raise SSRFError(f"Cannot resolve hostname {hostname!r}: {e}") from e

    for _family, _type, _proto, _canonname, sockaddr in results:
        ip_addr = sockaddr[0]
        if is_private_ip(ip_addr):
            raise SSRFError(
                f"Hostname {hostname!r} resolves to private address {ip_addr!r}"
            )

    return raw_url


def resolve_redirect(base_url: str, location: str) -> str:
    """
    Resolve a Location header value against the base URL.
    Handles relative redirects (/path, ../path) safely.
    """
    if location.startswith(("http://", "https://")):
        return location
    return urljoin(base_url, location)


def anonymise_ip(ip: str) -> str:
    """Keep only the first two octets of IPv4 for audit log privacy."""
    if not ip:
        return "unknown"
    parts = ip.split(".")
    if len(parts) == 4:
        return f"{parts[0]}.{parts[1]}.x.x"
    parts_v6 = ip.split(":")
    return ":".join(parts_v6[:4]) + ":xxxx:xxxx:xxxx:xxxx"
