import React from "react";

const faqs = [
  ["How do readings work?", "Browse online readers, pick chat, voice, or video, and connect instantly. You're billed per minute from your account balance — the timer starts only when both you and the reader have joined."],
  ["How much does a reading cost?", "Each reader sets their own per-minute rate for chat, voice, and video. The rate is shown on their profile before you start. You need a minimum $5.00 balance to begin a reading."],
  ["How do I add funds?", "Go to your Dashboard and click Add Funds. Payments are securely processed by Stripe. Choose a preset amount ($10, $25, $50, $100) or enter a custom amount (minimum $5)."],
  ["What happens if I get disconnected?", "There's a 2-minute grace period to reconnect. If you rejoin within that window your session continues; otherwise the session ends automatically and billing stops."],
  ["How do I become a reader?", "Reader accounts are created by SoulSeer admins to keep quality high. Reach out through the Community forum or our social channels to apply."],
  ["Can I review my past readings?", "Yes — your Dashboard shows your full reading history including chat transcripts, duration, and cost. You can also leave a star rating and written review after each session."],
  ["Is my payment information safe?", "All payments are handled by Stripe. SoulSeer never stores your card details."],
];

export default function Help() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="font-script text-6xl text-mystic text-center mb-10">Help & FAQ</h1>
      <div className="space-y-4">
        {faqs.map(([q, a], i) => (
          <details key={i} data-testid={`faq-${i}`} className="card p-5 group">
            <summary className="cursor-pointer text-gold font-semibold list-none">{q}</summary>
            <p className="text-white/70 mt-3 text-sm leading-relaxed">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
