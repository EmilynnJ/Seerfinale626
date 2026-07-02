import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmt, fmtDate, fmtDuration } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import Stars from "../../components/Stars";

export default function ReaderDashboard() {
  const { profile, refreshProfile } = useAuth();
  const nav = useNavigate();
  const [earnings, setEarnings] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [rates, setRates] = useState({ chat: "", voice: "", video: "" });
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState("sessions");

  const load = useCallback(async () => {
    const [e, s, r] = await Promise.all([
      api.get("/readers/me/earnings"), api.get("/readers/me/sessions"), api.get("/readers/me/reviews"),
    ]);
    setEarnings(e.data);
    setSessions(s.data);
    setReviews(r.data);
  }, []);

  useEffect(() => {
    load();
    setRates({
      chat: (profile.pricing_chat / 100).toFixed(2),
      voice: (profile.pricing_voice / 100).toFixed(2),
      video: (profile.pricing_video / 100).toFixed(2),
    });
    const t = setInterval(async () => {
      try { const { data } = await api.get("/readings/incoming"); setIncoming(data); } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [load, profile]);

  const toggleOnline = async () => {
    await api.patch("/readers/me/status", { is_online: !profile.is_online });
    await refreshProfile();
  };

  const saveRates = async () => {
    setMsg("");
    try {
      await api.patch("/readers/me/pricing", {
        pricing_chat: Math.round(parseFloat(rates.chat || 0) * 100),
        pricing_voice: Math.round(parseFloat(rates.voice || 0) * 100),
        pricing_video: Math.round(parseFloat(rates.video || 0) * 100),
      });
      await refreshProfile();
      setMsg("Rates saved — they apply to all new reading requests immediately.");
    } catch (e) {
      setMsg(e.response?.data?.detail || "Could not save rates");
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <h1 className="font-script text-6xl text-mystic">Reader Dashboard</h1>
        <button data-testid="online-toggle" onClick={toggleOnline}
          className={`rounded-full px-6 py-2 font-semibold transition-colors ${profile.is_online ? "bg-green-500 text-cosmos" : "bg-white/10 text-white/60"}`}>
          {profile.is_online ? "● Online — Accepting Readings" : "○ Offline — Go Online"}
        </button>
      </div>

      {incoming.length > 0 && (
        <div className="card p-6 mb-8 border-mystic animate-pulse" data-testid="incoming-requests">
          <h2 className="text-mystic text-lg mb-3">🔔 Incoming Reading Requests</h2>
          {incoming.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2">
              <span className="capitalize">{r.type} reading from {r.client_username} · {fmt(r.price_per_minute)}/min</span>
              <button data-testid={`open-request-${r.id}`} className="btn-pink text-sm" onClick={() => nav(`/reading/${r.id}`)}>View Request</button>
            </div>
          ))}
        </div>
      )}

      {earnings && (
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <div className="card p-5"><p className="text-white/50 text-sm">Today's Earnings</p><p data-testid="earnings-today" className="text-3xl text-gold">{fmt(earnings.today_earnings)}</p></div>
          <div className="card p-5"><p className="text-white/50 text-sm">Pending Payout</p><p data-testid="earnings-pending" className="text-3xl text-gold">{fmt(earnings.pending_payout)}</p><p className="text-white/30 text-xs mt-1">Paid out by admin at $15+ threshold</p></div>
          <div className="card p-5"><p className="text-white/50 text-sm">Historical Earnings</p><p data-testid="earnings-total" className="text-3xl text-gold">{fmt(earnings.historical_earnings)}</p><p className="text-white/30 text-xs mt-1">Your share: {earnings.commission_pct}% of each minute</p></div>
        </div>
      )}

      <div className="card p-6 mb-8">
        <h2 className="text-gold text-lg mb-4">Per-Minute Rates</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {["chat", "voice", "video"].map((t) => (
            <label key={t} className="text-sm text-white/60 capitalize">
              {t} ($/min)
              <input data-testid={`rate-${t}`} className="input mt-1" type="number" min="0" step="0.01"
                value={rates[t]} onChange={(e) => setRates({ ...rates, [t]: e.target.value })} />
            </label>
          ))}
        </div>
        <button data-testid="save-rates" className="btn-pink mt-4" onClick={saveRates}>Save Rates</button>
        {msg && <p data-testid="rates-msg" className="text-gold text-sm mt-3">{msg}</p>}
      </div>

      <div className="flex gap-4 mb-6">
        <button data-testid="tab-sessions" className={tab === "sessions" ? "btn-pink" : "btn-outline"} onClick={() => setTab("sessions")}>Session History</button>
        <button data-testid="tab-reviews" className={tab === "reviews" ? "btn-pink" : "btn-outline"} onClick={() => setTab("reviews")}>Reviews</button>
      </div>

      {tab === "sessions" && (
        <div className="card overflow-x-auto" data-testid="session-history">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-white/40 border-b border-white/10">
              <th className="p-3">Client</th><th className="p-3">Type</th><th className="p-3">Date</th><th className="p-3">Duration</th><th className="p-3">You Earned</th>
            </tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-white/5">
                  <td className="p-3">{s.client_label}</td>
                  <td className="p-3 capitalize">{s.type}</td>
                  <td className="p-3 text-white/60">{fmtDate(s.completed_at)}</td>
                  <td className="p-3">{fmtDuration(s.duration)}</td>
                  <td className="p-3 text-gold">{fmt(s.reader_earned)}</td>
                </tr>
              ))}
              {sessions.length === 0 && <tr><td className="p-4 text-white/40" colSpan={5}>No completed sessions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "reviews" && (
        <div className="space-y-3" data-testid="reviews-list">
          {reviews.length === 0 && <p className="text-white/40">No reviews yet.</p>}
          {reviews.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="text-mystic">{r.client_label}</span>
                <Stars value={r.rating} />
                <span className="text-white/30 text-xs ml-auto">{fmtDate(r.completed_at)}</span>
              </div>
              {r.review && <p className="text-white/70 text-sm mt-2">{r.review}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
