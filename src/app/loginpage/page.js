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
    <div>
      <h1>Login</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit">Login</button>
      </form>
      {error && <div style={{ color: "red" }}>{error}</div>}
      <button type="button" onClick={() => router.push("/registrationpage")}>Register</button>
    </div>
  );
}