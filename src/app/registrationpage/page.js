"use client";
import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { useRouter } from "next/navigation";

// These are the socket refs for the registration page
export default function Home() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
  socketRef.current.on("register success", () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("username", username);
    router.push("/");
  });
  return () => {
    socketRef.current.off("register success");
  };
}, [router, username]);

  const handleSubmit = (e) => {
    e.preventDefault();
    socketRef.current.emit("register", { username, password });
  };
// This is the registration section where you enter credentials
  return (
    <div>
      <h1>Chat Application</h1>
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
        <button type="submit">Register</button>
      </form>
      <button type="button" onClick={() => router.push("/loginpage")}>
        Already have an account? Login
      </button>
    </div>
  );
}