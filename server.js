console.log("SERVER STARTED", { pid: process.pid, time: new Date().toISOString() });

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
  console.error('[DEBUG] Uncaught Exception:', err);
});

// Proxy to detect accidental deletion or re-initialization of privateRooms
let _privateRooms = {};
const privateRooms = new Proxy(_privateRooms, {
  set(target, prop, value) {
    if (prop === 'length' || prop === Symbol.iterator) return Reflect.set(target, prop, value);
    if (prop in target && value === undefined) {
      console.log('[DEBUG] privateRooms property deleted:', prop);
    }
    if (!(prop in target)) {
      console.log('[DEBUG] privateRooms new property:', prop);
    }
    return Reflect.set(target, prop, value);
  },
  deleteProperty(target, prop) {
    console.log('[DEBUG] privateRooms property deleted:', prop);
    return Reflect.deleteProperty(target, prop);
  }
});
// Basic socket.io server setup for chat
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST']
  }
});

// Store all chat data to the server
const chatHistory = {};

// lowdb, this was a bitch to get working
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const db = new Low(new JSONFile('users.json'), { users: [] });
const bcrypt = require('bcryptjs');

async function initDB() {
  await db.read();
  if (!db.data) db.data = { users: [] };
  await db.write();
}
initDB();

const userPings = new Map(); //username -> last ping timestamp

//Handle socket.io connections
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  // Set username from handshake query
  const handshakeUsername = socket.handshake.query?.username;
  if (handshakeUsername) {
    socket.username = handshakeUsername;
    console.log(`[DEBUG] handshake username: Socket ${socket.id} associated with username: ${handshakeUsername}`);
    // Print all connected usernames after setting
    const connectedUsernames = Array.from(io.sockets.sockets.values()).map(s => s.username);
    console.log(`[DEBUG] Connected usernames after handshake:`, connectedUsernames);
  }
  //Send user list
  socket.on('get users', async () => {
    await db.read();
    socket.emit('user status update', db.data.users.map(({ username, status }) => ({ username, status })));
  });
  //Register user credentials to the server (persistent, hashed)
  socket.on('register', async ({ username, password }) => {
    await db.read();
    const existing = db.data.users.find(u => u.username === username);
    if (existing) {
      socket.emit('register error', { message: 'Username already exists' });
      return;
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    db.data.users.push({ username, password: hashedPassword });
    await db.write();
    console.log('User registered:', username);
    socket.emit('Register success', { username });
  });
  // Per-socket room state
  socket.currentRoom = null;
  socket.on('chat message', (msg) => {
    if (!socket.currentRoom) return;
    const room = socket.currentRoom;
    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const usernamesInRoom = socketsInRoom.map(id => io.sockets.sockets.get(id)?.username).filter(Boolean);
    console.log(`[DEBUG] chat message sent to room: ${room}, users:`, usernamesInRoom, 'msg:', msg);
    io.to(room).emit('chat message', msg);
    if (!chatHistory[room]) {
      chatHistory[room] = [];
    }
    chatHistory[room].push(msg);
  });
  // Join room handler (per-socket)
  socket.on('join room', (room) => {
    if (socket.currentRoom) {
      io.to(socket.currentRoom).emit('message', {
        user: 'admin',
        text: `${socket.username} has left the room.`
      });
      socket.leave(socket.currentRoom);
    }
    socket.currentRoom = room;
    socket.join(room);
    socket.emit('message', {
      user: 'admin',
      text: `${socket.username}, welcome to room ${room}.`
    });
    socket.to(room).emit('message', {
      user: 'admin',
      text: `${socket.username} has joined the room.`
    });
    if (chatHistory[room]) {
      socket.emit('chat history', chatHistory[room]);
    }
  });

// Persistent private room management using lowdb
const { Low: LowRooms } = require('lowdb');
const { JSONFile: JSONFileRooms } = require('lowdb/node');
const roomsDB = new LowRooms(new JSONFileRooms('rooms.json'), { rooms: [] });
const userInvites = {}; // { username: [roomId, ...] }

async function getRooms() {
  await roomsDB.read();
  return roomsDB.data.rooms;
}
async function saveRooms(rooms) {
  roomsDB.data.rooms = rooms;
  await roomsDB.write();
}

  // Create a private room
  socket.on('create private room', ({ roomName, invites = [] }) => {
    if (!socket.username) return;
    (async () => {
      const rooms = await getRooms();
      const roomId = 'room_' + Math.random().toString(36).substr(2, 9);
      const newRoom = {
        roomId,
        members: [socket.username],
        invites: invites,
        name: roomName || "Untitled Room",
        creator: socket.username
      };
      rooms.push(newRoom);
      await saveRooms(rooms);
      console.log(`[DEBUG] Private room created:`, newRoom);
      socket.join(roomId);
      socket.emit('private room created', { roomId, name: newRoom.name });
      // Notify invited users and update their room list
      invites.forEach(invitedUser => {
        for (let [id, s] of io.of('/').sockets) {
          if (s.username === invitedUser) {
            s.emit('private room invite', { roomId, name: newRoom.name, from: socket.username });
            sendUserRooms(s, invitedUser);
            console.log(`[DEBUG] Sent private room invite:`, { roomId, to: invitedUser, from: socket.username });
          }
        }
      });
      // Update room list for creator
      sendUserRooms(socket, socket.username);
      console.log(`[DEBUG] sendUserRooms called for creator ${socket.username}`);
      console.log(`${socket.username} created private room ${roomId} (${newRoom.name})`);
    })();
  });


  // Invite a user to a private room
  socket.on('invite to room', ({ roomId, invitee }) => {
    (async () => {
      const rooms = await getRooms();
      const room = rooms.find(r => r.roomId === roomId);
      if (!room || !socket.username) return;
      if (!room.members.includes(socket.username)) return;
      if (!room.invites.includes(invitee)) {
        room.invites.push(invitee);
        await saveRooms(rooms);
        console.log('[DEBUG] After push, invites for room', roomId, room.invites);
      }
      if (!userInvites[invitee]) userInvites[invitee] = [];
      userInvites[invitee].push(roomId);
      // Find all sockets for the invitee and send invite
      let found = false;
      for (const s of Array.from(io.sockets.sockets.values())) {
        if (s.username === invitee) {
          found = true;
          console.log(`[DEBUG] Sending private room invite to socket ${s.id} for user ${invitee}`);
          s.emit('private room invite', {
            roomId,
            name: room?.name || "Untitled Room",
            from: socket.username
          });
        }
      }
      if (!found) {
        console.log(`[DEBUG] No socket found for invitee username: ${invitee}`);
      }
      console.log(`${socket.username} invited ${invitee} to room ${roomId}`);
    })();
  });

  // Send only relevant private rooms to client
  function sendUserRooms(socket, username) {
    (async () => {
      const rooms = await getRooms();
      const userRooms = rooms
        .filter(room =>
          room.members.includes(username) || (room.invites && room.invites.includes(username))
        )
        .map(room => ({
          roomId: room.roomId,
          name: room.name,
          creator: room.creator
        }));
      console.log(`[DEBUG] sendUserRooms for ${username}:`, userRooms);
      socket.emit('rooms update', userRooms);
    })();
  }
  socket.on('get rooms', () => {
    if (!socket.username) return;
    sendUserRooms(socket, socket.username);
  });

  // Accept invite to private room
  socket.on('accept invite', ({ roomId }) => {
  socket.currentRoom = roomId;
    (async () => {
      const rooms = await getRooms();
      const room = rooms.find(r => r.roomId === roomId);
      console.log('[DEBUG] accept invite event received:', { roomId, username: socket.username });
      if (!room) {
        console.log('[DEBUG] accept invite: room does not exist', { roomId, username: socket.username });
        return;
      }
      if (!socket.username) {
        console.log('[DEBUG] accept invite: socket.username missing', { roomId, socketId: socket.id });
        return;
      }
      if (!room.invites.includes(socket.username)) {
        console.log('[DEBUG] accept invite: user not in invites', { roomId, username: socket.username, invites: room.invites });
        return;
      }
      room.invites = room.invites.filter(u => u !== socket.username);
      room.members.push(socket.username);
      await saveRooms(rooms);
      socket.join(roomId);
      // Remove invite from userInvites
      if (userInvites[socket.username]) {
        userInvites[socket.username] = userInvites[socket.username].filter(r => r !== roomId);
      }
      // Notify all members
      io.to(roomId).emit('private room joined', { roomId, username: socket.username });
      // Send updated room list to all current members of the room
      const members = room.members;
      const allSockets = Array.from(io.sockets.sockets.values());
      for (const s of allSockets) {
        if (s.username && members.includes(s.username)) {
          sendUserRooms(s, s.username);
        }
      }
      console.log(`[DEBUG] accept invite:`, {
        roomId,
        username: socket.username,
        currentMembers: room.members,
        currentInvites: room.invites
      });
      console.log(`${socket.username} joined private room ${roomId}`);
    })();
  });

  // Decline invite
  socket.on('decline invite', ({ roomId }) => {
    if (!privateRooms[roomId] || !socket.username) return;
    privateRooms[roomId].invites = privateRooms[roomId].invites.filter(u => u !== socket.username);
    if (userInvites[socket.username]) {
      userInvites[socket.username] = userInvites[socket.username].filter(r => r !== roomId);
    }
    // Optionally notify inviter
    console.log(`${socket.username} declined invite to room ${roomId}`);
  });

  // Leave private room
  socket.on('leave private room', ({ roomId }) => {
    (async () => {
      const rooms = await getRooms();
      const room = rooms.find(r => r.roomId === roomId);
      if (!room || !socket.username) return;
      room.members = room.members.filter(u => u !== socket.username);
      socket.leave(roomId);
      io.to(roomId).emit('private room left', { roomId, username: socket.username });
      // Clean up room if empty
      if (room.members.length === 0) {
        const idx = rooms.findIndex(r => r.roomId === roomId);
        if (idx !== -1) rooms.splice(idx, 1);
      }
      await saveRooms(rooms);
      // Emit updated room list to all clients
      for (const s of Array.from(io.sockets.sockets.values())) {
        if (s.username) sendUserRooms(s, s.username);
      }
      console.log(`${socket.username} left private room ${roomId}`);
    })();
  });

  // Edit private room name
  socket.on('edit room name', ({ roomId, newName }) => {
    const room = privateRooms[roomId];
    if (!room || room.creator !== socket.username) return;
    room.name = newName;
    // Notify all members of the name change
    io.to(roomId).emit('room name updated', { roomId, name: newName });
    console.log(`${socket.username} changed name of room ${roomId} to ${newName}`);
  });

  // Unified disconnect handler: handles private room cleanup, userInvites, and currentRoom
  socket.on('disconnect', () => {
    if (socket.username) {
      // Private room cleanup
      for (const [roomId, room] of Object.entries(privateRooms)) {
        if (room.members.includes(socket.username)) {
          room.members = room.members.filter(u => u !== socket.username);
          io.to(roomId).emit('private room left', { roomId, username: socket.username });
        }
        if (room.invites.includes(socket.username)) {
          room.invites = room.invites.filter(u => u !== socket.username);
        }
        // Clean up room if empty
        if (room.members.length === 0) {
          delete privateRooms[roomId];
        }
      }
      if (userInvites[socket.username]) delete userInvites[socket.username];
      // Log and handle currentRoom disconnect
      console.log(`User disconnected: ${socket.username}`);
    } else {
      console.log('User disconnected:', socket.id);
    }
    if (typeof socket.currentRoom !== 'undefined' && socket.currentRoom) {
      io.to(socket.currentRoom).emit('message', {
        user: 'admin',
        text: `${socket.username || socket.id} has disconnected.`
      });
    }
  });
  //login handler to check credentials
  socket.on('login', async ({ username, password }) => {
    await db.read();
    const user = db.data.users.find(u => u.username === username);
    if (!user) {
      socket.emit('login error', { message: 'Invalid username or password' });
      return;
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      socket.emit('login error', { message: 'Invalid username or password' });
      return;
    }
    console.log('User logged in:', username);
    socket.username = username;
  //No status logic here; handled by ping system
    socket.emit('login success', { username });
  });

  // ...existing code...
  // Classic ping system for online status
  socket.on('ping', async ({ username }) => {
    if (!username) return;
    userPings.set(username, Date.now());
    await db.read();
    const user = db.data.users.find(u => u.username === username);
    if (user && user.status !== 'online') {
      user.status = 'online';
      await db.write();
      io.emit('user status update', db.data.users.map(({ username, status }) => ({ username, status })));
    }
  });
});

//Start the server
const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.io server running on port ${PORT} (bound to 0.0.0.0)`);
});
setInterval(async () => {
  await db.read();
  const now = Date.now();
  let changed = false;
  for (const user of db.data.users) {
    const last = userPings.get(user.username);
    if (user.status === 'online' && (!last || now - last > 30000)) {
      user.status = 'offline';
      userPings.delete(user.username);
      changed = true;
    }
  }
  if (changed) {
    await db.write();
    io.emit('user status update', db.data.users.map(({ username, status }) => ({ username, status })));
  } else {
    await db.write();
  }
}, 10000); //activity check
