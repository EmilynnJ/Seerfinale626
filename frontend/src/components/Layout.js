import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Menu, X } from "lucide-react";

const links = [
  { to: "/", label: "Home" },
  { to: "/readers", label: "Readers" },
  { to: "/community", label: "Community" },
  { to: "/about", label: "About" },
  { to: "/help", label: "Help" },
];

export default function Layout({ children }) {
  const { profile, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <header className="border-b border-white/10 bg-cosmos/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" data-testid="nav-logo" className="font-script text-4xl text-mystic">SoulSeer</Link>
          <nav className="hidden md:flex items-center gap-6">
            {links.map((l) => (
              <Link key={l.to} to={l.to} data-testid={`nav-${l.label.toLowerCase()}`}
                className={`text-sm hover:text-mystic transition-colors ${loc.pathname === l.to ? "text-mystic" : "text-white/80"}`}>
                {l.label}
              </Link>
            ))}
            {profile ? (
              <>
                <Link to="/dashboard" data-testid="nav-dashboard" className="text-sm text-gold hover:text-mystic">Dashboard</Link>
                <button data-testid="nav-logout" onClick={async () => { await logout(); nav("/"); }} className="btn-outline text-sm">Log Out</button>
              </>
            ) : (
              <Link to="/login" data-testid="nav-login" className="btn-pink text-sm">Login / Sign Up</Link>
            )}
          </nav>
          <button className="md:hidden text-white" data-testid="nav-mobile-toggle" onClick={() => setOpen(!open)}>
            {open ? <X /> : <Menu />}
          </button>
        </div>
        {open && (
          <div className="md:hidden px-4 pb-4 flex flex-col gap-3">
            {links.map((l) => (
              <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="text-white/80">{l.label}</Link>
            ))}
            {profile ? (
              <>
                <Link to="/dashboard" onClick={() => setOpen(false)} className="text-gold">Dashboard</Link>
                <button onClick={async () => { await logout(); setOpen(false); nav("/"); }} className="text-mystic text-left">Log Out</button>
              </>
            ) : (
              <Link to="/login" onClick={() => setOpen(false)} className="text-mystic">Login / Sign Up</Link>
            )}
          </div>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/10 py-8 mt-16">
        <div className="max-w-6xl mx-auto px-4 text-center text-white/40 text-sm">
          <p className="font-script text-2xl text-mystic mb-2">SoulSeer</p>
          <p>A Community of Gifted Psychics · © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
