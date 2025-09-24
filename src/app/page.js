"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";


export default function Home() {
  const router = useRouter();
  const socketRef = useRef(null);
  // Store messages per room: { [roomId]: [msg, ...] }
  const [messagesByRoom, setMessagesByRoom] = useState({});
  const [input, setInput] = useState("");
  const [username, setUsername] = useState("");
  const [users, setUsers] = useState([]); // All users with status
  const [rooms, setRooms] = useState([]); // All chat rooms
  const [activeRoom, setActiveRoom] = useState(null);
  const [globalRoomId, setGlobalRoomId] = useState(null);
  const [pendingRoomName, setPendingRoomName] = useState(null);
  const [invitePopup, setInvitePopup] = useState(null); // For invite notification

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
    // Only create socket if not already created
    if (!socketRef.current) {
      socketRef.current = io(process.env.NEXT_PUBLIC_SOCKET_URL, {
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        query: { username: storedUsername }
      });
      // Store messages per room or home
      socketRef.current.on("chat message", (msg) => {
        console.log("Received chat message:", msg);
        setMessagesByRoom((prev) => {
          const roomId = msg.roomId;
          return {
            ...prev,
            [roomId]: [...(prev[roomId] || []), msg]
          };
        });
      });
      socketRef.current.on("chat history", ({ roomId, messages }) => {
        setMessagesByRoom((prev) => ({
          ...prev,
          [roomId]: messages || []
        }));
      });
      socketRef.current.on("user status update", (userList) => {
        console.log("user status update", userList); // <--- This will print to your browser's DevTools console
        setUsers(userList);
      });
      socketRef.current.on("rooms update", (roomList) => {
        setRooms(roomList);
        // Find the global room and set its ID
        const homeRoom = roomList.find(r => r.name === "Home");
        if (homeRoom) {
          setGlobalRoomId(homeRoom.roomId);
          // If no room is active, set Home as the active room
          setActiveRoom(prev => prev === null ? homeRoom.roomId : prev);
        }
      });
      socketRef.current.on("private room invite", (invite) => {
        console.log("[DEBUG] Received private room invite:", invite);
        setInvitePopup(invite);
        setTimeout(() => setInvitePopup(null), 10000);
      });
      socketRef.current.on("private room joined", ({ roomId, username: joinedUser }) => {
        if (joinedUser === storedUsername) {
          setActiveRoom(roomId);
        }
      });
      
      socketRef.current.emit("get users");
      socketRef.current.emit("get rooms");
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []); // <--- Only on mount/unmount

  useEffect(() => {
    const interval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected && username) {
        socketRef.current.emit("ping", { username });
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [username]);

  const handleSend = (e) => {
    e.preventDefault();
    if (input.trim() && socketRef.current && activeRoom !== null) {
      const msg = { user: username, text: input, roomId: activeRoom };
      socketRef.current.emit("chat message", {
        text: input,
        user: username,
        roomId: activeRoom
      });
      setInput("");
    }
  };

  // Clear messages when switching rooms
  const handleCreateRoomClick = () => {
    const roomName = prompt("Enter room name:");
    if (roomName && socketRef.current) {
      setPendingRoomName(roomName);
      socketRef.current.emit("create private room", { roomName });
    }
  };

  useEffect(() => {
    if (socketRef.current && activeRoom !== null) {
      socketRef.current.emit("join room", activeRoom);
    }
  }, [activeRoom]);

  //listeners for connection errors and disconnections
  useEffect(() => {
    if (!socketRef.current) return;
    socketRef.current.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
    });
    socketRef.current.on("disconnect", () => {
      console.warn("Socket disconnected");
    });
    return () => {
      socketRef.current.off("connect_error");
      socketRef.current.off("disconnect");
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "#000000ff", display: "flex", flexDirection: "row", width: "100vw" }}>
      {/* Invite popup notification */}
      {invitePopup && (
        <div style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          background: "#222",
          color: "#fff",
          padding: "18px 32px",
          borderRadius: 12,
          boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
          zIndex: 1000,
          minWidth: 260,
          maxWidth: 340,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start"
        }}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>
            Private Chat Invitation
          </div>
          <div style={{ marginBottom: 8 }}>
            <b>{invitePopup.from}</b> invited you to join <b>{invitePopup.name}</b>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={{ background: "#20ddff", color: "#000", border: "none", borderRadius: 8, padding: "6px 16px", fontWeight: "bold", cursor: "pointer" }}
              onClick={() => {
                if (socketRef.current) {
                  console.log("[DEBUG] Accept clicked, emitting 'accept invite'", { roomId: invitePopup.roomId });
                  console.log("[DEBUG] socketRef.current.connected:", socketRef.current.connected);
                  socketRef.current.emit("accept invite", { roomId: invitePopup.roomId });
                  setInvitePopup(null);
                } else {
                  console.log("[DEBUG] Accept clicked but socketRef.current is null");
                }
              }}
            >
              Accept
            </button>
            <button
              style={{ background: "#888", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", fontWeight: "bold", cursor: "pointer" }}
              onClick={() => {
                if (socketRef.current) {
                  socketRef.current.emit("decline invite", { roomId: invitePopup.roomId });
                  setInvitePopup(null);
                }
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}
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
          {/* Home tab always first and not closeable */}
          <div
            key="home"
            onClick={() => setActiveRoom(globalRoomId)}
            style={{
              padding: "10px 24px",
              cursor: "pointer",
              background: activeRoom === globalRoomId ? "#fff" : "#333",
              color: activeRoom === globalRoomId ? "#222" : "#fff",
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              marginRight: 4,
              border: activeRoom === globalRoomId ? "2px solid #fff" : "2px solid transparent",
              borderBottom: activeRoom === globalRoomId ? "none" : "2px solid #333",
              fontWeight: activeRoom === globalRoomId ? "bold" : "normal"
            }}
          >
            Home
          </div>
          {/* Render only non-Home rooms as closeable tabs */}
          {rooms.filter(room => room.name !== "Home").map((room) => (
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
                onClick={() => setActiveRoom(room.roomId)}
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
                  setMessagesByRoom(prev => {
                    const copy = { ...prev };
                    delete copy[room.roomId];
                    return copy;
                  });
                  if (activeRoom === room.roomId) {
                    setActiveRoom(globalRoomId);
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
            {(messagesByRoom[activeRoom]?.length ?? 0) === 0 ? (
              <div style={{ color: "#000000ff" }}>No messages yet.</div>
            ) : (
              messagesByRoom[activeRoom]?.map((msg, idx) => (
                <div key={idx} style={{ marginBottom: 6, color: "#000000ff" }}>
                  <b>{msg.user}:</b> {msg.text}
                </div>
              ))
            )}
          </div>
          <form onSubmit={handleSend} style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              name="chatInput"
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
                // Only allow invite if NOT the Home room
                const canInvite = isCreator && u.username !== username && activeRoomObj && activeRoomObj.name !== "Home";
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
