import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"

export default function AdminLogin() {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const navigate = useNavigate()

  async function login() {
    setErr("")
    setBusy(true)
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr(data.detail || "Login failed")
        return
      }

      navigate("/admin/editor")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <Link to="/">← Back</Link>
      <h1 style={{ marginTop: 12 }}>Admin Login</h1>

      <div style={{ marginTop: 12 }}>
        <input
          type="password"
          value={password}
          placeholder="Admin password"
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 10, width: 320 }}
        />
        <button
          onClick={login}
          disabled={busy || !password}
          style={{ marginLeft: 10, padding: "10px 14px" }}
        >
          {busy ? "Logging in..." : "Login"}
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "#b00020" }}>
          {err}
        </div>
      )}
    </div>
  )
}