import os
import json
import base64
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
"""

class BrowsingAgent:
    def __init__(self):
        self.history = []
        self.max_steps = 15

    def reset(self):
        self.history = []

    async def decide_action(self, task: str, screenshot_b64: str, step: int, page_text: str = ""):
        history_text = ""
        if self.history:
            recent = self.history[-5:]
            history_text = "Recent actions taken:\n" + "\n".join(
                f"- {h}" for h in recent
            )

        prompt = f"""Task: {task}

Step: {step} of {self.max_steps}
{history_text}

PAGE TEXT CONTENT (read this to find actual data):
{page_text[:2000] if page_text else "Page still loading..."}

Look at the screenshot AND the page text above to decide the next action.
If the page text contains the answer to the task, use "done" with the actual answer.
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
                    max_tokens=512,
                )
                raw = response.choices[0].message.content.strip()
                raw = raw.replace("```json", "").replace("```", "").strip()
                action = json.loads(raw)
                self.history.append(str(action))
                return action

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

            # step 1 always navigates directly to bing search
            if step == 1:
                search_query = urllib.parse.quote_plus(task)
                action = {"action": "navigate", "url": f"https://www.bing.com/search?q={search_query}"}
            else:
                # detect if agent is stuck clicking same spot
                if len(self.history) >= 3:
                    last_3 = self.history[-3:]
                    if len(set(last_3)) == 1 and "click" in last_3[0]:
                        print("Loop detected — forcing scroll")
                        action = {"action": "scroll", "direction": "down"}
                        self.history.append(str(action))
                    else:
                        action = await self.decide_action(task, screenshot, step, page_text)
                else:
                    action = await self.decide_action(task, screenshot, step, page_text)

            step_data = {
                "step": step,
                "action": action,
                "screenshot": screenshot,
                "url": current_url,
                "page_text": page_text
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