import asyncio
from typing import Callable

class TaskQueue:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.running = False
        self.current_task_id = None
        self.waiting_count = 0

    async def add_task(self, task_id: str, task_fn: Callable):
        self.waiting_count += 1
        await self.queue.put((task_id, task_fn))
        if not self.running:
            asyncio.create_task(self.process_queue())

    async def process_queue(self):
        self.running = True
        while not self.queue.empty():
            task_id, task_fn = await self.queue.get()
            self.current_task_id = task_id
            self.waiting_count -= 1
            try:
                await task_fn()
            except Exception as e:
                print(f"Task {task_id} failed: {e}")
            finally:
                self.current_task_id = None
                self.queue.task_done()
        self.running = False

    def get_status(self):
        return {
            "running": self.running,
            "current_task_id": self.current_task_id,
            "waiting": self.waiting_count
        }

task_queue = TaskQueue()