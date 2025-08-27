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
  const [rooms, setRooms] = useState([]); // All chat rooms
  const [activeRoom, setActiveRoom] = useState(null); // Currently active room
  const [pendingRoomName, setPendingRoomName] = useState(null);

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
    // Listen for rooms update
    socketRef.current.on("rooms update", (roomList) => {
      setRooms(roomList);
      if (pendingRoomName) {
        const newRoom = roomList.find(r => r.name === pendingRoomName);
        if (newRoom) {
          setActiveRoom(newRoom.roomId);
          setPendingRoomName(null);
        }
      }
    });
    // Request user list and rooms on connect
    socketRef.current.emit("get users");
    socketRef.current.emit("get rooms");
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
      const msg = { user: username || "Anonymous", text: input, roomId: activeRoom };
      socketRef.current.emit("chat message", msg);
      setMessages((prev) => [...prev, msg]); //updates chat
      setInput("");
    }
  };

  const handleCreateRoomClick = () => {
    const roomName = prompt("Enter room name:");
    if (roomName && socketRef.current) {
      setPendingRoomName(roomName);
      socketRef.current.emit("create private room", { roomName });
    }
  };

  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "#000000ff", display: "flex", flexDirection: "row", width: "100vw" }}>
      {/* Chat UI improvements*/}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: 0, margin: 0, minHeight: "100vh" }}>
        {/* Tabs above the chat UI box, no border here */}
        <div style={{
          width: "95%",
          maxWidth: 900,
          margin: "2rem 0 0 0",
          display: "flex",
          alignItems: "flex-end",
          background: "transparent"
        }}>
          <div style={{
            display: "flex",
            gap: 2,
            background: "transparent",
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
            width: "fit-content"
          }}>
          {/* Home tab always first */}
          <div
            key="home"
            onClick={() => setActiveRoom(null)}
            style={{
              padding: "10px 24px",
              cursor: "pointer",
              background: activeRoom === null ? "#fff" : "#333",
              color: activeRoom === null ? "#222" : "#fff",
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              marginRight: 4,
              border: activeRoom === null ? "2px solid #fff" : "2px solid transparent",
              borderBottom: activeRoom === null ? "none" : "2px solid #333",
              fontWeight: activeRoom === null ? "bold" : "normal"
            }}
          >
            Home
          </div>
          {rooms.map((room) => (
            <div
              key={room.roomId}
              style={{
                display: "flex",
                alignItems: "center",
                position: "relative",
                marginRight: 4,
              }}
            >
              <div
                onClick={() => setActiveRoom(room.roomId)}
                style={{
                  padding: "10px 24px 10px 24px",
                  cursor: "pointer",
                  background: activeRoom === room.roomId ? "#fff" : "#333",
                  color: activeRoom === room.roomId ? "#222" : "#fff",
                  borderTopLeftRadius: 8,
                  borderTopRightRadius: 8,
                  border: activeRoom === room.roomId ? "2px solid #fff" : "2px solid transparent",
                  borderBottom: activeRoom === room.roomId ? "none" : "2px solid #333",
                  fontWeight: activeRoom === room.roomId ? "bold" : "normal",
                  minWidth: 80,
                  textAlign: "center"
                }}
              >
                {room.name}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (socketRef.current) {
                    socketRef.current.emit("leave private room", { roomId: room.roomId });
                  }
                  setRooms((prev) => prev.filter(r => r.roomId !== room.roomId));
                  if (activeRoom === room.roomId) {
                    setActiveRoom(null);
                  }
                }}
                style={{
                  position: "absolute",
                  right: 2,
                  top: 2,
                  width: 18,
                  height: 18,
                  border: "none",
                  background: "transparent",
                  color: activeRoom === room.roomId ? "#222" : "#fff",
                  fontWeight: "bold",
                  fontSize: 14,
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: 0,
                  zIndex: 2
                }}
                title="Close room"
              >
                ×
              </button>
            </div>
          ))}
          <div
            onClick={handleCreateRoomClick}
            style={{
              padding: "10px 24px",
              cursor: "pointer",
              background: "#333",
              color: "#20ddff",
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              marginRight: 4,
              fontWeight: "bold"
            }}
          >
            +
          </div>
          </div>
        </div>
        {/* Chat UI box below tabs, border starts here */}
        <div style={{
          width: "95%",
          maxWidth: 900,
          margin: 0,
          padding: 20,
          border: "1px solid #ccc",
          borderTop: "1px solid #fff",
          background: "#000000ff",
          minHeight: 600,
          display: "flex",
          flexDirection: "column",
          borderTopLeftRadius: 0,
          borderTopRightRadius: 8,
          borderBottomLeftRadius: 8,
          borderBottomRightRadius: 8
        }}>
          <div style={{
            flex: 1,
            minHeight: 400,
            maxHeight: "60vh",
            overflowY: "auto",
            borderLeft: "1px solid #000000ff",
            borderRight: "1px solid #000000ff",
            borderBottom: "1px solid #000000ff",
            borderTop: "none",
            marginBottom: 10,
            padding: 10,
            background: "#ffffffff"
          }}>
            {messages.length === 0 ? (
              <div style={{ color: "#000000ff" }}>No messages yet.</div>
            ) : (
              messages
                .filter(msg => (activeRoom === null ? !msg.roomId : msg.roomId === activeRoom))
                .map((msg, idx) => (
                  <div key={idx} style={{ marginBottom: 6, color: "#000000ff" }}>
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
            <span style={{
              display: "flex",
              alignItems: "center",
              background: "#20ddff",
              borderRadius: 16,
              boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
              marginLeft: 4
            }}>
              <button
                type="submit"
                style={{
                  padding: "8px 20px",
                  background: "transparent",
                  border: "none",
                  color: "#000",
                  fontWeight: "bold",
                  fontSize: 16,
                  borderRadius: 16,
                  cursor: "pointer"
                }}
              >
                Send
              </button>
            </span>
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
              {users.filter(u => u.status === "online").map(u => {
                // Find the active room object
                const activeRoomObj = rooms.find(r => r.roomId === activeRoom);
                const isCreator = activeRoomObj && activeRoomObj.creator === username;
                const canInvite = isCreator && u.username !== username && activeRoomObj;
                return (
                  <li
                    key={u.username}
                    style={{
                      color: "#20ddff",
                      fontWeight: u.username === username ? "bold" : "normal",
                      position: "relative",
                      display: "flex",
                      alignItems: "center"
                    }}
                  >
                    {u.username}
                    {canInvite && (
                      <button
                        onClick={() => {
                          if (socketRef.current) {
                            socketRef.current.emit("invite to room", { roomId: activeRoom, invitee: u.username });
                          }
                        }}
                        style={{
                          marginLeft: 8,
                          background: "#20ddff",
                          color: "#000",
                          border: "none",
                          borderRadius: 8,
                          padding: "2px 8px",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: "bold"
                        }}
                        title={`Invite ${u.username} to this room`}
                      >
                        Invite
                      </button>
                    )}
                  </li>
                );
              })}
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
