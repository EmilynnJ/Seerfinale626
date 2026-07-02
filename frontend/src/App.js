import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Readers from "./pages/Readers";
import ReaderProfile from "./pages/ReaderProfile";
import About from "./pages/About";
import Community from "./pages/Community";
import Login from "./pages/Login";
import Help from "./pages/Help";
import Dashboard from "./pages/Dashboard";
import ReadingSession from "./pages/ReadingSession";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="starfield" />
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/readers" element={<Readers />} />
            <Route path="/readers/:id" element={<ReaderProfile />} />
            <Route path="/about" element={<About />} />
            <Route path="/community" element={<Community />} />
            <Route path="/login" element={<Login />} />
            <Route path="/help" element={<Help />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reading/:id" element={<ReadingSession />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  );
}
