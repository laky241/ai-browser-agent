# AI Browser Agent

An autonomous web browsing agent that takes a plain English task and controls a real browser to complete it while streaming every action live to a UI.

 like OpenAI Operator or Google Project Mariner


---

## Why I built this

I kept seeing news about agentic AI Operator, Mariner, Computer Use and wanted to understand how it actually works under the hood. So I built one myself. Turns out it's harder than it looks.

---

## What it does

You type something like "find the top 5 trending repos on GitHub today" and the agent:

1. Opens a real Chromium browser (runs headless in the background)
2. Navigates to the right page
3. Uses a vision LLM to look at a screenshot and decide what to do next
4. Clicks, types, scrolls whatever the task needs
5. Streams every step live to the UI so you can watch it work
6. Returns the actual answer when it's done

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│  Task Input → Live Browser Screen → Action Log → Result │
└─────────────────────┬───────────────────────────────────┘
                      │ WebSocket (live screenshots + steps)
                      │ REST (create task, fetch history)
┌─────────────────────▼───────────────────────────────────┐
│                   FastAPI Backend                        │
│                                                          │
│  POST /task  →  WebSocket /ws/{task_id}                 │
│                      │                                   │
│         ┌────────────▼────────────┐                     │
│         │      BrowsingAgent      │                     │
│         │  - decide_action()      │                     │
│         │  - loop detection       │                     │
│         │  - self recovery        │                     │
│         │  - action validation    │                     │
│         └────────────┬────────────┘                     │
│                      │                                   │
│         ┌────────────▼────────────┐                     │
│         │   BrowserController     │                     │
│         │  - Playwright chromium  │                     │
│         │  - screenshot capture   │                     │
│         │  - page text extract    │                     │
│         └─────────────────────────┘                     │
│                                                          │
│  SQLite Database  │  Google OAuth  │  Rate Limiting      │
└─────────────────────────────────────────────────────────┘
                      │
         ┌────────────▼────────────┐
         │     Vision LLM API      │
         │  NVIDIA NIM             │
         │  llama-3.2-90b-vision   │
         └─────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | FastAPI | Native async — needed for browser automation |
| Browser | Playwright | Async-first, better headless support than Selenium |
| LLM | NVIDIA NIM (Llama 3.2 90B Vision) | Free tier with vision support |
| Frontend | React + Vite | Fast, WebSocket support built in |
| Database | SQLite + SQLAlchemy | Zero config, works fine for this scale |
| Auth | Google OAuth + JWT | No password management needed |
| Streaming | WebSocket | One persistent connection instead of polling |
| Rate limiting | slowapi | Stops people from burning through API credits |

---

## Challenges

**Finding a free API that actually worked**

This took longer than I expected. Started with Gemini hit quota limits immediately. Tried Grok — no free credits. SambaNova — rate limited after 3 requests. Eventually landed on NVIDIA NIM which has a genuinely free tier with a vision model that works for this.

**Google kept showing CAPTCHAs**

The agent would open Google, start searching, and then get hit with "are you a robot?" Every time. Tried spoofing the user agent, disabling automation flags, faking browser plugins helped a bit but Google still caught it sometimes. Eventually switched to Brave Search for the initial query which doesn't block headless browsers.

**Google OAuth login kept failing**

The callback URL kept throwing 400 and 500 errors. Turned out Google was sending back a `state` parameter that the callback wasn't expecting. Also had a timing issue where the frontend would check for the token before the redirect had finished setting it — so the login screen would flash and disappear. Fixed both but took a while to debug.

**Agent getting stuck in loops**

The vision model would sometimes get confused on a page and just keep clicking the same coordinates over and over. Had to build loop detection — if the same action repeats 3 times in a row, it forces a recovery strategy (scroll first, then re-navigate). Not perfect but stops the infinite loop problem.

**Headless screenshots coming back blank**

When running in headless mode the screenshots were completely white. The page hadn't fully rendered before the screenshot was taken. Fixed it by adding a wait after navigation and using `domcontentloaded` as the load trigger.

---

## Key design decisions

**WebSockets over polling**
The agent takes 30-90 seconds and sends updates every few seconds. Polling would mean a new HTTP request every second. One WebSocket connection just pushes updates as they happen.

**Vision + page text together**
Screenshots alone are blurry for small text the model misreads things. Page text alone has no layout context for figuring out where to click. Using both together gives the model accurate text data AND spatial awareness.

**SQLite over Postgres**
This runs on a single server. SQLite is zero config and handles the load fine. Would switch to Postgres before scaling to multiple servers.

**Action validation layer**
The LLM can hallucinate it sometimes returns invalid URLs, out-of-bounds coordinates, or made-up action types. Every action goes through a validation layer before the browser executes it. The browser never touches anything the validator hasn't approved.

---

## Project Structure

```
ai-browser-agent/
├── backend/
│   ├── main.py          # FastAPI app, WebSocket endpoint, REST routes
│   ├── agent.py         # BrowsingAgent — LLM decision loop, recovery logic
│   ├── browser.py       # BrowserController — Playwright wrapper
│   ├── database.py      # SQLAlchemy models, CRUD operations
│   ├── auth.py          # Google OAuth, JWT token handling
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   └── App.jsx      # React UI — task input, live screen, action log
│   └── package.json
└── README.md
```

---

## Getting Started

### Prerequisites
- Python 3.12+
- Node.js 18+
- NVIDIA NIM API key — free at `build.nvidia.com`
- Google OAuth credentials — `console.cloud.google.com`

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

Create `.env`:
```
NVIDIA_API_KEY=your_key
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
SECRET_KEY=any_random_string
```

```bash
uvicorn main:app --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

---

## Limitations

- Agent quality is limited by the free vision model GPT-4o would be significantly better but costs money
- Sites with aggressive bot detection like Google and LinkedIn will block the headless browser
- SQLite doesn't scale horizontally fine for now, would need Postgres for multi-server
- No task cancellation once started if the agent gets stuck past the recovery logic it runs to max steps

---

## What I'd do differently

- Proper task queue with Redis + Celery instead of running tasks inline in the WebSocket handler
- Structured logging with request tracing so debugging is less painful
- DOM-based clicking using CSS selectors alongside coordinate clicking coordinates are brittle when page layouts shift
- Postgres with Alembic migrations from the start
- Component-based frontend instead of one big App.jsx got messy fast

---

## Inspired by

- [OpenAI Operator](https://openai.com/operator)
- [Google Project Mariner](https://deepmind.google/technologies/project-mariner/)
- [Anthropic Computer Use](https://www.anthropic.com/news/developing-computer-use)

