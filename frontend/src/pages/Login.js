import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

export default function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", full_name: "", username: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "signup") {
        await api.post("/auth/register", form);
      }
      const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
      if (error) throw new Error(error.message);
      nav("/dashboard");
    } catch (e2) {
      setErr(e2.response?.data?.detail || e2.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 animate-fade-up">
      <h1 className="font-script text-6xl text-mystic text-center mb-8">{mode === "login" ? "Welcome Back" : "Join SoulSeer"}</h1>
      <form onSubmit={submit} className="card p-8 space-y-4">
        {mode === "signup" && (
          <>
            <input data-testid="signup-fullname" className="input" placeholder="Full name" required value={form.full_name} onChange={set("full_name")} />
            <input data-testid="signup-username" className="input" placeholder="Username" required minLength={3} value={form.username} onChange={set("username")} />
          </>
        )}
        <input data-testid="auth-email" className="input" type="email" placeholder="Email" required value={form.email} onChange={set("email")} />
        <input data-testid="auth-password" className="input" type="password" placeholder="Password (min 8 characters)" required minLength={8} value={form.password} onChange={set("password")} />
        {err && <p data-testid="auth-error" className="text-red-400 text-sm">{err}</p>}
        <button data-testid="auth-submit" className="btn-pink w-full" disabled={busy}>
          {busy ? "Please wait..." : mode === "login" ? "Log In" : "Create Account"}
        </button>
        <button type="button" data-testid="auth-toggle-mode" className="text-sm text-white/60 hover:text-mystic w-full"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }}>
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
        <p className="text-xs text-white/30 text-center">Google & Apple sign-in coming soon (enable providers in Supabase).</p>
      </form>
    </div>
  );
}
