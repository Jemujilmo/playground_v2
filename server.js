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
  //Set username for this socket
  socket.on('set username', (username) => {
    socket.username = username;
    console.log(`Socket ${socket.id} associated with username: ${username}`);
  });
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
  socket.on('chat message', (msg) => {
    //'user connected' message to all users in the current room
    io.to(currentRoom).emit('chat message', msg);
    //Store the message in the chat history
    if (!chatHistory[currentRoom]) {
      chatHistory[currentRoom] = [];
    }
    chatHistory[currentRoom].push(msg);
  });
// In-memory private room management
const privateRooms = {}; // { roomId: { members: [username], invites: [username] } }
const userInvites = {}; // { username: [roomId, ...] }

  // Create a private room
  socket.on('create private room', ({ roomName, invites = [] }) => {
    if (!socket.username) return;
    const roomId = 'room_' + Math.random().toString(36).substr(2, 9);
    privateRooms[roomId] = {
      members: [socket.username],
      invites: invites,
      name: roomName || "Untitled Room",
      creator: socket.username
    };
    socket.join(roomId);
    socket.emit('private room created', { roomId, name: privateRooms[roomId].name });
    // Notify invited users and update their room list
    invites.forEach(invitedUser => {
      for (let [id, s] of io.of('/').sockets) {
        if (s.username === invitedUser) {
          s.emit('private room invite', { roomId, name: privateRooms[roomId].name, from: socket.username });
          sendUserRooms(s, invitedUser);
        }
      }
    });
    // Update room list for creator
    sendUserRooms(socket, socket.username);
    console.log(`${socket.username} created private room ${roomId} (${privateRooms[roomId].name})`);
  });


  // Invite a user to a private room
  socket.on('invite to room', ({ roomId, invitee }) => {
    if (!privateRooms[roomId] || !socket.username) return;
    if (!privateRooms[roomId].members.includes(socket.username)) return;
    if (privateRooms[roomId].invites.includes(invitee)) return;
    privateRooms[roomId].invites.push(invitee);
    if (!userInvites[invitee]) userInvites[invitee] = [];
    userInvites[invitee].push(roomId);
    // Find all sockets for the invitee and send invite
    for (const [id, s] of Object.entries(io.sockets.sockets)) {
      if (s.username === invitee) {
        s.emit('private room invite', { roomId, from: socket.username });
      }
    }
    console.log(`${socket.username} invited ${invitee} to room ${roomId}`);
  });

  // Send only relevant private rooms to client
  function sendUserRooms(socket, username) {
    const userRooms = Object.entries(privateRooms)
      .filter(([roomId, room]) =>
        room.members.includes(username) || (room.invites && room.invites.includes(username))
      )
      .map(([roomId, room]) => ({
        roomId,
        name: room.name,
        creator: room.creator
      }));
    socket.emit('rooms update', userRooms);
  }
  socket.on('get rooms', () => {
    if (!socket.username) return;
    sendUserRooms(socket, socket.username);
  });

  // Accept invite to private room
  socket.on('accept invite', ({ roomId }) => {
    if (!privateRooms[roomId] || !socket.username) return;
    if (!privateRooms[roomId].invites.includes(socket.username)) return;
    privateRooms[roomId].invites = privateRooms[roomId].invites.filter(u => u !== socket.username);
    privateRooms[roomId].members.push(socket.username);
    socket.join(roomId);
    // Remove invite from userInvites
    if (userInvites[socket.username]) {
      userInvites[socket.username] = userInvites[socket.username].filter(r => r !== roomId);
    }
    // Notify all members
    io.to(roomId).emit('private room joined', { roomId, username: socket.username });
    console.log(`${socket.username} joined private room ${roomId}`);
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
    if (!privateRooms[roomId] || !socket.username) return;
    privateRooms[roomId].members = privateRooms[roomId].members.filter(u => u !== socket.username);
    socket.leave(roomId);
    io.to(roomId).emit('private room left', { roomId, username: socket.username });
    // Clean up room if empty
    if (privateRooms[roomId].members.length === 0) {
      delete privateRooms[roomId];
    }
    // Emit updated room list to all clients
    const roomList = Object.entries(privateRooms).map(([roomId, room]) => ({
      roomId,
      name: room.name,
      creator: room.creator
    }));
    io.emit('rooms update', roomList);
    console.log(`${socket.username} left private room ${roomId}`);
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
    if (typeof currentRoom !== 'undefined' && currentRoom) {
      io.to(currentRoom).emit('message', {
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

  //Room and chat logic
  let currentRoom = null;

    socket.on('join room', (room) => {
  if (currentRoom) {
    //Notify room that user left
    io.to(currentRoom).emit('message', {
      user: 'admin',
      text: `${socket.username} has left the room.`
    });
    socket.leave(currentRoom);
  }
  currentRoom = room;
  socket.join(room);

  //Welcome to the user
  socket.emit('message', {
    user: 'admin',
    text: `${socket.username}, welcome to room ${room}.`
  });

  //Public join message to the room
  socket.to(room).emit('message', {
    user: 'admin',
    text: `${socket.username} has joined the room.`
  });

  //Send chat history to the user when they join a room
  if (chatHistory[room]) {
    socket.emit('chat history', chatHistory[room]);
  }
});
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
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
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
