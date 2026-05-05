import os
import json
import time
import urllib.parse
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(
    api_key=os.getenv("NVIDIA_API_KEY"),
    base_url="https://integrate.api.nvidia.com/v1",
)

SYSTEM_PROMPT = """You are a web browsing agent. You control a real browser to complete tasks.

You will receive a screenshot and the actual page text. Use BOTH to decide the next action.

You must ALWAYS respond with ONLY a valid JSON object — no explanation, no markdown, no backticks.

Available actions:
- {"action": "navigate", "url": "https://example.com"}
- {"action": "click", "x": 640, "y": 360}
- {"action": "type", "text": "search query"}
- {"action": "press", "key": "Enter"}
- {"action": "scroll", "direction": "down"}
- {"action": "wait"}
- {"action": "done", "result": "Final answer with actual data from the page"}

Rules:
- Read PAGE TEXT carefully — if it contains the answer, use "done" immediately with real data
- Never click at (0,0) — if lost, navigate to a new URL
- Never use "wait" more than once in a row
- Always include actual data in your final result, not just "task completed"
- If you see search results in page text, extract the answer and use "done"
- NEVER use "done" if page text is empty or has no useful data — try a different URL instead
"""

ALLOWED_ACTIONS = {"navigate", "click", "type", "press", "scroll", "wait", "done"}
ALLOWED_KEYS = {"Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"}
ALLOWED_SCROLL = {"up", "down"}
BLOCKED_SCHEMES = {"file", "javascript", "data", "chrome", "about", "blob"}
BLOCKED_DOMAINS = {"localhost", "127.0.0.1", "0.0.0.0"}
MAX_TEXT_LENGTH = 500
VIEWPORT_WIDTH = 1280
VIEWPORT_HEIGHT = 720


class BrowsingAgent:
    def __init__(self):
        self.history = []
        self.max_steps = 15
        self.recovery_attempts = 0

    def reset(self):
        self.history = []
        self.recovery_attempts = 0

    def _safe_wait(self):
        return {"action": "wait"}

    def _safe_done(self, status: str, message: str, step: int):
        return {"status": status, "result": message, "steps": step}

    def _normalize_url(self, url: str):
        if not isinstance(url, str) or not url.strip():
            return None
        url = url.strip()
        try:
            parsed = urllib.parse.urlparse(url)
        except Exception:
            return None
        if parsed.scheme and parsed.scheme.lower() in BLOCKED_SCHEMES:
            return None
        if not parsed.scheme:
            url = f"https://{url}"
            try:
                parsed = urllib.parse.urlparse(url)
            except Exception:
                return None
        if parsed.scheme.lower() not in {"http", "https"}:
            return None
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return None
        if hostname in BLOCKED_DOMAINS:
            return None
        return url

    def validate_action(self, action: dict):
        if not isinstance(action, dict):
            return self._safe_wait()
        action_type = action.get("action")
        if action_type not in ALLOWED_ACTIONS:
            return self._safe_wait()
        if action_type == "navigate":
            url = self._normalize_url(action.get("url", ""))
            return {"action": "navigate", "url": url} if url else self._safe_wait()
        if action_type == "click":
            x, y = action.get("x"), action.get("y")
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                return self._safe_wait()
            x, y = int(x), int(y)
            if x <= 0 or y <= 0 or x > VIEWPORT_WIDTH or y > VIEWPORT_HEIGHT:
                return self._safe_wait()
            return {"action": "click", "x": x, "y": y}
        if action_type == "type":
            text = action.get("text", "")
            if not isinstance(text, str) or not text.strip():
                return self._safe_wait()
            return {"action": "type", "text": text.strip()[:MAX_TEXT_LENGTH]}
        if action_type == "press":
            key = action.get("key", "Enter")
            return {"action": "press", "key": key} if key in ALLOWED_KEYS else self._safe_wait()
        if action_type == "scroll":
            direction = action.get("direction", "down")
            return {"action": "scroll", "direction": direction} if direction in ALLOWED_SCROLL else self._safe_wait()
        if action_type == "wait":
            return {"action": "wait"}
        if action_type == "done":
            result = action.get("result", "Task completed")
            return {"action": "done", "result": str(result)[:2000]}
        return self._safe_wait()

    def _is_stuck(self):
        if len(self.history) < 3:
            return False
        last_three = self.history[-3:]
        return len(set(last_three)) == 1

    def _recovery_action(self, task: str):
        self.recovery_attempts += 1
        if self.recovery_attempts == 1:
            return {"action": "scroll", "direction": "down"}
        if self.recovery_attempts == 2:
            search_query = urllib.parse.quote_plus(task)
            return {"action": "navigate", "url": f"https://search.brave.com/search?q={search_query}&source=web"}
        return None

    async def decide_action(self, task: str, screenshot_b64: str, step: int, page_text: str = ""):
        history_text = ""
        if self.history:
            recent = self.history[-5:]
            history_text = "Recent actions taken:\n" + "\n".join(f"- {h}" for h in recent)

        prompt = f"""Task: {task}

Step: {step} of {self.max_steps}
{history_text}

PAGE TEXT CONTENT (read this to find actual data):
{page_text[:3000] if page_text else "Page still loading..."}

Look at the screenshot AND the page text to decide the next action.
If the page text contains real results that answer the task, use "done" with the actual answer.
If page text is empty or has no useful data, navigate to a different URL.
Respond with ONLY a JSON object, nothing else."""

        for attempt in range(5):
            try:
                response = client.chat.completions.create(
                    model="meta/llama-3.2-90b-vision-instruct",
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/jpeg;base64,{screenshot_b64}"},
                                },
                                {"type": "text", "text": prompt},
                            ],
                        },
                    ],
                    temperature=0.1,
                    max_tokens=512,
                )
                raw = response.choices[0].message.content.strip()
                raw = raw.replace("```json", "").replace("```", "").strip()
                parsed = json.loads(raw)
                validated = self.validate_action(parsed)

                # prevent premature done if result is too short
                if validated.get("action") == "done":
                    result = validated.get("result", "")
                    if len(result) < 30:
                        print(f"Weak done result, forcing scroll instead")
                        return {"action": "scroll", "direction": "down"}

                return validated

            except json.JSONDecodeError:
                print(f"JSON parse error at step {step}, using wait")
                return self._safe_wait()

            except Exception as e:
                if "429" in str(e) or "rate" in str(e).lower():
                    wait = 30 * (attempt + 1)
                    print(f"Rate limit — waiting {wait}s... (attempt {attempt+1}/5)")
                    time.sleep(wait)
                else:
                    raise e

        raise Exception("Max retries exceeded")

    async def run_task(self, task: str, browser, on_step=None):
        self.reset()

        for step in range(1, self.max_steps + 1):
            screenshot = await browser.screenshot_base64()
            current_url = await browser.get_url()
            page_text = await browser.get_page_text()

            if step == 1:
                search_query = urllib.parse.quote_plus(task)
                action = {"action": "navigate", "url": f"https://search.brave.com/search?q={search_query}&source=web"}

            elif step == 2 and (not page_text or len(page_text.strip()) < 50):
                print("Page text too short at step 2, waiting...")
                action = {"action": "wait"}

            else:
                if self._is_stuck():
                    recovery = self._recovery_action(task)
                    if recovery:
                        action = recovery
                    else:
                        return self._safe_done(
                            "stuck_loop_detected",
                            "Agent got stuck in a repeated action loop",
                            step,
                        )
                else:
                    action = await self.decide_action(task, screenshot, step, page_text)

            action = self.validate_action(action)
            self.history.append(str(action))

            step_data = {
                "step": step,
                "action": action,
                "screenshot": screenshot,
                "url": current_url,
                "page_text": page_text,
            }

            if on_step:
                await on_step(step_data)

            if action["action"] == "done":
                return self._safe_done("completed", action["result"], step)

            await browser.execute_action(action)

        return self._safe_done(
            "max_steps_reached",
            "Agent reached maximum steps",
            self.max_steps,
        )