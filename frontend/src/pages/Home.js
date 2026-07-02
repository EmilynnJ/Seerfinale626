import React, { useEffect, useState } from "react";
import axios from "axios";
import { API } from "../lib/api";
import ReaderCard from "../components/ReaderCard";

export default function Home() {
  const [readers, setReaders] = useState([]);
  const [email, setEmail] = useState("");
  const [subMsg, setSubMsg] = useState("");

  useEffect(() => {
    axios.get(`${API}/readers`).then((r) => setReaders(r.data.filter((x) => x.is_online))).catch(() => {});
  }, []);

  const subscribe = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/newsletter`, { email });
      setSubMsg("You're subscribed! ✨");
      setEmail("");
    } catch {
      setSubMsg("Please enter a valid email.");
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4">
      <section className="text-center pt-10 pb-6 animate-fade-up">
        <h1 data-testid="home-title" className="font-script text-7xl md:text-8xl text-mystic drop-shadow-[0_0_25px_rgba(255,105,180,0.4)]">SoulSeer</h1>
        <img src="https://i.postimg.cc/tRLSgCPb/HERO-IMAGE-1.jpg" alt="SoulSeer"
          className="mx-auto mt-6 rounded-2xl max-h-[420px] w-full max-w-3xl object-cover border border-gold/30 shadow-2xl" />
        <p data-testid="home-tagline" className="mt-6 text-2xl md:text-3xl font-serif text-white/90">A Community of Gifted Psychics</p>
      </section>

      <section className="py-10">
        <h2 className="font-script text-4xl text-gold mb-6 text-center">Readers Online Now</h2>
        {readers.length === 0 ? (
          <p data-testid="no-online-readers" className="text-center text-white/50">No readers are online right now. Check back soon, or browse all readers.</p>
        ) : (
          <div data-testid="online-readers-grid" className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {readers.map((r) => <ReaderCard key={r.id} reader={r} />)}
          </div>
        )}
      </section>

      <section className="py-10 max-w-xl mx-auto text-center">
        <h2 className="font-script text-4xl text-mystic mb-4">Join Our Newsletter</h2>
        <form onSubmit={subscribe} className="flex gap-3">
          <input data-testid="newsletter-email" className="input" type="email" required placeholder="Your email address"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <button data-testid="newsletter-submit" className="btn-gold whitespace-nowrap" type="submit">Subscribe</button>
        </form>
        {subMsg && <p data-testid="newsletter-msg" className="mt-3 text-sm text-gold">{subMsg}</p>}
      </section>

      <section className="py-8 text-center flex justify-center gap-4">
        <a data-testid="link-facebook" href="https://www.facebook.com/groups/soulseer" target="_blank" rel="noreferrer" className="btn-outline">Facebook Group</a>
        <a data-testid="link-discord" href="https://discord.gg/soulseer" target="_blank" rel="noreferrer" className="btn-outline">Discord Server</a>
      </section>
    </div>
  );
}
