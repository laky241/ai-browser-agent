import asyncio
import base64
import time
from playwright.async_api import async_playwright


ALLOWED_URL_PREFIXES = ("http://", "https://")
BLOCKED_URL_PREFIXES = ("file://", "javascript:", "data:", "chrome://")
MAX_X = 1280
MAX_Y = 720
MAX_TYPE_LENGTH = 500


class BrowserController:
    def __init__(self):
        self.browser = None
        self.page = None
        self.playwright = None

    async def start(self):
        self.playwright = await async_playwright().start()

        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ]
        )

        context = await self.browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            locale="en-US",
            timezone_id="Asia/Kolkata",
            permissions=["geolocation"],
            java_script_enabled=True,
        )

        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3]});
            Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
        """)

        self.page = await context.new_page()

    async def stop(self):
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

    async def screenshot_base64(self):
        try:
            await self.page.wait_for_load_state("domcontentloaded", timeout=3000)
        except:
            pass

        await asyncio.sleep(0.5)

        screenshot = await self.page.screenshot(
            type="jpeg",
            quality=85,
            full_page=False,
            clip={"x": 0, "y": 0, "width": 1280, "height": 720}
        )

        return base64.b64encode(screenshot).decode("utf-8")

    async def get_url(self):
        return self.page.url

    async def get_page_text(self):
        try:
            text = await self.page.evaluate("() => document.body.innerText")
            return text[:3000]
        except:
            return ""

    def _is_safe_url(self, url: str) -> bool:
        if not isinstance(url, str) or not url.strip():
            return False
        lowered = url.lower().strip()
        if lowered.startswith(BLOCKED_URL_PREFIXES):
            return False
        return lowered.startswith(ALLOWED_URL_PREFIXES)

    def _is_safe_click(self, x, y) -> bool:
        return (
            isinstance(x, int)
            and isinstance(y, int)
            and 0 <= x <= MAX_X
            and 0 <= y <= MAX_Y
        )

    def _is_safe_type(self, text: str) -> bool:
        return (
            isinstance(text, str)
            and text.strip() != ""
            and len(text) <= MAX_TYPE_LENGTH
        )

    async def _retry(self, func, retries=2, delay=1):
        last_error = None
        for attempt in range(retries + 1):
            try:
                return await func()
            except Exception as e:
                last_error = e
                if attempt < retries:
                    await asyncio.sleep(delay)
        raise last_error

    async def execute_action(self, action: dict):
        started = time.time()
        action_type = action.get("action")

        trace = {
            "status": "success",
            "action_type": action_type,
            "duration_ms": 0,
            "error": None
        }

        try:
            if action_type == "navigate":
                url = action.get("url", "").strip()

                if not self._is_safe_url(url):
                    raise ValueError(f"Blocked unsafe URL: {url}")

                try:
                    await self.page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception:
                    # if domcontentloaded times out just continue
                    pass

                # wait for page to settle and render text
                await asyncio.sleep(4)

            elif action_type == "click":
                x, y = action.get("x"), action.get("y")

                if not self._is_safe_click(x, y):
                    raise ValueError(f"Unsafe click coordinates: ({x}, {y})")

                await self._retry(
                    lambda: self.page.mouse.click(x, y),
                    retries=2,
                    delay=1
                )
                await asyncio.sleep(1)

            elif action_type == "type":
                text = action.get("text", "")

                if not self._is_safe_type(text):
                    raise ValueError("Unsafe type payload")

                await self._retry(
                    lambda: self.page.keyboard.type(text, delay=50),
                    retries=2,
                    delay=1
                )
                await asyncio.sleep(0.5)

            elif action_type == "press":
                await self.page.keyboard.press(action.get("key", "Enter"))
                await asyncio.sleep(1)

            elif action_type == "scroll":
                direction = action.get("direction", "down")
                amount = 300 if direction == "down" else -300
                await self.page.mouse.wheel(0, amount)
                await asyncio.sleep(1)

            elif action_type == "wait":
                await asyncio.sleep(3)

            elif action_type == "done":
                pass

            else:
                raise ValueError(f"Unknown action: {action_type}")

        except Exception as e:
            trace["status"] = "failed"
            trace["error"] = str(e)

        trace["duration_ms"] = int((time.time() - started) * 1000)
        return trace