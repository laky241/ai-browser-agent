import os
import json
import base64
import time
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(
    api_key=os.getenv("NVIDIA_API_KEY"),
    base_url="https://integrate.api.nvidia.com/v1",
)

SYSTEM_PROMPT = """You are a web browsing agent. You control a real browser to complete tasks.

You will receive a screenshot of the current browser state and must decide the next action.

You must ALWAYS respond with ONLY a valid JSON object — no explanation, no markdown, no backticks.

Available actions:
- {"action": "navigate", "url": "https://example.com"}
- {"action": "click", "x": 640, "y": 360}
- {"action": "type", "text": "search query"}
- {"action": "press", "key": "Enter"}
- {"action": "scroll", "direction": "down"}
- {"action": "wait"}
- {"action": "done", "result": "Final answer or summary of what was accomplished"}

Rules:
1. Look carefully at the screenshot before deciding
2. Use "navigate" to go to a URL directly
3. Use "click" with exact pixel coordinates from the screenshot
4. Use "done" when the task is fully complete with a clear result
5. Never repeat the same action more than 3 times in a row
6. If a page is loading, use "wait"
"""

class BrowsingAgent:
    def __init__(self):
        self.history = []
        self.max_steps = 15

    def reset(self):
        self.history = []

    async def decide_action(self, task: str, screenshot_b64: str, step: int):
        history_text = ""
        if self.history:
            recent = self.history[-5:]
            history_text = "Recent actions taken:\n" + "\n".join(
                f"- {h}" for h in recent
            )

        prompt = f"""Task: {task}

Step: {step} of {self.max_steps}
{history_text}

Look at this screenshot and decide the next action.
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
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{screenshot_b64}"
                                    }
                                },
                                {
                                    "type": "text",
                                    "text": prompt
                                }
                            ]
                        }
                    ],
                    temperature=0.1,
                )
                raw = response.choices[0].message.content.strip()
                raw = raw.replace("```json", "").replace("```", "").strip()
                action = json.loads(raw)
                self.history.append(str(action))
                return action

            except Exception as e:
                if "429" in str(e) or "rate" in str(e).lower():
                    wait = 60 * (attempt + 1)
                    print(f"Rate limit hit — waiting {wait}s before retry {attempt+1}/5...")
                    time.sleep(wait)
                else:
                    raise e

        raise Exception("Max retries hit — API still rate limiting")

    async def run_task(self, task: str, browser, on_step=None):
        self.reset()

        for step in range(1, self.max_steps + 1):
            screenshot = await browser.screenshot_base64()
            current_url = await browser.get_url()

            action = await self.decide_action(task, screenshot, step)

            step_data = {
                "step": step,
                "action": action,
                "screenshot": screenshot,
                "url": current_url
            }

            if on_step:
                await on_step(step_data)

            if action.get("action") == "done":
                return {
                    "status": "completed",
                    "result": action.get("result", "Task completed"),
                    "steps": step
                }

            await browser.execute_action(action)

        return {
            "status": "max_steps_reached",
            "result": "Agent reached maximum steps",
            "steps": self.max_steps
        }