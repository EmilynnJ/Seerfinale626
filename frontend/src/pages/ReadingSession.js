import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, fmt, fmtDuration } from "../lib/api";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { startRtc } from "../lib/rtc";
import Stars from "../components/Stars";
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Send } from "lucide-react";

export default function ReadingSession() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const [reading, setReading] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("connecting");
  const [tick, setTick] = useState({ billable_seconds: 0, total_charged: 0, client_balance: null });
  const [ended, setEnded] = useState(null);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [rated, setRated] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [mediaErr, setMediaErr] = useState("");
  const wsRef = useRef(null);
  const rtcRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const chatEndRef = useRef(null);

  const isReader = profile && reading && String(profile.id) === String(reading.reader_id);

  const loadReading = useCallback(async () => {
    const { data } = await api.get(`/readings/${id}`);
    setReading(data);
    return data;
  }, [id]);

  useEffect(() => {
    if (!profile) return;
    let ws;
    let cancelled = false;
    let pollTimer;

    const connectWs = async (r) => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const wsUrl = process.env.REACT_APP_BACKEND_URL.replace("https", "wss").replace("http", "ws");
      ws = new WebSocket(`${wsUrl}/api/ws/readings/${id}?token=${token}`);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "chat") setMessages((m) => [...m, msg]);
        else if (msg.type === "session_started") setStatus("live");
        else if (msg.type === "billing_tick") setTick(msg);
        else if (msg.type === "participant_left") setStatus("waiting_reconnect");
        else if (msg.type === "participant_joined") setStatus((s) => (s === "waiting_reconnect" ? "live" : s));
        else if (msg.type === "session_ended") {
          setEnded(msg);
          setStatus("ended");
          rtcRef.current?.stop();
        }
      };
      ws.onclose = () => {};
      if (r.type !== "chat") {
        try {
          const rtc = await startRtc(id, r.type, (event) => {
            const [stream] = event.streams.length ? event.streams : [new MediaStream([event.track])];
            if (event.track.kind === "video" && remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
            if (event.track.kind === "audio" && remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
          });
          rtcRef.current = rtc;
          if (localVideoRef.current && r.type === "video") localVideoRef.current.srcObject = rtc.stream;
        } catch (e) {
          setMediaErr("Could not access microphone/camera. Please allow permissions and refresh.");
        }
      }
    };

    const init = async () => {
      try {
        const r = await loadReading();
        if (cancelled) return;
        if (r.status === "completed" || r.status === "cancelled") {
          setStatus("ended");
          setEnded({ reason: r.end_reason, duration: r.duration, total_charged: r.total_price });
          if (r.rating) setRated(true);
          return;
        }
        if (r.status === "pending") {
          setStatus("pending");
          pollTimer = setInterval(async () => {
            const r2 = await loadReading();
            if (r2.status === "accepted" || r2.status === "in_progress") {
              clearInterval(pollTimer);
              setStatus("connecting");
              await connectWs(r2);
            } else if (r2.status === "cancelled") {
              clearInterval(pollTimer);
              setStatus("ended");
              setEnded({ reason: "declined" });
            }
          }, 3000);
          return;
        }
        await connectWs(r);
      } catch {
        setStatus("error");
      }
    };
    init();
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      wsRef.current?.close();
      rtcRef.current?.stop();
    };
  }, [id, profile, loadReading]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!profile) return <div className="text-center py-20 text-white/50">Please log in.</div>;
  if (!reading) return <div className="text-center py-20 text-white/50">Loading session...</div>;

  const sendChat = (e) => {
    e.preventDefault();
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "chat", text: input }));
    setInput("");
  };

  const endSession = async () => {
    try { await api.post(`/readings/${id}/end`); } catch {}
  };

  const acceptIt = async () => {
    await api.post(`/readings/${id}/accept`);
    window.location.reload();
  };

  const submitRating = async () => {
    await api.post(`/readings/${id}/rate`, { rating, review });
    setRated(true);
  };

  if (status === "ended" || ended) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center animate-fade-up">
        <h1 className="font-script text-5xl text-mystic mb-4">Session Ended</h1>
        <div className="card p-6 space-y-2" data-testid="session-summary">
          <p className="text-white/70">Duration: <span className="text-gold">{fmtDuration(ended?.duration || 0)}</span></p>
          <p className="text-white/70">Total: <span className="text-gold">{fmt(ended?.total_charged || 0)}</span></p>
          {ended?.reason && <p className="text-white/40 text-sm capitalize">Reason: {String(ended.reason).replaceAll("_", " ")}</p>}
        </div>
        {!isReader && !rated && (
          <div className="card p-6 mt-6 space-y-4">
            <h2 className="text-gold text-lg">Rate your reading</h2>
            <div className="flex justify-center"><Stars value={rating} size={28} onChange={setRating} /></div>
            <textarea data-testid="review-input" className="input min-h-[80px]" placeholder="Share your experience (optional)" value={review} onChange={(e) => setReview(e.target.value)} />
            <button data-testid="submit-rating" className="btn-pink w-full" disabled={!rating} onClick={submitRating}>Submit Review</button>
          </div>
        )}
        {rated && <p className="text-gold mt-6" data-testid="rating-thanks">Thank you for your review! ✨</p>}
        <button data-testid="back-dashboard" className="btn-outline mt-8" onClick={() => nav("/dashboard")}>Back to Dashboard</button>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <h1 className="font-script text-5xl text-mystic mb-4">{isReader ? "Incoming Request" : "Requesting Reading..."}</h1>
        <p className="text-white/60 animate-pulse" data-testid="pending-status">
          {isReader ? "A client is waiting for you." : `Waiting for ${reading.reader_name} to accept your ${reading.type} reading...`}
        </p>
        {isReader ? (
          <div className="flex gap-4 justify-center mt-8">
            <button data-testid="accept-reading" className="btn-pink" onClick={acceptIt}>Accept</button>
            <button data-testid="decline-reading" className="btn-outline" onClick={async () => { await api.post(`/readings/${id}/decline`); nav("/dashboard"); }}>Decline</button>
          </div>
        ) : (
          <button data-testid="cancel-request" className="btn-outline mt-8" onClick={async () => { await api.post(`/readings/${id}/cancel`); nav("/readers"); }}>Cancel Request</button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="font-script text-4xl text-mystic capitalize">{reading.type} Reading</h1>
          <p className="text-white/50 text-sm">{isReader ? `Client session` : `with ${reading.reader_name}`} · {fmt(reading.price_per_minute)}/min</p>
        </div>
        <div className="text-right">
          <p data-testid="session-timer" className="text-gold text-2xl font-semibold">{fmtDuration(tick.billable_seconds)}</p>
          <p data-testid="session-cost" className="text-white/50 text-sm">Charged: {fmt(tick.total_charged)}{!isReader && tick.client_balance != null && ` · Balance: ${fmt(tick.client_balance)}`}</p>
        </div>
      </div>

      {status === "connecting" && <p className="text-center text-white/50 animate-pulse mb-4" data-testid="connecting-status">Connecting — session begins when both of you join...</p>}
      {status === "waiting_reconnect" && <p className="text-center text-yellow-400 animate-pulse mb-4" data-testid="reconnect-status">Other participant disconnected — 2 minute grace period active...</p>}
      {mediaErr && <p className="text-center text-red-400 mb-4">{mediaErr}</p>}

      <div className={`grid gap-4 ${reading.type === "chat" ? "" : "lg:grid-cols-3"}`}>
        {reading.type !== "chat" && (
          <div className="lg:col-span-2 space-y-3">
            <div className="card overflow-hidden relative aspect-video bg-black/60">
              {reading.type === "video" ? (
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" data-testid="remote-video" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-24 h-24 rounded-full bg-mystic/20 border-2 border-mystic mx-auto flex items-center justify-center text-4xl">🔮</div>
                    <p className="text-white/60 mt-3">Voice reading in progress</p>
                  </div>
                </div>
              )}
              <audio ref={remoteAudioRef} autoPlay data-testid="remote-audio" />
              {reading.type === "video" && (
                <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-3 right-3 w-32 rounded-lg border border-white/30" data-testid="local-video" />
              )}
            </div>
            <div className="flex justify-center gap-4">
              <button data-testid="toggle-mute" className="btn-outline" onClick={() => setMuted(!rtcRef.current?.toggleAudio())}>
                {muted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              {reading.type === "video" && (
                <button data-testid="toggle-camera" className="btn-outline" onClick={() => setCamOff(!rtcRef.current?.toggleVideo())}>
                  {camOff ? <VideoOff size={18} /> : <VideoIcon size={18} />}
                </button>
              )}
              <button data-testid="end-session" className="bg-red-500 text-white rounded-full px-5 py-2 flex items-center gap-2 hover:bg-red-600" onClick={endSession}>
                <PhoneOff size={18} /> End
              </button>
            </div>
          </div>
        )}

        <div className={`card flex flex-col ${reading.type === "chat" ? "h-[60vh]" : "h-[50vh] lg:h-auto"}`}>
          <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${String(m.sender_id) === String(profile.id) ? "bg-mystic/25 ml-auto" : "bg-white/10"}`}>
                {m.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={sendChat} className="p-3 border-t border-white/10 flex gap-2">
            <input data-testid="chat-input" className="input" placeholder="Type a message..." value={input} onChange={(e) => setInput(e.target.value)} />
            <button data-testid="chat-send" className="btn-pink"><Send size={16} /></button>
          </form>
          {reading.type === "chat" && (
            <div className="p-3 border-t border-white/10">
              <button data-testid="end-session-chat" className="bg-red-500 text-white rounded-full w-full py-2 hover:bg-red-600" onClick={endSession}>End Session</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
