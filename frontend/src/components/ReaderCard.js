import React from "react";
import { Link } from "react-router-dom";
import Stars from "./Stars";
import { fmt } from "../lib/api";
import { MessageCircle, Phone, Video } from "lucide-react";

export default function ReaderCard({ reader }) {
  const types = [
    { key: "pricing_chat", icon: <MessageCircle size={13} />, label: "Chat" },
    { key: "pricing_voice", icon: <Phone size={13} />, label: "Voice" },
    { key: "pricing_video", icon: <Video size={13} />, label: "Video" },
  ];
  return (
    <div data-testid={`reader-card-${reader.username}`} className="card p-5 flex flex-col gap-3 animate-fade-up hover:border-mystic/50 transition-colors">
      <div className="flex items-center gap-4">
        <img src={reader.profile_image || "https://images.unsplash.com/photo-1515894203077-9cd36032142f?w=200&q=60"}
          alt={reader.full_name} className="w-16 h-16 rounded-full object-cover border-2 border-gold/60" />
        <div className="flex-1">
          <h3 className="text-lg font-semibold">{reader.full_name}</h3>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Stars value={reader.avg_rating || 0} />
            <span>{reader.review_count ? `(${reader.review_count})` : "New"}</span>
          </div>
        </div>
        <span data-testid="online-badge" className={`text-xs px-2 py-1 rounded-full ${reader.is_online ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/40"}`}>
          {reader.is_online ? "● Online" : "Offline"}
        </span>
      </div>
      {reader.bio && <p className="text-sm text-white/60 line-clamp-2">{reader.bio}</p>}
      <div className="flex flex-wrap gap-1.5">
        {(reader.specialties || []).map((s) => (
          <span key={s} className="text-xs bg-mystic/15 text-mystic px-2 py-0.5 rounded-full">{s}</span>
        ))}
      </div>
      <div className="flex gap-3 text-xs text-white/70">
        {types.filter((t) => reader[t.key] > 0).map((t) => (
          <span key={t.key} className="flex items-center gap-1">{t.icon}{fmt(reader[t.key])}/min</span>
        ))}
      </div>
      <Link to={`/readers/${reader.id}`} data-testid={`view-reader-${reader.username}`} className="btn-pink text-center text-sm mt-auto">
        Start Reading
      </Link>
    </div>
  );
}
