import { useState, useRef, useEffect } from "react"

const BACKEND = "http://localhost:8000"
const WS_BACKEND = "ws://localhost:8000"

export default function App() {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(localStorage.getItem("token") || "")
  const [task, setTask] = useState("")
  const [status, setStatus] = useState("idle")
  const [steps, setSteps] = useState([])
  const [screenshot, setScreenshot] = useState(null)
  const [result, setResult] = useState(null)
  const [currentUrl, setCurrentUrl] = useState("")
  const [history, setHistory] = useState([])
  const [selectedTask, setSelectedTask] = useState(null)
  const wsRef = useRef(null)
  const logsRef = useRef(null)

  useEffect(() => {
    // grab token from URL after google login redirect
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get("token")
    if (urlToken) {
      localStorage.setItem("token", urlToken)
      setToken(urlToken)
      window.history.replaceState({}, "", "/")
    }
  }, [])

  useEffect(() => {
    if (token) {
      fetchMe()
      fetchHistory()
    }
  }, [token])

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [steps])

  const fetchMe = async () => {
    try {
      const res = await fetch(`${BACKEND}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setUser(data)
      } else {
        logout()
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${BACKEND}/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setHistory(data)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const login = async () => {
    const res = await fetch(`${BACKEND}/auth/login`)
    const data = await res.json()
    window.location.href = data.url
  }

  const logout = () => {
    localStorage.removeItem("token")
    setToken("")
    setUser(null)
    setHistory([])
  }

  const runTask = async () => {
    if (!task.trim() || status === "running") return
    setSteps([])
    setScreenshot(null)
    setResult(null)
    setCurrentUrl("")
    setSelectedTask(null)
    setStatus("starting")

    const res = await fetch(`${BACKEND}/task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ task }),
    })
    const { task_id } = await res.json()
    const ws = new WebSocket(`${WS_BACKEND}/ws/${task_id}`)
    wsRef.current = ws

    ws.onopen = () => setStatus("running")
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type === "status") {
        setStatus("running")
      } else if (data.type === "step") {
        setScreenshot(`data:image/jpeg;base64,${data.screenshot}`)
        setCurrentUrl(data.url)
        setSteps((prev) => [...prev, { step: data.step, action: data.action, url: data.url }])
      } else if (data.type === "done") {
        setResult(data.result)
        setStatus("done")
        fetchHistory()
      } else if (data.type === "error") {
        setResult({ error: data.message })
        setStatus("error")
        fetchHistory()
      }
    }
    ws.onclose = () => { if (status === "running") setStatus("done") }
  }

  const loadHistoryTask = (t) => {
    setSelectedTask(t)
    setSteps(t.steps || [])
    setResult(t.result)
    setCurrentUrl("")
    setScreenshot(null)
    setStatus(t.status)
    setTask(t.task)
  }

  const getActionLabel = (action) => {
    const a = action.action
    if (a === "navigate") return `Go to ${action.url}`
    if (a === "type") return `Type "${action.text}"`
    if (a === "click") return `Click (${action.x}, ${action.y})`
    if (a === "press") return `Press ${action.key}`
    if (a === "scroll") return `Scroll ${action.direction}`
    if (a === "wait") return `Waiting...`
    if (a === "done") return `Finished`
    if (a === "start") return `Browser started`
    return a
  }

  const getActionIcon = (action) => {
    const a = action.action
    if (a === "navigate") return "→"
    if (a === "type") return "✎"
    if (a === "click") return "◎"
    if (a === "press") return "↵"
    if (a === "scroll") return "↕"
    if (a === "wait") return "◌"
    if (a === "done") return "✓"
    if (a === "start") return "⬡"
    return "·"
  }

  const getStatusBadge = () => {
    if (status === "idle") return { label: "Ready", color: "bg-gray-100 text-gray-500" }
    if (status === "starting") return { label: "Starting", color: "bg-amber-50 text-amber-600" }
    if (status === "running") return { label: "Running", color: "bg-blue-50 text-blue-600" }
    if (status === "done" || status === "completed") return { label: "Done", color: "bg-green-50 text-green-600" }
    if (status === "error" || status === "failed") return { label: "Error", color: "bg-red-50 text-red-500" }
    return { label: status, color: "bg-gray-100 text-gray-500" }
  }

  const getHistoryStatusColor = (s) => {
    if (s === "completed") return "bg-green-100 text-green-600"
    if (s === "failed") return "bg-red-100 text-red-500"
    if (s === "running") return "bg-blue-100 text-blue-600"
    return "bg-gray-100 text-gray-500"
  }

  const badge = getStatusBadge()

  // LOGIN PAGE
  if (!token || !user) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
        <div className="text-center max-w-md px-8">
          <div className="w-14 h-14 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-white text-2xl font-bold">A</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">AI Browser Agent</h1>
          <p className="text-gray-400 text-sm mb-8 leading-relaxed">
            An autonomous AI that browses the web for you. Give it any task in plain English and watch it work in real time.
          </p>
          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-xl px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all"
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
              <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.04a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
              <path fill="#FBBC05" d="M4.5 10.48A4.8 4.8 0 0 1 4.5 7.5V5.43H1.83a8 8 0 0 0 0 7.14z"/>
              <path fill="#EA4335" d="M8.98 3.58c1.32 0 2.5.45 3.44 1.35L14.7 2.6A8 8 0 0 0 1.83 5.44L4.5 7.5c.66-1.97 2.52-3.92 4.48-3.92z"/>
            </svg>
            Continue with Google
          </button>
          <p className="text-xs text-gray-300 mt-4">No credit card required</p>
        </div>
      </div>
    )
  }

  // MAIN APP
  return (
    <div className="min-h-screen bg-white flex flex-col" style={{ fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>

      {/* Top Nav */}
      <nav className="border-b border-gray-100 px-6 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">A</span>
          </div>
          <span className="font-semibold text-gray-900 text-sm">AI Browser Agent</span>
        </div>
        <div className="flex items-center gap-3">
          <div className={`text-xs font-medium px-3 py-1 rounded-full ${badge.color}`}>
            {badge.label}
            {status === "running" && (
              <span className="ml-1.5 inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
            )}
          </div>
          <div className="flex items-center gap-2 border-l border-gray-100 pl-3">
            {user.picture && (
              <img src={user.picture} className="w-7 h-7 rounded-full" alt={user.name} />
            )}
            <span className="text-xs text-gray-600">{user.name}</span>
            <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 ml-1">Sign out</button>
          </div>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">

        {/* Left Sidebar — History */}
        <div className="w-64 border-r border-gray-100 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-900">Task History</span>
            <button onClick={fetchHistory} className="text-xs text-gray-400 hover:text-gray-600">↻</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {history.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-xs text-gray-300">No tasks yet</p>
              </div>
            ) : (
              history.map((t) => (
                <div
                  key={t.id}
                  onClick={() => loadHistoryTask(t)}
                  className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${selectedTask?.id === t.id ? "bg-gray-50" : ""}`}
                >
                  <p className="text-xs text-gray-700 font-medium truncate mb-1">{t.task}</p>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${getHistoryStatusColor(t.status)}`}>
                      {t.status}
                    </span>
                    <span className="text-xs text-gray-300">{t.steps?.length || 0} steps</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Task Input */}
          <div className="px-6 py-4 border-b border-gray-100 shrink-0">
            <div className="flex gap-3">
              <input
                type="text"
                className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-50 transition-all"
                placeholder="e.g. Find the top 5 trending repos on GitHub today"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runTask() }}
              />
              <button
                onClick={runTask}
                disabled={status === "running" || !task.trim()}
                className="bg-gray-900 text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                {status === "running" ? "Running..." : "Run"}
              </button>
            </div>
          </div>

          {/* Split View */}
          <div className="flex-1 flex overflow-hidden">

            {/* Action Log */}
            <div className="w-80 border-r border-gray-100 flex flex-col shrink-0">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-xs font-semibold text-gray-900">Action Log</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Every step the agent takes</p>
                </div>
                {steps.length > 0 && (
                  <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                    {steps.length} steps
                  </span>
                )}
              </div>

              {currentUrl && (
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2 shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
                  <span className="text-xs text-gray-400 truncate">{currentUrl}</span>
                </div>
              )}

              <div ref={logsRef} className="flex-1 overflow-y-auto p-4 space-y-1">
                {steps.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center">
                    <p className="text-xs text-gray-300">No actions yet</p>
                    <p className="text-xs text-gray-200 mt-1">Run a task to see the agent work</p>
                  </div>
                ) : (
                  steps.map((s, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1.5 border-b border-gray-50 last:border-0">
                      <div className="w-5 h-5 rounded-md bg-gray-50 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-gray-400 text-xs">{getActionIcon(s.action)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700">{getActionLabel(s.action)}</p>
                      </div>
                      <span className="text-xs text-gray-300 shrink-0">{s.step}</span>
                    </div>
                  ))
                )}
                {status === "running" && (
                  <div className="flex items-center gap-2.5 py-1.5">
                    <div className="w-5 h-5 rounded-md bg-blue-50 flex items-center justify-center shrink-0">
                      <span className="text-blue-400 text-xs animate-pulse">·</span>
                    </div>
                    <p className="text-xs text-gray-400 animate-pulse">Thinking...</p>
                  </div>
                )}
              </div>

              {result && (
                <div className={`mx-4 mb-4 rounded-xl p-3 shrink-0 ${result.error ? "bg-red-50 border border-red-100" : "bg-green-50 border border-green-100"}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${result.error ? "text-red-400" : "text-green-500"}`}>
                    {result.error ? "Error" : "Result"}
                  </p>
                  <p className={`text-xs leading-relaxed ${result.error ? "text-red-600" : "text-green-700"}`}>
                    {result.error ? result.error : result.result}
                  </p>
                </div>
              )}
            </div>

            {/* Live Browser */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-xs font-semibold text-gray-900">Live Browser</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Real-time view of the agent's screen</p>
                </div>
                {status === "running" && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></div>
                    <span className="text-xs text-gray-400">Live</span>
                  </div>
                )}
              </div>

              <div className="flex-1 flex items-center justify-center bg-gray-50 overflow-hidden">
                {screenshot ? (
                  <img
                    src={screenshot}
                    alt="Live browser"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center">
                    <div className="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center mx-auto mb-3 shadow-sm">
                      <span className="text-xl">🌐</span>
                    </div>
                    <p className="text-sm font-medium text-gray-400">No browser activity</p>
                    <p className="text-xs text-gray-300 mt-1">
                      {selectedTask ? "Screenshots not stored for past tasks" : "Start a task to see the live screen"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}