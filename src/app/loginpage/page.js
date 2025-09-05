//login page that also handles registration
"use client";
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { useRouter } from "next/navigation";

export default function Home() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const socketRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    socketRef.current = io("http://localhost:3001");
    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socketRef.current) return;
    socketRef.current.on("login success", () => {
      localStorage.setItem("loggedIn", "true");
      localStorage.setItem("username", username);
      router.push("/");
    });
    socketRef.current.on("login error", (data) => {
      setError(data.message);
    });
    return () => {
      socketRef.current.off("login success");
      socketRef.current.off("login error");
    };
  }, [router, username]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    socketRef.current.emit("login", { username, password });
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#000000ff"
    }}>
      <div style={{
        background: "#000",
        border: "2px solid #fff",
        padding: 40,
        borderRadius: 16,
        boxShadow: "0 2px 16px rgba(0,0,0,0.12)",
        minWidth: 340,
        display: "flex",
        flexDirection: "column",
        alignItems: "center"
      }}>
        <h1
          style={{
            color: "#20ddff",
            marginBottom: 24,
            fontFamily: 'Segoe UI, Arial, Helvetica, sans-serif',
            fontWeight: 900,
            fontSize: 28,
            letterSpacing: 2,
            textShadow: "0 2px 8px rgba(32,221,255,0.18)"
          }}
        >
          Login
        </h1>
        <form onSubmit={handleSubmit} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ padding: 12, borderRadius: 8, border: "1px solid #ccc", fontSize: 16 }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: 12, borderRadius: 8, border: "1px solid #ccc", fontSize: 16 }}
          />
          <button type="submit" style={{
            padding: "12px 0",
            background: "#20ddff",
            color: "#000",
            border: "none",
            borderRadius: 8,
            fontWeight: "bold",
            fontSize: 18,
            marginTop: 8,
            cursor: "pointer"
          }}>Login</button>
        </form>
        {error && <div style={{ color: "red", marginTop: 12 }}>{error}</div>}
        <button
          type="button"
          onClick={() => router.push("/registrationpage")}
          style={{
            marginTop: 24,
            background: "#000000ff",
            color: "#20ddff",
            border: "none",
            borderRadius: 8,
            padding: "10px 24px",
            fontWeight: "bold",
            fontSize: 16,
            cursor: "pointer"
          }}
        >
          Register
        </button>
      </div>
    </div>
  );
}