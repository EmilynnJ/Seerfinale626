import axios from "axios";
import { supabase } from "./supabase";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

export const fmtDuration = (secs) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
};
