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
  const [users, setUsers] = useState([]); // All users with status
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
    // Tell backend who this socket is
    if (storedUsername) {
      socketRef.current.emit("set username", storedUsername);
    }
    socketRef.current.on("chat message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    // Listen for user status updates
    socketRef.current.on("user status update", (userList) => {
      setUsers(userList);
    });
    // Request user list on connect
    socketRef.current.emit("get users");
    return () => {
      socketRef.current.disconnect();
    };
  }, [router]);

  useEffect(() => {
    if (!socketRef.current || !username) return;
    const interval = setInterval(() => {
      socketRef.current.emit('ping', { username });
    }, 10000); // ping every 10s
    return () => clearInterval(interval);
  }, [username]);

  const handleSend = (e) => {
    e.preventDefault();
    if (input.trim() && socketRef.current) {
      const msg = { user: username || "Anonymous", text: input };
      socketRef.current.emit("chat message", msg);
      setMessages((prev) => [...prev, msg]); //updates chat
      setInput("");
    }
  };

  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "#000000ff", display: "flex", flexDirection: "row", width: "100vw" }}>
      {/* Main chat area, now takes up all space except the right sidebar */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: 0, margin: 0, minHeight: "100vh" }}>
        <div style={{ width: "95%", maxWidth: 900, margin: "2rem 0", padding: 20, border: "1px solid #ccc", borderRadius: 8, background: "#000000ff", minHeight: 600, display: "flex", flexDirection: "column" }}>
          <h2>Chat Room</h2>
          <div style={{ flex: 1, minHeight: 400, maxHeight: "60vh", overflowY: "auto", border: "1px solid #808080ff", marginBottom: 10, padding: 10, background: "#ffffffff" }}>
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
      </div>
      {/* Right sidebar for users and logout button */}
      <div style={{ width: 260, background: "#181818", color: "#fff", padding: 24, borderLeft: "1px solid #333", minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch", position: "relative" }}>
        <div>
          <h3 style={{ marginTop: 0 }}>Users</h3>
          <div style={{ marginBottom: 12 }}>
            <b>Online:</b>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {users.filter(u => u.status === "online").map(u => (
                <li key={u.username} style={{ color: "#20ddff", fontWeight: u.username === username ? "bold" : "normal" }}>{u.username}</li>
              ))}
            </ul>
          </div>
          <div>
            <b>Offline:</b>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {users.filter(u => u.status !== "online").map(u => (
                <li key={u.username} style={{ color: "#888" }}>{u.username}</li>
              ))}
            </ul>
          </div>
        </div>
        <div style={{ width: "100%", display: "flex", justifyContent: "flex-end", alignItems: "flex-end" }}>
          <button
            onClick={handleLogout}
            style={{
              pointerEvents: "auto",
              padding: "12px 32px",
              background: "#20ddffff",
              color: "#000000ff",
              border: "none",
              borderRadius: 24,
              fontSize: 18,
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              cursor: "pointer",
              marginTop: 32,
              marginBottom: 8
            }}
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
