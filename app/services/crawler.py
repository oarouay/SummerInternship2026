import html
import ipaddress
import logging
import re
import socket
from typing import Tuple
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


def validate_safe_url(url: str) -> None:
    """
    Validates a URL against Server-Side Request Forgery (SSRF) vulnerabilities.
    Blocks localhost, private RFC-1918 subnets, link-local, and cloud metadata services.
    """
    try:
        parsed = urlparse(url)
    except Exception as e:
        raise ValueError(f"Invalid URL format: {e}")

    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http and https protocols are supported.")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL must include a valid hostname.")

    # Check for localhost aliases
    if hostname.lower() in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        raise ValueError("Access to localhost is prohibited.")

    # Resolve IP and verify public routing
    try:
        addr_info = socket.getaddrinfo(hostname, None)
        for _, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)

            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
                or ip.is_unspecified
                or ip_str in ("169.254.169.254", "0.0.0.0")
            ):
                raise ValueError(f"Target address {ip_str} belongs to a restricted or private network.")
    except socket.gaierror as e:
        raise ValueError(f"Unable to resolve host {hostname}: {e}")


async def fetch_and_clean_url(url: str) -> Tuple[str, str]:
    """
    Asynchronously downloads a web page and extracts its title and readable text.
    """
    validate_safe_url(url)

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; GraphRAG-Bot/1.0; +http://localhost)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9",
    }

    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                raise ValueError(f"HTTP error {resp.status_code} fetching URL.")

            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type and "text/plain" not in content_type:
                raise ValueError(f"Unsupported content type '{content_type}'. Must be text/html or text/plain.")

            raw_html = resp.text
    except httpx.RequestError as e:
        raise ValueError(f"Network error while connecting to URL: {e}")

    # Extract title
    title_match = re.search(r"<title[^>]*>(.*?)</title>", raw_html, re.IGNORECASE | re.DOTALL)
    if title_match:
        title = html.unescape(title_match.group(1)).strip()
    else:
        title = urlparse(url).netloc + urlparse(url).path

    # Clean HTML elements
    # 1. Remove scripts, styles, noscript, svg, nav, footer
    cleaned = re.sub(
        r"<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>",
        "",
        raw_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # 2. Convert block boundaries to newlines
    cleaned = re.sub(r"<(p|div|h[1-6]|li|tr|br)[^>]*>", "\n", cleaned, flags=re.IGNORECASE)
    # 3. Strip remaining HTML tags
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    # 4. Unescape HTML entities
    cleaned = html.unescape(cleaned)
    # 5. Normalize whitespace
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n\s*\n", "\n\n", cleaned).strip()

    if len(cleaned) < 30:
        raise ValueError("Web page did not contain sufficient extractable text content.")

    return title[:120], cleaned
