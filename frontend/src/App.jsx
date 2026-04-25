import { useState, useRef, useEffect } from "react"

const BACKEND = "http://localhost:8000"
const WS_BACKEND = "ws://localhost:8000"

export default function App() {
  const [task, setTask] = useState("")
  const [status, setStatus] = useState("idle")
  const [steps, setSteps] = useState([])
  const [screenshot, setScreenshot] = useState(null)
  const [result, setResult] = useState(null)
  const [currentUrl, setCurrentUrl] = useState("")
  const wsRef = useRef(null)
  const logsRef = useRef(null)

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [steps])

  const runTask = async () => {
    if (!task.trim() || status === "running") return
    setSteps([])
    setScreenshot(null)
    setResult(null)
    setCurrentUrl("")
    setStatus("starting")

    const res = await fetch(`${BACKEND}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      } else if (data.type === "error") {
        setResult({ error: data.message })
        setStatus("error")
      }
    }
    ws.onclose = () => { if (status === "running") setStatus("done") }
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
    return "·"
  }

  const getStatusBadge = () => {
    if (status === "idle") return { label: "Ready", color: "bg-gray-100 text-gray-500" }
    if (status === "starting") return { label: "Starting", color: "bg-amber-50 text-amber-600" }
    if (status === "running") return { label: "Running", color: "bg-blue-50 text-blue-600" }
    if (status === "done") return { label: "Done", color: "bg-green-50 text-green-600" }
    if (status === "error") return { label: "Error", color: "bg-red-50 text-red-500" }
  }

  const badge = getStatusBadge()

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>

      {/* Top Nav */}
      <nav className="border-b border-gray-100 px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">A</span>
          </div>
          <span className="font-semibold text-gray-900 text-sm">AI Browser Agent</span>
        </div>
        <div className={`text-xs font-medium px-3 py-1 rounded-full ${badge.color}`}>
          {badge.label}
          {status === "running" && (
            <span className="ml-1.5 inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">

        {/* Task Input Section */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">What should the agent do?</h1>
          <p className="text-sm text-gray-400 mb-4">Describe a task in plain English. The agent will browse the web autonomously.</p>
          <div className="flex gap-3">
            <input
              type="text"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-50 transition-all"
              placeholder="e.g. Go to bing.com and find the latest news about AI"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runTask() }}
            />
            <button
              onClick={runTask}
              disabled={status === "running" || !task.trim()}
              className="bg-gray-900 text-white text-sm font-medium px-6 py-3 rounded-xl hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {status === "running" ? "Running..." : "Run"}
            </button>
          </div>
        </div>

        {/* Split View */}
        <div className="grid grid-cols-2 gap-6">

          {/* Left — Action Log */}
          <div className="border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Action Log</h2>
                <p className="text-xs text-gray-400 mt-0.5">Every step the agent takes</p>
              </div>
              {steps.length > 0 && (
                <span className="text-xs text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full">
                  {steps.length} steps
                </span>
              )}
            </div>

            {/* URL bar */}
            {currentUrl && (
              <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400"></div>
                <span className="text-xs text-gray-400 truncate">{currentUrl}</span>
              </div>
            )}

            {/* Steps */}
            <div ref={logsRef} className="overflow-y-auto p-5 space-y-1" style={{ height: "420px" }}>
              {steps.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                    <span className="text-gray-300 text-lg">◎</span>
                  </div>
                  <p className="text-sm text-gray-300">No actions yet</p>
                  <p className="text-xs text-gray-200 mt-1">Run a task to see the agent work</p>
                </div>
              ) : (
                steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="w-6 h-6 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-gray-400 text-xs">{getActionIcon(s.action)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700">{getActionLabel(s.action)}</p>
                    </div>
                    <span className="text-xs text-gray-300 shrink-0">{s.step}</span>
                  </div>
                ))
              )}
              {status === "running" && (
                <div className="flex items-center gap-3 py-2">
                  <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <span className="text-blue-400 text-xs animate-pulse">·</span>
                  </div>
                  <p className="text-sm text-gray-400 animate-pulse">Thinking...</p>
                </div>
              )}
            </div>

            {/* Result */}
            {result && (
              <div className={`mx-5 mb-5 rounded-xl p-4 ${result.error ? "bg-red-50 border border-red-100" : "bg-green-50 border border-green-100"}`}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1 ${result.error ? 'text-red-400' : 'text-green-500'}">
                  {result.error ? "Error" : "Result"}
                </p>
                <p className={`text-sm ${result.error ? "text-red-600" : "text-green-700"}`}>
                  {result.error ? result.error : result.result}
                </p>
              </div>
            )}
          </div>

          {/* Right — Live Browser */}
          <div className="border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Live Browser</h2>
                <p className="text-xs text-gray-400 mt-0.5">Real-time view of the agent's screen</p>
              </div>
              {status === "running" && (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></div>
                  <span className="text-xs text-gray-400">Live</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-center bg-gray-50" style={{ height: "480px" }}>
              {screenshot ? (
                <img
                  src={screenshot}
                  alt="Live browser"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-center">
                  <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 flex items-center justify-center mx-auto mb-4 shadow-sm">
                    <span className="text-2xl">🌐</span>
                  </div>
                  <p className="text-sm font-medium text-gray-400">No browser activity</p>
                  <p className="text-xs text-gray-300 mt-1">Start a task to see the live screen</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}