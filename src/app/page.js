"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";

export default function Home() {
  const router = useRouter();
  const socketRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [username, setUsername] = useState("");
  const handleLogout = () => {
  localStorage.removeItem("loggedIn");
  localStorage.removeItem("username");
  router.push("/loginpage");
};

  useEffect(() => {
    const loggedIn = localStorage.getItem("loggedIn");
    const storedUsername = localStorage.getItem("username");
    if (!loggedIn) {
      router.push("/loginpage");
      return;
    }
    setUsername(storedUsername || "");
    socketRef.current = io("http://localhost:3001");
    socketRef.current.on("chat message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    // Optionally, load chat history if your backend supports it
    return () => {
      socketRef.current.disconnect();
    };
  }, [router]);

  const handleSend = (e) => {
    e.preventDefault();
    if (input.trim() && socketRef.current) {
      const msg = { user: username || "Anonymous", text: input };
      socketRef.current.emit("chat message", msg);
      setMessages((prev) => [...prev, msg]); // Optimistic update
      setInput("");
    }
  };

  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "#000000ff" }}>
      <div style={{ maxWidth: 500, margin: "2rem auto", padding: 20, border: "1px solid #ccc", borderRadius: 8, background: "#000000ff" }}>
        <h2>Chat Room</h2>
        <div style={{ height: 300, overflowY: "auto", border: "1px solid #808080ff", marginBottom: 10, padding: 10, background: "#ffffffff" }}>
          {messages.length === 0 ? (
            <div style={{ color: "#000000ff" }}>No messages yet.</div>
          ) : ( 
            messages.map((msg, idx) => (
              <div key={idx} style={{ marginBottom: 6 }}>
                <b>{msg.user}:</b> {msg.text}
              </div>
            ))
          )}
        </div>
        <form onSubmit={handleSend} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            style={{ flex: 1, padding: 8 }}
          />
          <button type="submit" style={{ padding: "8px 16px" }}>Send</button>
        </form>
      </div>
      {/* Logout button fixed at the bottom center */}
      <div style={{ position: "fixed", left: 0, bottom: 30, width: "100%", display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <button
          onClick={handleLogout}
          style={{
            pointerEvents: "auto",
            padding: "12px 32px",
            background: "#20ddffff",
            color: "#000000ff",
            border: "none",
            borderRadius: 24,
            fontWeight: "bold",
            fontSize: 18,
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            cursor: "pointer"
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}