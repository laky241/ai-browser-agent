import { useEffect, useRef, useState } from "react"

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
        <circle cx="1.5" cy="1.5" r="1.5" fill="#fff" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#dots)" />
  </svg>
)

const NAV_ITEMS = [
  {
    id: "agent",
    icon: "✦",
    label: "Agent",
  },
  {
    id: "history",
    icon: "◷",
    label: "History",
  },
  {
    id: "about",
    icon: "ⓘ",
    label: "About",
  },
]

export default function App() {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(localStorage.getItem("token") || "")
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
    } else {
      const saved = localStorage.getItem("token")
      if (saved) setToken(saved)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const init = async () => {
      if (!token) {
        if (mounted) setLoading(false)
        return
      }

      try {
        const meRes = await fetch(`${BACKEND}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!meRes.ok) {
          localStorage.removeItem("token")
          if (mounted) {
            setToken("")
            setUser(null)
            setLoading(false)
          }
          return
        }

        const userData = await meRes.json()

        if (!mounted) return
        setUser(userData)

        const historyRes = await fetch(`${BACKEND}/tasks`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (historyRes.ok && mounted) {
          setHistory(await historyRes.json())
        }
      } catch {
        localStorage.removeItem("token")
        if (mounted) {
          setToken("")
          setUser(null)
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()

    return () => {
      mounted = false
    }
  }, [token])

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [steps])

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onerror = null
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [])

  const fetchHistory = async () => {
    if (!token) return

    try {
      const res = await fetch(`${BACKEND}/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) setHistory(await res.json())
    } catch {}
  }

  const login = async () => {
    try {
      const res = await fetch(`${BACKEND}/auth/login`, {
        credentials: "include",
      })

      const data = await res.json()

      if (data?.url) {
        window.location.href = data.url
      }
    } catch {
      alert("Cannot connect to backend. Make sure it is running on port 8000.")
    }
  }

  const logout = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    localStorage.removeItem("token")
    setToken("")
    setUser(null)
    setHistory([])
    setSteps([])
    setResult(null)
    setScreenshot(null)
    setTask("")
    setStatus("idle")
  }

  const runTask = async () => {
    if (!task.trim() || status === "running" || !token) return

    setSteps([])
    setScreenshot(null)
    setResult(null)
    setCurrentUrl("")
    setStatus("starting")

    try {
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

      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      const ws = new WebSocket(`${WS_BACKEND}/ws/${task_id}?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        setStatus("running")
      }

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
        }

        if (data.type === "done") {
          setResult(data.result)
          setStatus("done")
          fetchHistory()
          ws.close()
          wsRef.current = null
        }

        if (data.type === "error") {
          setResult({ error: data.message })
          setStatus("error")
          fetchHistory()
          ws.close()
          wsRef.current = null
        }
      }

      ws.onerror = () => {
        setStatus("error")
        setResult({ error: "WebSocket connection failed" })
      }

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null
        }
      }
    } catch {
      setStatus("error")
      setResult({ error: "Something went wrong while running the task" })
    }
  }

  const loadHistoryTask = (t) => {
    setSteps(t.steps || [])
    setResult(t.result || null)
    setCurrentUrl("")
    setScreenshot(null)
    setStatus(t.status || "idle")
    setTask(t.task || "")
    setActiveNav("agent")
  }

  const getActionLabel = (action) => {
    const a = action?.action
    if (a === "navigate") return "Navigate"
    if (a === "type") return "Type"
    if (a === "click") return "Click"
    if (a === "press") return "Press"
    if (a === "scroll") return "Scroll"
    if (a === "wait") return "Wait"
    if (a === "done") return "Done"
    if (a === "start") return "Start"
    return a || "Action"
  }

  if (loading) {
    return (
      <div style={styles.loadingWrap}>
        <div style={styles.loadingText}>Loading...</div>
      </div>
    )
  }

  if (!token || !user) {
    return (
      <div style={styles.authWrap}>
        <DOT_GRID />
        <div style={styles.authCard}>
          <div style={styles.logo}>✦</div>
          <div style={styles.badge}>Agentic Browser</div>
          <h1 style={styles.authTitle}>Autonomous browsing for real tasks</h1>
          <p style={styles.authText}>
            Run browser workflows in plain English and watch the agent navigate live.
          </p>
          <button onClick={login} style={styles.loginBtn}>
            Continue with Google
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.app}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTop}>
          <div style={styles.brand}>Browser Agent</div>
          <div style={styles.brandSub}>Agentic AI</div>
        </div>

        <div style={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              style={{
                ...styles.navBtn,
                ...(activeNav === item.id ? styles.navBtnActive : {}),
              }}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div style={styles.userBox}>
          <div style={styles.userName}>{user.name}</div>
          <button onClick={logout} style={styles.logoutBtn}>
            Logout
          </button>
        </div>
      </aside>

      <main style={styles.main}>
        {activeNav === "agent" && (
          <>
            <div style={styles.topbar}>
              <h1 style={styles.heading}>What should the agent do?</h1>
              <div style={styles.inputRow}>
                <input
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runTask()}
                  placeholder="Give me top news of today"
                  style={styles.input}
                />
                <button
                  onClick={runTask}
                  disabled={status === "running" || !task.trim()}
                  style={{
                    ...styles.runBtn,
                    opacity: status === "running" || !task.trim() ? 0.5 : 1,
                  }}
                >
                  {status === "running" ? "Running..." : "Run"}
                </button>
              </div>
            </div>

            <div style={styles.content}>
              <div style={styles.leftPane}>
                <div style={styles.panelTitle}>Action Log</div>

                <div ref={logsRef} style={styles.logWrap}>
                  {steps.length === 0 ? (
                    <div style={styles.empty}>No actions yet</div>
                  ) : (
                    steps.map((s, i) => (
                      <div key={`${s.step}-${i}`} style={styles.logCard}>
                        <div style={styles.logHead}>
                          <span style={styles.logStep}>{s.step}</span>
                          <span style={styles.logAction}>{getActionLabel(s.action)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {result && (
                  <div style={styles.resultBox}>
                    {result.error ? result.error : result.result}
                  </div>
                )}
              </div>

              <div style={styles.rightPane}>
                <DOT_GRID />
                <div style={styles.panelTitle}>Live Browser</div>
                <div style={styles.browserWrap}>
                  {screenshot ? (
                    <img src={screenshot} alt="Live browser" style={styles.browserImg} />
                  ) : (
                    <div style={styles.empty}>No browser activity</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {activeNav === "history" && (
          <div style={styles.page}>
            <h2 style={styles.pageTitle}>History</h2>
            <div style={styles.historyGrid}>
              {history.map((t) => (
                <div key={t.id} style={styles.historyCard} onClick={() => loadHistoryTask(t)}>
                  <div style={styles.historyTask}>{t.task}</div>
                  <div style={styles.historyMeta}>{t.status}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeNav === "about" && (
          <div style={styles.page}>
            <h2 style={styles.pageTitle}>About</h2>
            <p style={styles.aboutText}>
              Autonomous browser agent built with FastAPI, React, Playwright and WebSockets.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

const styles = {
  app: {
    minHeight: "100vh",
    display: "flex",
    background: "#0b0b0c",
    color: "#fff",
    fontFamily: "Inter, sans-serif",
  },
  loadingWrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0b0b0c",
    color: "#fff",
    fontFamily: "Inter, sans-serif",
  },
  loadingText: {
    fontSize: "18px",
  },
  authWrap: {
    minHeight: "100vh",
    background: "#0b0b0c",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    fontFamily: "Inter, sans-serif",
  },
  authCard: {
    width: "100%",
    maxWidth: "520px",
    background: "#121214",
    border: "1px solid #1f1f22",
    borderRadius: "24px",
    padding: "40px",
    position: "relative",
    zIndex: 1,
  },
  logo: {
    fontSize: "28px",
    marginBottom: "16px",
  },
  badge: {
    fontSize: "12px",
    color: "#a1a1aa",
    marginBottom: "16px",
  },
  authTitle: {
    fontSize: "40px",
    lineHeight: 1.1,
    marginBottom: "12px",
  },
  authText: {
    fontSize: "16px",
    color: "#a1a1aa",
    lineHeight: 1.6,
    marginBottom: "24px",
  },
  loginBtn: {
    width: "100%",
    height: "56px",
    border: "none",
    borderRadius: "14px",
    background: "#fff",
    color: "#000",
    fontSize: "16px",
    fontWeight: 600,
    cursor: "pointer",
  },
  sidebar: {
    width: "240px",
    borderRight: "1px solid #1f1f22",
    display: "flex",
    flexDirection: "column",
    background: "#111113",
  },
  sidebarTop: {
    padding: "24px",
    borderBottom: "1px solid #1f1f22",
  },
  brand: {
    fontSize: "20px",
    fontWeight: 700,
  },
  brandSub: {
    fontSize: "12px",
    color: "#71717a",
    marginTop: "4px",
  },
  nav: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  navBtn: {
    height: "48px",
    borderRadius: "12px",
    border: "none",
    background: "transparent",
    color: "#a1a1aa",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "0 14px",
    cursor: "pointer",
    fontSize: "16px",
  },
  navBtnActive: {
    background: "#1a1a1d",
    color: "#fff",
  },
  navIcon: {
    width: "20px",
    textAlign: "center",
  },
  userBox: {
    marginTop: "auto",
    padding: "20px",
    borderTop: "1px solid #1f1f22",
  },
  userName: {
    fontSize: "15px",
    marginBottom: "12px",
  },
  logoutBtn: {
    width: "100%",
    height: "44px",
    border: "none",
    borderRadius: "10px",
    background: "#1a1a1d",
    color: "#fff",
    cursor: "pointer",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  topbar: {
    padding: "32px",
    borderBottom: "1px solid #1f1f22",
  },
  heading: {
    fontSize: "42px",
    marginBottom: "20px",
    lineHeight: 1.1,
  },
  inputRow: {
    display: "flex",
    gap: "12px",
  },
  input: {
    flex: 1,
    height: "60px",
    borderRadius: "14px",
    border: "1px solid #27272a",
    background: "#111113",
    color: "#fff",
    padding: "0 18px",
    fontSize: "16px",
    outline: "none",
  },
  runBtn: {
    width: "120px",
    border: "none",
    borderRadius: "14px",
    background: "#fff",
    color: "#000",
    fontSize: "16px",
    fontWeight: 600,
    cursor: "pointer",
  },
  content: {
    flex: 1,
    display: "flex",
    minHeight: 0,
  },
  leftPane: {
    width: "360px",
    borderRight: "1px solid #1f1f22",
    display: "flex",
    flexDirection: "column",
    background: "#111113",
  },
  rightPane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    background: "#0b0b0c",
  },
  panelTitle: {
    padding: "18px 20px",
    fontSize: "14px",
    fontWeight: 700,
    borderBottom: "1px solid #1f1f22",
    position: "relative",
    zIndex: 1,
  },
  logWrap: {
    flex: 1,
    overflowY: "auto",
    padding: "12px",
  },
  logCard: {
    background: "#161619",
    border: "1px solid #222226",
    borderRadius: "12px",
    padding: "14px",
    marginBottom: "10px",
  },
  logHead: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  logStep: {
    width: "28px",
    height: "28px",
    borderRadius: "8px",
    background: "#232328",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 700,
  },
  logAction: {
    fontSize: "15px",
    fontWeight: 600,
  },
  resultBox: {
    margin: "12px",
    padding: "14px",
    background: "#161619",
    border: "1px solid #222226",
    borderRadius: "12px",
    fontSize: "14px",
    lineHeight: 1.6,
  },
  browserWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    position: "relative",
    zIndex: 1,
  },
  browserImg: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    borderRadius: "16px",
    border: "1px solid #222226",
  },
  empty: {
    color: "#71717a",
    fontSize: "16px",
  },
  page: {
    padding: "32px",
  },
  pageTitle: {
    fontSize: "32px",
    marginBottom: "20px",
  },
  historyGrid: {
    display: "grid",
    gap: "12px",
  },
  historyCard: {
    background: "#161619",
    border: "1px solid #222226",
    borderRadius: "14px",
    padding: "18px",
    cursor: "pointer",
  },
  historyTask: {
    fontSize: "16px",
    marginBottom: "8px",
  },
  historyMeta: {
    fontSize: "13px",
    color: "#71717a",
  },
  aboutText: {
    fontSize: "16px",
    color: "#a1a1aa",
    lineHeight: 1.7,
    maxWidth: "720px",
  },
}