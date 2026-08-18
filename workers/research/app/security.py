"""
CCJ Research Worker — SSRF Security
Validates all outbound URLs before fetching.
Mirrors the TypeScript security middleware.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlparse


class SSRFError(Exception):
    """Raised when a URL is blocked due to SSRF risk."""
    pass


# Blocked hostnames — cloud metadata endpoints
BLOCKED_HOSTNAMES: frozenset[str] = frozenset({
    "localhost",
    "metadata.google.internal",
    "169.254.169.254",
    "metadata.azure.internal",
    "100.100.100.200",
    "fd00::ec2",   # AWS IPv6 metadata
})

# Allowed schemes
ALLOWED_SCHEMES: frozenset[str] = frozenset({"http", "https"})

# Private / reserved IP networks
PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),   # link-local / AWS IMDS
    ipaddress.ip_network("::1/128"),           # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),          # IPv6 ULA
    ipaddress.ip_network("fe80::/10"),         # IPv6 link-local
]


def is_private_ip(addr: str) -> bool:
    """Return True if the IP address is private or reserved."""
    try:
        ip = ipaddress.ip_address(addr)
        return any(ip in net for net in PRIVATE_NETWORKS)
    except ValueError:
        return False


def validate_fetch_url(raw_url: str) -> str:
    """
    Validate that a URL is safe to fetch.
    Performs DNS resolution and checks the resolved IP.
    Raises SSRFError if the URL is blocked.
    Returns the validated URL string.
    """
    try:
        parsed = urlparse(raw_url)
    except Exception as e:
        raise SSRFError(f"Invalid URL: {e}") from e

    if parsed.scheme not in ALLOWED_SCHEMES:
        raise SSRFError(f"URL scheme not allowed: {parsed.scheme!r}")

    hostname = (parsed.hostname or "").lower()

    if not hostname:
        raise SSRFError("URL has no hostname")

    if hostname in BLOCKED_HOSTNAMES:
        raise SSRFError(f"URL hostname is blocked: {hostname!r}")

    # Reject raw private IP literals
    if is_private_ip(hostname):
        raise SSRFError(f"URL is a private IP address: {hostname!r}")

    # DNS resolution — protect against DNS rebinding
    try:
        results = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        raise SSRFError(f"Could not resolve hostname {hostname!r}: {e}") from e

    for family, *_, sockaddr in results:
        ip_addr = sockaddr[0]
        if is_private_ip(ip_addr):
            raise SSRFError(
                f"URL {hostname!r} resolves to a private address: {ip_addr!r}"
            )

    return raw_url


def anonymise_ip(ip: str) -> str:
    """Keep only the first two octets for IPv4 (audit log privacy)."""
    if not ip:
        return "unknown"
    parts = ip.split(".")
    if len(parts) == 4:
        return f"{parts[0]}.{parts[1]}.x.x"
    # IPv6
    parts_v6 = ip.split(":")
    return ":".join(parts_v6[:4]) + ":xxxx:xxxx:xxxx:xxxx"
