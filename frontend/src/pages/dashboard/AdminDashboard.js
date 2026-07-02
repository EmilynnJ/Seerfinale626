import React, { useEffect, useState, useCallback } from "react";
import { api, fmt, fmtDate, fmtDuration } from "../../lib/api";

const TABS = ["Users", "Create Reader", "Readings", "Transactions", "Moderation"];

export default function AdminDashboard() {
  const [tab, setTab] = useState("Users");
  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <h1 className="font-script text-6xl text-mystic mb-8">Admin Control Hub</h1>
      <div className="flex flex-wrap gap-3 mb-8">
        {TABS.map((t) => (
          <button key={t} data-testid={`admin-tab-${t.toLowerCase().replace(" ", "-")}`}
            className={tab === t ? "btn-pink text-sm" : "btn-outline text-sm"} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "Users" && <UsersTab />}
      {tab === "Create Reader" && <CreateReaderTab />}
      {tab === "Readings" && <ReadingsTab />}
      {tab === "Transactions" && <TransactionsTab />}
      {tab === "Moderation" && <ModerationTab />}
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [adjust, setAdjust] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async (s = "") => {
    const { data } = await api.get("/admin/users", { params: { search: s } });
    setUsers(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const doAdjust = async () => {
    setMsg("");
    try {
      await api.post("/admin/balance-adjust", { user_id: adjust.id, amount: Math.round(parseFloat(amount) * 100), note });
      setMsg(`Balance updated for ${adjust.username}`);
      setAdjust(null); setAmount(""); setNote("");
      load(search);
    } catch (e) { setMsg(e.response?.data?.detail || "Adjustment failed"); }
  };

  const payout = async (u) => {
    setMsg("");
    try {
      const { data } = await api.post("/admin/payouts", { reader_id: u.id, note: "Manual payout" });
      setMsg(`Paid out ${fmt(data.paid_out)} to ${u.username}`);
      load(search);
    } catch (e) { setMsg(e.response?.data?.detail || "Payout failed"); }
  };

  return (
    <div>
      <div className="flex gap-3 mb-4 max-w-md">
        <input data-testid="user-search" className="input" placeholder="Search users..." value={search}
          onChange={(e) => { setSearch(e.target.value); load(e.target.value); }} />
      </div>
      {msg && <p data-testid="users-msg" className="text-gold text-sm mb-3">{msg}</p>}
      <div className="card overflow-x-auto" data-testid="admin-users-table">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-white/40 border-b border-white/10">
            <th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Balance</th><th className="p-3">Earnings</th><th className="p-3">Actions</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-white/5">
                <td className="p-3"><div>{u.full_name || u.username}</div><div className="text-white/40 text-xs">{u.email}</div></td>
                <td className="p-3 capitalize">{u.role}{u.is_online && u.role === "reader" && <span className="text-green-400 ml-1">●</span>}</td>
                <td className="p-3 text-gold">{fmt(u.account_balance)}</td>
                <td className="p-3 text-gold">{u.role === "reader" ? fmt(u.earnings_balance) : "—"}</td>
                <td className="p-3 flex gap-2 flex-wrap">
                  <button data-testid={`adjust-${u.username}`} className="btn-outline text-xs" onClick={() => setAdjust(u)}>Adjust Balance</button>
                  {u.role === "reader" && (
                    <>
                      <button data-testid={`edit-${u.username}`} className="btn-outline text-xs" onClick={() => setEdit(u)}>Edit</button>
                      <button data-testid={`payout-${u.username}`} className="btn-outline text-xs" onClick={() => payout(u)}>Payout</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adjust && (
        <div className="card p-6 mt-6 max-w-md" data-testid="adjust-panel">
          <h3 className="text-gold mb-3">Adjust balance — {adjust.username} (current {fmt(adjust.account_balance)})</h3>
          <input data-testid="adjust-amount" className="input mb-3" type="number" step="0.01" placeholder="Amount in $ (negative to deduct)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input data-testid="adjust-note" className="input mb-3" placeholder="Reason (required)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-3">
            <button data-testid="adjust-submit" className="btn-pink" disabled={!amount || note.length < 3} onClick={doAdjust}>Apply</button>
            <button className="btn-outline" onClick={() => setAdjust(null)}>Cancel</button>
          </div>
        </div>
      )}

      {edit && <EditReaderPanel reader={edit} onDone={() => { setEdit(null); load(search); }} />}
    </div>
  );
}

function ReaderForm({ initial, onSubmit, submitLabel, result }) {
  const [f, setF] = useState(initial);
  const [image, setImage] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="card p-6 space-y-3 max-w-2xl" onSubmit={(e) => { e.preventDefault(); onSubmit(f, image); }}>
      <div className="grid md:grid-cols-2 gap-3">
        <input data-testid="reader-fullname" className="input" placeholder="Full name" required={!initial.isEdit} value={f.full_name} onChange={set("full_name")} />
        <input data-testid="reader-username" className="input" placeholder="Username" required={!initial.isEdit} value={f.username} onChange={set("username")} />
        {!initial.isEdit && <input data-testid="reader-email" className="input" type="email" placeholder="Email" required value={f.email} onChange={set("email")} />}
        <input data-testid="reader-specialties" className="input" placeholder="Specialties (comma-separated)" value={f.specialties} onChange={set("specialties")} />
      </div>
      <textarea data-testid="reader-bio" className="input min-h-[80px]" placeholder="Bio" value={f.bio} onChange={set("bio")} />
      <div className="grid grid-cols-3 gap-3">
        {["chat", "voice", "video"].map((t) => (
          <label key={t} className="text-xs text-white/50 capitalize">{t} $/min
            <input data-testid={`reader-rate-${t}`} className="input mt-1" type="number" min="0" step="0.01" value={f[`rate_${t}`]} onChange={set(`rate_${t}`)} />
          </label>
        ))}
      </div>
      <label className="text-xs text-white/50 block">Profile image
        <input data-testid="reader-image" className="input mt-1" type="file" accept="image/*" onChange={(e) => setImage(e.target.files[0])} />
      </label>
      <button data-testid="reader-form-submit" className="btn-pink">{submitLabel}</button>
      {result && <p data-testid="reader-form-result" className="text-gold text-sm whitespace-pre-wrap">{result}</p>}
    </form>
  );
}

function buildFormData(f, image, isEdit) {
  const fd = new FormData();
  if (!isEdit) fd.append("email", f.email);
  if (f.full_name) fd.append("full_name", f.full_name);
  if (f.username) fd.append("username", f.username);
  fd.append("bio", f.bio || "");
  fd.append("specialties", f.specialties || "");
  fd.append("pricing_chat", Math.round(parseFloat(f.rate_chat || 0) * 100));
  fd.append("pricing_voice", Math.round(parseFloat(f.rate_voice || 0) * 100));
  fd.append("pricing_video", Math.round(parseFloat(f.rate_video || 0) * 100));
  if (image) fd.append("image", image);
  return fd;
}

function CreateReaderTab() {
  const [result, setResult] = useState("");
  const submit = async (f, image) => {
    setResult("");
    try {
      const { data } = await api.post("/admin/readers", buildFormData(f, image, false));
      setResult(`Reader created!\nEmail: ${data.email}\nInitial password: ${data.initial_password}\nShare these credentials securely with the reader.`);
    } catch (e) { setResult(e.response?.data?.detail || "Creation failed"); }
  };
  return <ReaderForm initial={{ email: "", full_name: "", username: "", bio: "", specialties: "", rate_chat: "1.99", rate_voice: "2.99", rate_video: "3.99" }}
    onSubmit={submit} submitLabel="Create Reader" result={result} />;
}

function EditReaderPanel({ reader, onDone }) {
  const [result, setResult] = useState("");
  const submit = async (f, image) => {
    setResult("");
    try {
      await api.patch(`/admin/readers/${reader.id}`, buildFormData(f, image, true));
      setResult("Reader updated.");
      setTimeout(onDone, 800);
    } catch (e) { setResult(e.response?.data?.detail || "Update failed"); }
  };
  return (
    <div className="mt-6">
      <h3 className="text-gold mb-3">Editing {reader.username}</h3>
      <ReaderForm initial={{ isEdit: true, full_name: reader.full_name || "", username: reader.username || "", bio: "", specialties: "", rate_chat: "", rate_voice: "", rate_video: "" }}
        onSubmit={submit} submitLabel="Save Changes" result={result} />
      <button className="btn-outline mt-3" onClick={onDone}>Close</button>
    </div>
  );
}

function ReadingsTab() {
  const [data, setData] = useState({ readings: [], commission_pct: 60 });
  const [search, setSearch] = useState("");
  const load = useCallback(async (s = "") => {
    const { data: d } = await api.get("/admin/readings", { params: { search: s } });
    setData(d);
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <input data-testid="readings-search" className="input max-w-md" placeholder="Search readings..." value={search}
          onChange={(e) => { setSearch(e.target.value); load(e.target.value); }} />
        <span className="text-white/40 text-sm">Commission split: reader {data.commission_pct}% / platform {100 - data.commission_pct}%</span>
      </div>
      <div className="card overflow-x-auto" data-testid="admin-readings-table">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-white/40 border-b border-white/10">
            <th className="p-3">Reader</th><th className="p-3">Client</th><th className="p-3">Type</th><th className="p-3">Status</th><th className="p-3">Duration</th><th className="p-3">Total</th><th className="p-3">Reader Cut</th><th className="p-3">Platform</th>
          </tr></thead>
          <tbody>
            {data.readings.map((r) => (
              <tr key={r.id} className="border-b border-white/5">
                <td className="p-3">{r.reader_name}</td>
                <td className="p-3">{r.client_username}</td>
                <td className="p-3 capitalize">{r.type}</td>
                <td className="p-3 capitalize">{r.status.replaceAll("_", " ")}</td>
                <td className="p-3">{fmtDuration(r.duration)}</td>
                <td className="p-3 text-gold">{fmt(r.total_price)}</td>
                <td className="p-3">{fmt(r.reader_earned)}</td>
                <td className="p-3">{fmt(r.platform_revenue)}</td>
              </tr>
            ))}
            {data.readings.length === 0 && <tr><td className="p-4 text-white/40" colSpan={8}>No readings found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionsTab() {
  const [txs, setTxs] = useState([]);
  useEffect(() => { api.get("/admin/transactions").then((r) => setTxs(r.data)); }, []);
  return (
    <div className="card overflow-x-auto" data-testid="admin-tx-table">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-white/40 border-b border-white/10">
          <th className="p-3">Date</th><th className="p-3">User</th><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Balance After</th><th className="p-3">Note</th>
        </tr></thead>
        <tbody>
          {txs.map((t) => (
            <tr key={t.id} className="border-b border-white/5">
              <td className="p-3 text-white/60">{fmtDate(t.created_at)}</td>
              <td className="p-3">{t.username}</td>
              <td className="p-3 capitalize">{t.type.replaceAll("_", " ")}</td>
              <td className={`p-3 ${t.amount >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(t.amount)}</td>
              <td className="p-3 text-gold">{fmt(t.balance_after)}</td>
              <td className="p-3 text-white/50">{t.note}</td>
            </tr>
          ))}
          {txs.length === 0 && <tr><td className="p-4 text-white/40" colSpan={6}>No transactions yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ModerationTab() {
  const [flags, setFlags] = useState([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const { data } = await api.get("/admin/forum/flagged");
    setFlags(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const del = async (f) => {
    await api.delete(`/admin/forum/${f.target_type}/${f.target_id}`);
    setMsg("Content deleted and flag resolved.");
    load();
  };
  const dismiss = async (f) => {
    setMsg("Flag left open — content preserved.");
  };

  return (
    <div data-testid="moderation-queue">
      {msg && <p className="text-gold text-sm mb-3">{msg}</p>}
      {flags.length === 0 && <p className="text-white/40">No flagged content. The community is at peace. ✨</p>}
      <div className="space-y-4">
        {flags.map((f) => (
          <div key={f.id} className="card p-5">
            <p className="text-white/40 text-xs mb-2 capitalize">Flagged {f.target_type} · by {f.flagger_name || "unknown"} · {fmtDate(f.created_at)} · Reason: {f.reason || "—"}</p>
            {f.target ? (
              <div className="bg-cosmos rounded-lg p-3 text-sm text-white/80">
                {f.target.title && <p className="font-semibold">{f.target.title}</p>}
                <p>{f.target.content}</p>
                {f.target.is_deleted && <p className="text-red-400 text-xs mt-1">Already deleted</p>}
              </div>
            ) : <p className="text-white/30 text-sm">Content not found.</p>}
            <div className="flex gap-3 mt-3">
              <button data-testid={`delete-flag-${f.id}`} className="bg-red-500 text-white rounded-full px-4 py-1.5 text-sm hover:bg-red-600" onClick={() => del(f)}>Delete Content</button>
              <button className="btn-outline text-sm" onClick={() => dismiss(f)}>Keep</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
