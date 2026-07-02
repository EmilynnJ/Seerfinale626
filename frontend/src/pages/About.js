import React from "react";

export default function About() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-up">
      <h1 className="font-script text-6xl text-mystic text-center mb-10">About SoulSeer</h1>
      <img src="https://i.postimg.cc/s2ds9RtC/FOUNDER.jpg" alt="Founder Emilynn"
        className="mx-auto rounded-2xl max-h-[400px] object-cover border border-gold/40 mb-10" />
      <div data-testid="about-content" className="space-y-6 text-lg text-white/80 leading-relaxed">
        <p>
          At SoulSeer, we are dedicated to providing ethical, compassionate, and judgment-free spiritual guidance.
          Our mission is twofold: to offer clients genuine, heart-centered readings and to uphold fair, ethical
          standards for our readers.
        </p>
        <p>
          Founded by psychic medium Emilynn, SoulSeer was created as a response to the corporate greed that
          dominates many psychic platforms. Unlike other apps, our readers keep the majority of what they earn
          and play an active role in shaping the platform.
        </p>
        <p>
          SoulSeer is more than just an app — it's a soul tribe. A community of gifted psychics united by our
          life's calling: to guide, heal, and empower those who seek clarity on their journey.
        </p>
      </div>
    </div>
  );
}
