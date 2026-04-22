import requests
from user_agents import parse

def get_client_ip(request) -> str:
    """Extract client IP from request headers (works behind proxy)."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def parse_user_agent(user_agent_string: str) -> dict:
    """Parse browser, OS, and device type from User-Agent."""
    ua = parse(user_agent_string)
    return {
        "browser": ua.browser.family or "Unknown",
        "os": ua.os.family or "Unknown",
        "device": "Mobile" if ua.is_mobile else "Tablet" if ua.is_tablet else "Desktop",
    }

def get_location_from_ip(ip: str) -> str:
    """Get country/region from IP using ip-api.com."""
    if ip in ("127.0.0.1", "localhost", "unknown", ""):
        return "Local"
    try:
        response = requests.get(f"http://ip-api.com/json/{ip}?fields=country", timeout=3)
        if response.status_code == 200:
            data = response.json()
            return data.get("country", "Unknown")
    except Exception:
        pass
    return "Unknown"