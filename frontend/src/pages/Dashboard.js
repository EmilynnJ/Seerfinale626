import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ClientDashboard from "./dashboard/ClientDashboard";
import ReaderDashboard from "./dashboard/ReaderDashboard";
import AdminDashboard from "./dashboard/AdminDashboard";

export default function Dashboard() {
  const { profile, loading } = useAuth();
  if (loading) return <div className="text-center py-20 text-white/50">Loading...</div>;
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.role === "admin") return <AdminDashboard />;
  if (profile.role === "reader") return <ReaderDashboard />;
  return <ClientDashboard />;
}
