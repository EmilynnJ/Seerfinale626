import React, { useEffect, useState, useCallback } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { api, fmt, fmtDate, fmtDuration } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import Stars from "../../components/Stars";

export default function ClientDashboard() {
  const { profile, refreshProfile } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [readings, setReadings] = useState([]);
  const [txs, setTxs] = useState([]);
  const [active, setActive] = useState([]);
  const [showFunds, setShowFunds] = useState(false);
  const [custom, setCustom] = useState("");
  const [payMsg, setPayMsg] = useState("");
  const [tab, setTab] = useState("readings");

  const load = useCallback(async () => {
    const [r, t, a] = await Promise.all([
      api.get("/me/readings"), api.get("/me/transactions"), api.get("/readings/active"),
    ]);
    setReadings(r.data);
    setTxs(t.data);
    setActive(a.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const sessionId = params.get("session_id");
    if (!sessionId) return;
    let attempts = 0;
    setPayMsg("Checking payment status...");
    const poll = async () => {
      if (attempts++ > 6) { setPayMsg("Payment check timed out — refresh to see your balance."); return; }
      try {
        const { data } = await api.get(`/payments/status/${sessionId}`);
        if (data.payment_status === "paid") {
          setPayMsg("Payment successful! Funds added. ✨");
          await refreshProfile();
          await load();
          window.history.replaceState({}, "", "/dashboard");
          return;
        }
        if (data.status === "expired") { setPayMsg("Payment session expired. Please try again."); return; }
        setTimeout(poll, 2000);
      } catch { setPayMsg("Error checking payment."); }
    };
    poll();
  }, [params, refreshProfile, load]);

  const checkout = async (packageId, customAmount) => {
    setPayMsg("");
    try {
      const { data } = await api.post("/payments/checkout", {
        package_id: packageId || null,
        custom_amount: customAmount ? parseFloat(customAmount) : null,
        origin_url: window.location.origin,
      });
      window.location.href = data.url;
    } catch (e) {
      setPayMsg(e.response?.data?.detail || "Could not start checkout");
    }
  };

  const completed = readings.filter((r) => r.status === "completed");

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="font-script text-6xl text-mystic mb-8">Welcome, {profile.full_name || profile.username}</h1>

      <div className="card p-6 flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <p className="text-white/50 text-sm">Account Balance</p>
          <p data-testid="account-balance" className="text-4xl text-gold font-semibold">{fmt(profile.account_balance)}</p>
        </div>
        <button data-testid="add-funds-btn" className="btn-pink" onClick={() => setShowFunds(!showFunds)}>Add Funds</button>
      </div>

      {showFunds && (
        <div className="card p-6 mb-8" data-testid="add-funds-panel">
          <h2 className="text-gold text-lg mb-4">Add Funds (via Stripe)</h2>
          <div className="flex flex-wrap gap-3 mb-4">
            {[["p10", "$10"], ["p25", "$25"], ["p50", "$50"], ["p100", "$100"]].map(([id, label]) => (
              <button key={id} data-testid={`fund-${id}`} className="btn-outline" onClick={() => checkout(id)}>{label}</button>
            ))}
          </div>
          <div className="flex gap-3 max-w-sm">
            <input data-testid="fund-custom-input" className="input" type="number" min="5" step="0.01" placeholder="Custom amount (min $5)" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button data-testid="fund-custom-btn" className="btn-gold" onClick={() => checkout(null, custom)}>Pay</button>
          </div>
        </div>
      )}
      {payMsg && <p data-testid="payment-msg" className="text-gold mb-6">{payMsg}</p>}

      {active.length > 0 && (
        <div className="card p-6 mb-8 border-mystic/50">
          <h2 className="text-mystic text-lg mb-3">Active / Upcoming Readings</h2>
          {active.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
              <span className="capitalize text-white/80">{r.type} with {r.reader_name} · <span className="text-gold">{r.status.replaceAll("_", " ")}</span></span>
              <button data-testid={`rejoin-${r.id}`} className="btn-pink text-sm" onClick={() => nav(`/reading/${r.id}`)}>Open</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4 mb-6">
        <button data-testid="tab-readings" className={tab === "readings" ? "btn-pink" : "btn-outline"} onClick={() => setTab("readings")}>Reading History</button>
        <button data-testid="tab-transactions" className={tab === "transactions" ? "btn-pink" : "btn-outline"} onClick={() => setTab("transactions")}>Transactions</button>
      </div>

      {tab === "readings" && (
        <div className="space-y-3" data-testid="reading-history">
          {completed.length === 0 && <p className="text-white/40">No completed readings yet. <Link className="text-mystic" to="/readers">Browse readers</Link></p>}
          {completed.map((r) => (
            <div key={r.id} className="card p-4 flex flex-wrap items-center gap-4 justify-between">
              <div>
                <p className="font-semibold">{r.reader_name} <span className="text-white/40 capitalize text-sm">· {r.type}</span></p>
                <p className="text-white/40 text-xs">{fmtDate(r.completed_at)} · {fmtDuration(r.duration)} · {fmt(r.total_price)}</p>
              </div>
              <div className="flex items-center gap-3">
                {r.rating ? <Stars value={r.rating} /> : <button data-testid={`rate-${r.id}`} className="btn-outline text-xs" onClick={() => nav(`/reading/${r.id}`)}>Leave Review</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "transactions" && (
        <div className="card overflow-x-auto" data-testid="transaction-history">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-white/40 border-b border-white/10">
              <th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Balance</th><th className="p-3">Note</th>
            </tr></thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className="border-b border-white/5">
                  <td className="p-3 text-white/60">{fmtDate(t.created_at)}</td>
                  <td className="p-3 capitalize">{t.type.replaceAll("_", " ")}</td>
                  <td className={`p-3 ${t.amount >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(t.amount)}</td>
                  <td className="p-3 text-gold">{fmt(t.balance_after)}</td>
                  <td className="p-3 text-white/50">{t.note}</td>
                </tr>
              ))}
              {txs.length === 0 && <tr><td className="p-4 text-white/40" colSpan={5}>No transactions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
