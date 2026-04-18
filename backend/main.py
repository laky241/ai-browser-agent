import asyncio
from browser import BrowserController
from agent import BrowsingAgent

async def test():
    browser = BrowserController()
    agent = BrowsingAgent()

    print("Starting browser...")
    await browser.start()

    task = "Go to bing.com and search for Anthropic AI and tell me the top 3 results"
    print(f"Task: {task}")
    print("Agent starting...\n")

    async def print_step(step_data):
        print(f"Step {step_data['step']}: {step_data['action']}")

    result = await agent.run_task(task, browser, on_step=print_step)

    print(f"\n✅ Result: {result}")
    await asyncio.sleep(3)
    await browser.stop()

if __name__ == "__main__":
    asyncio.run(test())