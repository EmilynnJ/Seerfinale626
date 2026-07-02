import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API } from "../lib/api";
import ReaderCard from "../components/ReaderCard";

export default function Readers() {
  const [readers, setReaders] = useState([]);
  const [specialty, setSpecialty] = useState("");
  const [type, setType] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(false);

  useEffect(() => {
    axios.get(`${API}/readers`).then((r) => setReaders(r.data)).catch(() => {});
  }, []);

  const specialties = useMemo(() => [...new Set(readers.flatMap((r) => r.specialties || []))], [readers]);

  const filtered = readers.filter((r) => {
    if (onlineOnly && !r.is_online) return false;
    if (specialty && !(r.specialties || []).includes(specialty)) return false;
    if (type && !(r[`pricing_${type}`] > 0)) return false;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <h1 className="font-script text-6xl text-mystic text-center mb-8">Browse Readers</h1>
      <div className="flex flex-wrap gap-4 mb-8 justify-center">
        <select data-testid="filter-specialty" className="input max-w-[220px]" value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
          <option value="">All Specialties</option>
          {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select data-testid="filter-type" className="input max-w-[200px]" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All Reading Types</option>
          <option value="chat">Chat</option>
          <option value="voice">Voice</option>
          <option value="video">Video</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input data-testid="filter-online" type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} />
          Online only
        </label>
      </div>
      <div data-testid="readers-grid" className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((r) => <ReaderCard key={r.id} reader={r} />)}
      </div>
      {filtered.length === 0 && <p className="text-center text-white/50 mt-10">No readers match your filters.</p>}
    </div>
  );
}
