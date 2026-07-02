import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { API, api, fmtDate } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Flag, ArrowLeft } from "lucide-react";

export default function Community() {
  const { profile } = useAuth();
  const [posts, setPosts] = useState([]);
  const [active, setActive] = useState(null);
  const [form, setForm] = useState({ title: "", content: "" });
  const [comment, setComment] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    axios.get(`${API}/forum/posts`).then((r) => setPosts(r.data)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openPost = async (id) => {
    const { data } = await axios.get(`${API}/forum/posts/${id}`);
    setActive(data);
  };

  const createPost = async (e) => {
    e.preventDefault();
    try {
      await api.post("/forum/posts", form);
      setForm({ title: "", content: "" });
      setShowNew(false);
      load();
    } catch (e2) {
      setMsg(e2.response?.data?.detail || "Login required to post");
    }
  };

  const addComment = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/forum/posts/${active.id}/comments`, { content: comment });
      setComment("");
      openPost(active.id);
    } catch (e2) {
      setMsg(e2.response?.data?.detail || "Login required to comment");
    }
  };

  const flag = async (type, id) => {
    try {
      await api.post("/forum/flag", { target_type: type, target_id: id, reason: "Flagged by user" });
      setMsg("Reported to moderators. Thank you.");
    } catch {
      setMsg("Login required to report content");
    }
  };

  if (active) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <button data-testid="back-to-forum" className="text-mystic flex items-center gap-1 mb-6" onClick={() => setActive(null)}>
          <ArrowLeft size={16} /> Back to Community
        </button>
        <div className="card p-6">
          <div className="flex items-start justify-between">
            <h1 data-testid="post-title" className="text-2xl font-semibold">{active.title}</h1>
            <button data-testid="flag-post" title="Report" onClick={() => flag("post", active.id)} className="text-white/40 hover:text-red-400"><Flag size={16} /></button>
          </div>
          <p className="text-sm text-mystic mt-1">{active.author_name} {active.author_role === "reader" && "✦"} · {fmtDate(active.created_at)}</p>
          <p className="text-white/80 mt-4 whitespace-pre-wrap">{active.content}</p>
        </div>
        <h2 className="text-gold text-lg mt-8 mb-3">{active.comments.length} Comments</h2>
        <div className="space-y-3">
          {active.comments.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex justify-between">
                <p className="text-sm text-mystic">{c.author_name} {c.author_role === "reader" && "✦"} · {fmtDate(c.created_at)}</p>
                <button data-testid={`flag-comment-${c.id}`} onClick={() => flag("comment", c.id)} className="text-white/30 hover:text-red-400"><Flag size={14} /></button>
              </div>
              <p className="text-white/75 mt-1 text-sm whitespace-pre-wrap">{c.content}</p>
            </div>
          ))}
        </div>
        {profile ? (
          <form onSubmit={addComment} className="mt-6 flex gap-3">
            <input data-testid="comment-input" className="input" placeholder="Add a comment..." required value={comment} onChange={(e) => setComment(e.target.value)} />
            <button data-testid="comment-submit" className="btn-pink">Reply</button>
          </form>
        ) : (
          <p className="text-white/40 mt-6 text-sm">Log in to join the conversation.</p>
        )}
        {msg && <p className="text-gold text-sm mt-3">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="font-script text-6xl text-mystic text-center mb-8">Community Hub</h1>
      <div className="flex justify-end mb-6">
        {profile && (
          <button data-testid="new-post-btn" className="btn-pink" onClick={() => setShowNew(!showNew)}>
            {showNew ? "Cancel" : "New Post"}
          </button>
        )}
      </div>
      {showNew && (
        <form onSubmit={createPost} className="card p-6 mb-8 space-y-3">
          <input data-testid="post-title-input" className="input" placeholder="Post title" required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea data-testid="post-content-input" className="input min-h-[120px]" placeholder="Share your thoughts..." required value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          <button data-testid="post-submit" className="btn-gold">Publish</button>
        </form>
      )}
      {msg && <p className="text-gold text-sm mb-4">{msg}</p>}
      <div className="space-y-4">
        {posts.map((p) => (
          <button key={p.id} data-testid={`forum-post-${p.id}`} onClick={() => openPost(p.id)}
            className="card p-5 w-full text-left hover:border-mystic/40 transition-colors block">
            <h3 className="text-lg font-semibold">{p.title}</h3>
            <p className="text-sm text-white/50 mt-1 line-clamp-2">{p.content}</p>
            <p className="text-xs text-mystic mt-2">{p.author_name} {p.author_role === "reader" && "✦"} · {fmtDate(p.created_at)} · {p.comment_count} comments</p>
          </button>
        ))}
        {posts.length === 0 && <p className="text-center text-white/40">No posts yet. Be the first to share!</p>}
      </div>
    </div>
  );
}
