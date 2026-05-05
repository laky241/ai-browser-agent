import { useState, useRef, useEffect } from "react"

const BACKEND = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"
const WS_BACKEND = import.meta.env.VITE_WS_BASE_URL || "ws://localhost:8000"

const DOT_GRID = () => (
  <svg
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      opacity: 0.06,
      pointerEvents: "none",
    }}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <pattern id="dots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
        <circle cx="1.5" cy="1.5" r="1.5" fill="#000" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#dots)" />
  </svg>
)

const NAV_ITEMS = [
  {
    id: "agent",
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
      </svg>
    ),
    label: "Agent",
  },
  {
    id: "history",
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path d="M12 8v4l3 3" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
    label: "History",
  },
  {
    id: "about",
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M11 12h1v4h1" />
      </svg>
    ),
    label: "About",
  },
]

export default function App() {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState("")
  const [loading, setLoading] = useState(true)
  const [task, setTask] = useState("")
  const [status, setStatus] = useState("idle")
  const [steps, setSteps] = useState([])
  const [screenshot, setScreenshot] = useState(null)
  const [result, setResult] = useState(null)
  const [currentUrl, setCurrentUrl] = useState("")
  const [history, setHistory] = useState([])
  const [activeNav, setActiveNav] = useState("agent")

  const wsRef = useRef(null)
  const logsRef = useRef(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get("token")
  
    if (urlToken) {
      localStorage.setItem("token", urlToken)
      setToken(urlToken)
      window.history.replaceState({}, "", "/")
      return
    }
  
    const savedToken = localStorage.getItem("token")
    if (savedToken) {
      setToken(savedToken)
    } else {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) {
      fetchMe()
      fetchHistory()
    } else {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [steps])

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  const fetchMe = async () => {
    try {
      const res = await fetch(`${BACKEND}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setUser(await res.json())
      } else {
        localStorage.removeItem("token")
        setToken("")
        setUser(null)
      }
    } catch (error) {
      console.error("Failed to fetch user:", error)
      localStorage.removeItem("token")
      setToken("")
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${BACKEND}/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setHistory(await res.json())
    } catch (error) {
      console.error("Failed to fetch task history:", error)
    }
  }

  const login = async () => {
    try {
      const res = await fetch(`${BACKEND}/auth/login`, {
        method: "GET",
        credentials: "include",   // IMPORTANT
      })
  
      const data = await res.json()
  
      if (data.url) {
        window.location.href = data.url
      }
    } catch (e) {
      console.error("Login failed:", e)
      alert("Cannot connect to backend. Make sure it is running on port 8000.")
    }
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
    setStatus("starting")

    const res = await fetch(`${BACKEND}/task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ task }),
    })

    if (!res.ok) {
      setStatus("error")
      setResult({ error: "Failed to create task" })
      return
    }

    const { task_id } = await res.json()
    if (wsRef.current) wsRef.current.close()

    const ws = new WebSocket(`${WS_BACKEND}/ws/${task_id}?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => setStatus("running")

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type === "step") {
        setScreenshot(`data:image/jpeg;base64,${data.screenshot}`)
        setCurrentUrl(data.url)
        setSteps((prev) => [
          ...prev,
          {
            step: data.step,
            action: data.action,
            url: data.url,
            decision_trace: data.decision_trace || null,
            execution_trace: data.execution_trace || null,
            step_latency_ms: data.step_latency_ms || null,
          },
        ])
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
  }

  const loadHistoryTask = (t) => {
    setSteps(t.steps || [])
    setResult(t.result)
    setCurrentUrl("")
    setScreenshot(null)
    setStatus(t.status)
    setTask(t.task)
    setActiveNav("agent")
  }

  const getActionLabel = (action) => {
    const a = action.action
    if (a === "navigate") return "Navigate"
    if (a === "type") return "Type"
    if (a === "click") return "Click"
    if (a === "press") return "Press"
    if (a === "scroll") return "Scroll"
    if (a === "wait") return "Wait"
    if (a === "done") return "Done"
    if (a === "start") return "Start"
    return a
  }

  const totalTasks = history.length
  const completedTasks = history.filter((t) => t.status === "completed").length

  // LOADING
  if (loading) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#f5f5f3",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
      }}>
        <div style={{ fontSize: "14px", color: "#aaa", letterSpacing: "0.05em" }}>Loading...</div>
      </div>
    )
  }

  // LOGIN
  if (!token || !user) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#f5f5f3",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
        position: "relative",
        overflow: "hidden",
      }}>
        <DOT_GRID />
        <div style={{
          background: "#fff",
          borderRadius: "24px",
          padding: "64px 56px",
          maxWidth: "440px",
          width: "90%",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 8px 40px rgba(0,0,0,0.06)",
          position: "relative",
          zIndex: 1,
        }}>
          <div style={{
            width: "48px",
            height: "48px",
            background: "#0a0a0a",
            borderRadius: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "32px",
          }}>
            <svg width="22" height="22" fill="none" stroke="#fff" strokeWidth="1.5" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
          </div>

          <div style={{
            display: "inline-block",
            background: "#f0f0ee",
            borderRadius: "20px",
            padding: "4px 12px",
            fontSize: "11px",
            fontWeight: "500",
            color: "#666",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: "16px",
          }}>
            Agentic AI
          </div>

          <h1 style={{
            fontSize: "32px",
            fontWeight: "700",
            color: "#0a0a0a",
            margin: "0 0 12px",
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}>
            Browse the web.<br />Autonomously.
          </h1>

          <p style={{ fontSize: "14px", color: "#888", margin: "0 0 40px", lineHeight: 1.6 }}>
            Give it any task in plain English. Watch it navigate, click, and extract — all by itself.
          </p>

          <button
            onClick={login}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              background: "#0a0a0a",
              color: "#fff",
              border: "none",
              borderRadius: "14px",
              padding: "16px 24px",
              fontSize: "14px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
              <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.04a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
              <path fill="#FBBC05" d="M4.5 10.48A4.8 4.8 0 0 1 4.5 7.5V5.43H1.83a8 8 0 0 0 0 7.14z"/>
              <path fill="#EA4335" d="M8.98 3.58c1.32 0 2.5.45 3.44 1.35L14.7 2.6A8 8 0 0 0 1.83 5.44L4.5 7.5c.66-1.97 2.52-3.92 4.48-3.92z"/>
            </svg>
            Continue with Google
          </button>

          <div style={{ display: "flex", gap: "24px", marginTop: "40px", paddingTop: "32px", borderTop: "1px solid #f0f0ee" }}>
            {[["10M+", "Actions taken"], ["98%", "Task success"], ["< 30s", "Avg time"]].map(([val, label]) => (
              <div key={label}>
                <div style={{ fontSize: "20px", fontWeight: "700", color: "#0a0a0a" }}>{val}</div>
                <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        `}</style>
      </div>
    )
  }

  // MAIN APP
  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f3", display: "flex", fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif" }}>
      <div style={{ width: "220px", background: "#fff", borderRight: "1px solid #ebebeb", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid #f0f0ee" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "32px", height: "32px", background: "#0a0a0a", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" fill="none" stroke="#fff" strokeWidth="1.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "#0a0a0a" }}>Browser Agent</div>
              <div style={{ fontSize: "10px", color: "#aaa" }}>Agentic AI</div>
            </div>
          </div>
        </div>

        <nav style={{ padding: "12px", flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "none",
                cursor: "pointer",
                background: activeNav === item.id ? "#f0f0ee" : "transparent",
                color: activeNav === item.id ? "#0a0a0a" : "#888",
                fontSize: "13px",
                marginBottom: "2px",
                textAlign: "left",
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div style={{ margin: "12px", background: "#f8f8f6", borderRadius: "14px", padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "#aaa", marginBottom: "12px", textTransform: "uppercase" }}>Overview</div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "22px", fontWeight: "700", color: "#0a0a0a" }}>{totalTasks}</div>
              <div style={{ fontSize: "11px", color: "#aaa" }}>Total tasks</div>
            </div>
            <div>
              <div style={{ fontSize: "22px", fontWeight: "700", color: "#0a0a0a" }}>{completedTasks}</div>
              <div style={{ fontSize: "11px", color: "#aaa" }}>Completed</div>
            </div>
          </div>
        </div>

        <div style={{ padding: "16px", borderTop: "1px solid #f0f0ee", display: "flex", alignItems: "center", gap: "10px" }}>
          {user.picture && <img src={user.picture} style={{ width: "28px", height: "28px", borderRadius: "50%" }} alt="" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "12px", fontWeight: "500", color: "#0a0a0a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div>
          </div>
          <button onClick={logout} style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: "16px" }}>
            ⎋
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {activeNav === "agent" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid #ebebeb", background: "#fff", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "20px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: "#aaa", textTransform: "uppercase", marginBottom: "6px" }}>
                    {status === "running" ? "● Live" : status === "done" ? "✓ Done" : "Ready"}
                  </div>
                  <h1 style={{ fontSize: "28px", fontWeight: "700", color: "#0a0a0a", margin: 0 }}>
                    What should the<br />agent do?
                  </h1>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  type="text"
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runTask()}
                  placeholder="e.g. Find top 5 trending GitHub repos today"
                  style={{
                    flex: 1,
                    border: "1.5px solid #e8e8e8",
                    borderRadius: "12px",
                    padding: "13px 18px",
                    fontSize: "13px",
                    background: "#fafaf9",
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
                <button
                  onClick={runTask}
                  disabled={status === "running" || !task.trim()}
                  style={{
                    background: "#0a0a0a",
                    color: "#fff",
                    border: "none",
                    borderRadius: "12px",
                    padding: "13px 24px",
                    fontSize: "13px",
                    cursor: "pointer",
                    opacity: status === "running" || !task.trim() ? 0.3 : 1,
                    fontFamily: "inherit",
                  }}
                >
                  {status === "running" ? "Running..." : "Run"}
                </button>
              </div>
            </div>

            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ width: "340px", borderRight: "1px solid #ebebeb", display: "flex", flexDirection: "column", background: "#fff", flexShrink: 0 }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f0ee", flexShrink: 0 }}>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "#0a0a0a", textTransform: "uppercase" }}>Action Log</div>
                  {currentUrl && <div style={{ fontSize: "11px", color: "#aaa", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUrl}</div>}
                </div>

                <div ref={logsRef} style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
                  {steps.length === 0 ? (
                    <div style={{ textAlign: "center", paddingTop: "48px" }}>
                      <div style={{ fontSize: "12px", color: "#ccc" }}>No actions yet</div>
                    </div>
                  ) : (
                    steps.map((s, i) => (
                      <div key={i} style={{
                        padding: "12px",
                        borderRadius: "10px",
                        marginBottom: "8px",
                        background: i === steps.length - 1 ? "#f8f8f6" : "#fff",
                        border: "1px solid #efefef",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{
                              width: "20px", height: "20px", borderRadius: "6px",
                              background: "#f0f0ee", display: "flex", alignItems: "center",
                              justifyContent: "center", fontSize: "10px", color: "#666", fontWeight: "600",
                            }}>
                              {s.step}
                            </div>
                            <span style={{ fontSize: "12px", fontWeight: "600", color: "#111" }}>{getActionLabel(s.action)}</span>
                          </div>
                          {s.execution_trace && (
                            <span style={{
                              fontSize: "10px", fontWeight: "600", padding: "3px 8px", borderRadius: "999px",
                              background: s.execution_trace.status === "success" ? "#f0faf4" : "#fff5f5",
                              color: s.execution_trace.status === "success" ? "#15803d" : "#dc2626",
                            }}>
                              {s.execution_trace.status}
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {s.execution_trace?.duration_ms !== undefined && (
                            <div style={{ fontSize: "10px", padding: "3px 8px", borderRadius: "8px", background: "#f5f5f3", color: "#555" }}>
                              {s.execution_trace.duration_ms}ms
                            </div>
                          )}
                        </div>

                        {s.execution_trace?.error && (
                          <div style={{
                            marginTop: "6px", fontSize: "11px", color: "#dc2626",
                            background: "#fff5f5", padding: "6px 8px", borderRadius: "6px",
                          }}>
                            {s.execution_trace.error}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  {status === "running" && (
                    <div style={{ padding: "12px", borderRadius: "10px", background: "#f8f8f6", border: "1px solid #efefef" }}>
                      <div style={{ fontSize: "12px", color: "#aaa" }}>Thinking...</div>
                    </div>
                  )}
                </div>

                {result && (
                  <div style={{
                    margin: "12px",
                    borderRadius: "12px",
                    padding: "14px",
                    background: result.error ? "#fff5f5" : "#f0faf4",
                    border: `1px solid ${result.error ? "#fecaca" : "#bbf7d0"}`,
                    flexShrink: 0,
                  }}>
                    <div style={{ fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.06em", color: result.error ? "#ef4444" : "#16a34a", marginBottom: "6px" }}>
                      {result.error ? "Error" : "Result"}
                    </div>
                    <div style={{ fontSize: "12px", color: result.error ? "#dc2626" : "#15803d", lineHeight: 1.5 }}>
                      {result.error ? result.error : result.result}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#f5f5f3", position: "relative", overflow: "hidden" }}>
                <DOT_GRID />
                <div style={{ padding: "16px 20px", background: "rgba(255,255,255,0.8)", borderBottom: "1px solid #ebebeb", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 1, flexShrink: 0 }}>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "#0a0a0a", textTransform: "uppercase" }}>Live Browser</div>
                  {status === "running" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse 1s infinite" }}></span>
                      <span style={{ fontSize: "11px", color: "#666" }}>Live</span>
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", position: "relative", zIndex: 1 }}>
                  {screenshot ? (
                    <img src={screenshot} alt="Live browser" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: "12px", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", objectFit: "contain" }} />
                  ) : (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ width: "48px", height: "48px", background: "#fff", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                        <span style={{ fontSize: "22px" }}>🌐</span>
                      </div>
                      <div style={{ fontSize: "14px", fontWeight: "500", color: "#999" }}>No browser activity</div>
                      <div style={{ fontSize: "12px", color: "#bbb", marginTop: "4px" }}>Run a task to see the live screen</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeNav === "history" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "32px" }}>
            <h2 style={{ fontSize: "24px", fontWeight: "700", color: "#0a0a0a", margin: "0 0 8px" }}>Task History</h2>
            <p style={{ fontSize: "13px", color: "#aaa", margin: "0 0 28px" }}>All your past agent runs</p>
            {history.length === 0 ? (
              <div style={{ textAlign: "center", paddingTop: "80px" }}>
                <div style={{ fontSize: "14px", color: "#ccc" }}>No tasks yet — run your first one!</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px" }}>
                {history.map((t) => (
                  <div key={t.id} onClick={() => loadHistoryTask(t)} style={{
                    background: "#fff", borderRadius: "14px", padding: "20px",
                    cursor: "pointer", border: "1px solid #ebebeb", transition: "box-shadow 0.15s"
                  }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)"}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                      <p style={{ fontSize: "13px", fontWeight: "500", color: "#0a0a0a", margin: 0, flex: 1, paddingRight: "12px" }}>{t.task}</p>
                      <span style={{
                        fontSize: "10px", padding: "3px 10px", borderRadius: "20px", flexShrink: 0,
                        background: t.status === "completed" ? "#f0faf4" : t.status === "failed" ? "#fff5f5" : "#f0f0ee",
                        color: t.status === "completed" ? "#16a34a" : t.status === "failed" ? "#ef4444" : "#666"
                      }}>{t.status}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "11px", color: "#aaa" }}>{t.steps?.length || 0} steps</span>
                      <span style={{ fontSize: "11px", color: "#aaa" }}>{new Date(t.created_at).toLocaleDateString()}</span>
                    </div>
                    {t.result?.result && (
                      <div style={{ marginTop: "10px", fontSize: "11px", color: "#888", lineHeight: 1.5, borderTop: "1px solid #f5f5f3", paddingTop: "10px", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {t.result.result}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeNav === "about" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "32px", maxWidth: "640px" }}>
            <div style={{ display: "inline-block", background: "#f0f0ee", borderRadius: "20px", padding: "4px 12px", fontSize: "11px", color: "#666", textTransform: "uppercase", marginBottom: "16px" }}>
              About this project
            </div>
            <h2 style={{ fontSize: "32px", fontWeight: "700", color: "#0a0a0a", margin: "0 0 16px", lineHeight: 1.2 }}>
              Autonomous.<br />Intelligent.<br />Built from scratch.
            </h2>
            <p style={{ fontSize: "14px", color: "#666", lineHeight: 1.7, margin: "0 0 32px" }}>
              An end-to-end agentic AI system that controls a real browser using vision LLMs. Similar to OpenAI Operator and Google Project Mariner — built independently.
            </p>
            {[
              ["Browser Control", "Playwright controls a real Chromium browser — clicking, typing, scrolling, navigating just like a human."],
              ["Vision LLM", "Every step, the AI sees a screenshot + page text and decides the next action using a vision language model."],
              ["Live Streaming", "WebSocket streams every screenshot to the frontend in real time so you watch the agent work live."],
              ["Full Stack", "FastAPI backend, React frontend, SQLite database, Google OAuth, rate limiting — production grade architecture."],
            ].map(([title, desc]) => (
              <div key={title} style={{ display: "flex", gap: "16px", marginBottom: "24px" }}>
                <div style={{ width: "36px", height: "36px", background: "#0a0a0a", borderRadius: "10px", flexShrink: 0 }}></div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#0a0a0a", marginBottom: "4px" }}>{title}</div>
                  <div style={{ fontSize: "13px", color: "#888", lineHeight: 1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  )
}