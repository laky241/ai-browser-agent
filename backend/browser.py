import asyncio
import base64
from playwright.async_api import async_playwright

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
        print("Browser started")

    async def stop(self):
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        print("Browser stopped")

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

    async def execute_action(self, action: dict):
        action_type = action.get("action")
        print(f"Executing: {action_type} — {action}")

        if action_type == "navigate":
            url = action.get("url", "")
            if not url.startswith("http"):
                url = "https://" + url
            await self.page.goto(url, wait_until="networkidle", timeout=30000)
            await asyncio.sleep(3)
            if "google.com" in url:
                try:
                    await self.page.click('textarea[name="q"]', timeout=3000)
                    await asyncio.sleep(0.5)
                except:
                    pass

        elif action_type == "click":
            x, y = action.get("x"), action.get("y")
            await self.page.mouse.click(x, y)
            await asyncio.sleep(1.5)

        elif action_type == "type":
            text = action.get("text", "")
            await self.page.keyboard.type(text, delay=50)
            await asyncio.sleep(0.5)

        elif action_type == "press":
            key = action.get("key", "Enter")
            await self.page.keyboard.press(key)
            await asyncio.sleep(1.5)

        elif action_type == "scroll":
            direction = action.get("direction", "down")
            amount = 300 if direction == "down" else -300
            await self.page.mouse.wheel(0, amount)
            await asyncio.sleep(1)

        elif action_type == "wait":
            await asyncio.sleep(2)

        elif action_type == "done":
            pass

        else:
            print(f"Unknown action: {action_type}")