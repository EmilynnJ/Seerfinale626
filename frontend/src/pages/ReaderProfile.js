import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, api, fmt, fmtDate } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import Stars from "../components/Stars";
import { MessageCircle, Phone, Video } from "lucide-react";

export default function ReaderProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const [reader, setReader] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    axios.get(`${API}/readers/${id}`).then((r) => setReader(r.data)).catch(() => setErr("Reader not found"));
  }, [id]);

  const startReading = async (type) => {
    setErr("");
    if (!profile) return nav("/login");
    setBusy(true);
    try {
      const { data } = await api.post("/readings/request", { reader_id: id, type });
      nav(`/reading/${data.id}`);
    } catch (e) {
      const msg = e.response?.data?.detail || "Could not start reading";
      setErr(msg);
      if (e.response?.status === 402) setTimeout(() => nav("/dashboard"), 1800);
    } finally {
      setBusy(false);
    }
  };

  if (!reader) return <div className="text-center py-20 text-white/50">{err || "Loading..."}</div>;

  const types = [
    { t: "chat", icon: <MessageCircle size={16} />, price: reader.pricing_chat },
    { t: "voice", icon: <Phone size={16} />, price: reader.pricing_voice },
    { t: "video", icon: <Video size={16} />, price: reader.pricing_video },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="card p-8 animate-fade-up">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <img src={reader.profile_image || "https://images.unsplash.com/photo-1515894203077-9cd36032142f?w=300&q=60"}
            alt={reader.full_name} className="w-32 h-32 rounded-full object-cover border-2 border-gold" />
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 data-testid="reader-name" className="text-3xl font-semibold">{reader.full_name}</h1>
              <span className={`text-xs px-2 py-1 rounded-full ${reader.is_online ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/40"}`}>
                {reader.is_online ? "● Online" : "Offline"}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Stars value={reader.avg_rating || 0} size={18} />
              <span className="text-white/60 text-sm">{reader.avg_rating ?? "New"} · {reader.review_count} reviews</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {(reader.specialties || []).map((s) => (
                <span key={s} className="text-xs bg-mystic/15 text-mystic px-2 py-1 rounded-full">{s}</span>
              ))}
            </div>
          </div>
        </div>
        <p data-testid="reader-bio" className="mt-6 text-white/75 leading-relaxed">{reader.bio}</p>

        <div className="grid md:grid-cols-3 gap-4 mt-8">
          {types.map(({ t, icon, price }) => (
            <div key={t} className="border border-white/10 rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-2 capitalize text-white/80">{icon}{t}</div>
              <p className="text-gold text-xl my-2">{price > 0 ? `${fmt(price)}/min` : "N/A"}</p>
              <button data-testid={`start-${t}-btn`} className="btn-pink w-full text-sm"
                disabled={busy || price <= 0 || !reader.is_online}
                onClick={() => startReading(t)}>
                Start {t.charAt(0).toUpperCase() + t.slice(1)} Reading
              </button>
            </div>
          ))}
        </div>
        {err && <p data-testid="start-reading-error" className="text-red-400 mt-4 text-center">{err}</p>}
        {!reader.is_online && <p className="text-white/40 text-sm mt-4 text-center">This reader is currently offline.</p>}
      </div>

      <div className="mt-10">
        <h2 className="font-script text-4xl text-gold mb-4">Recent Reviews</h2>
        {reader.reviews.length === 0 && <p className="text-white/40">No reviews yet.</p>}
        <div className="space-y-4">
          {reader.reviews.map((rv, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="text-mystic font-semibold">{rv.reviewer_name}</span>
                <Stars value={rv.rating} />
                <span className="text-white/30 text-xs ml-auto">{fmtDate(rv.completed_at)}</span>
              </div>
              {rv.review && <p className="text-white/70 mt-2 text-sm">{rv.review}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
