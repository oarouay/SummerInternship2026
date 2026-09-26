import pytest
from unittest.mock import AsyncMock, patch
import httpx
from app.services.crawler import fetch_and_clean_url


@pytest.mark.asyncio
async def test_fetch_and_clean_url_ssl_fallback():
    """Verify that fetch_and_clean_url falls back to verify=False when SSL certificate verification fails."""
    target_url = "https://example.com/customs-doc"
    mock_html = "<html><head><title>Douane Regulations</title></head><body><p>Customs and tariff regulations for imported goods.</p></body></html>"

    # Simulate SSL certificate verification error on first attempt (verify=True)
    ssl_error = httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1077)")

    mock_success_response = AsyncMock()
    mock_success_response.status_code = 200
    mock_success_response.headers = {"content-type": "text/html; charset=utf-8"}
    mock_success_response.text = mock_html

    with patch("app.services.crawler.validate_safe_url"):
        with patch("httpx.AsyncClient") as mock_client_cls:
            # First client context manager (verify=True) -> raises ssl_error on .get()
            first_client = AsyncMock()
            first_client.__aenter__.return_value = first_client
            first_client.get.side_effect = ssl_error

            # Second client context manager (verify=False) -> returns mock_success_response
            second_client = AsyncMock()
            second_client.__aenter__.return_value = second_client
            second_client.get.return_value = mock_success_response

            mock_client_cls.side_effect = [first_client, second_client]

            title, cleaned_text = await fetch_and_clean_url(target_url)

            assert title == "Douane Regulations"
            assert "Customs and tariff regulations" in cleaned_text
            assert mock_client_cls.call_count == 2
            # First call had verify=True, second call had verify=False
            assert mock_client_cls.call_args_list[0].kwargs.get("verify") is True
            assert mock_client_cls.call_args_list[1].kwargs.get("verify") is False
