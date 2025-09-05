let _privateRooms = {};
const privateRooms = new Proxy(_privateRooms, {
  set(target, prop, value) {
    if (prop === 'length' || prop === Symbol.iterator) return Reflect.set(target, prop, value);
    if (prop in target && value === undefined) {
    }
    if (!(prop in target)) {
    }
    return Reflect.set(target, prop, value);
  },
  deleteProperty(target, prop) {
    return Reflect.deleteProperty(target, prop);
  }
});
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const chatHistory = {};

//lowdb and json files setup
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

const userPings = new Map();

const { Low: LowRooms } = require('lowdb');
const { JSONFile: JSONFileRooms } = require('lowdb/node');
const roomsDB = new LowRooms(new JSONFileRooms('rooms.json'), { rooms: [] });

async function getRooms() {
  await roomsDB.read();
  return roomsDB.data.rooms;
}
async function saveRooms(rooms) {
  roomsDB.data.rooms = rooms;
  await roomsDB.write();
}

const { Low: LowChat } = require('lowdb');
const { JSONFile: JSONFileChat } = require('lowdb/node');
const chatDB = new LowChat(new JSONFileChat('chatHistory.json'), { history: {} });

async function getChatHistory(room) {
  await chatDB.read();
  return chatDB.data.history[room] || [];
}

async function addChatMessage(room, msg) {
  await chatDB.read();
  if (!chatDB.data.history[room]) chatDB.data.history[room] = [];
  chatDB.data.history[room].push(msg);
  await chatDB.write();
}

io.on('connection', (socket) => {
  const handshakeUsername = socket.handshake.query?.username;
  if (handshakeUsername) {
    socket.username = handshakeUsername;
  }

  socket.on('get users', async () => {
    await db.read();
    socket.emit('user status update', db.data.users.map(({ username, status }) => ({ username, status })));
  });

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
    socket.emit('Register success', { username });
  });

  socket.currentRoom = null;

  socket.on('chat message', async (msg) => {
    if (!socket.currentRoom) return;
    const room = socket.currentRoom;
    io.to(room).emit('chat message', msg);
    await addChatMessage(room, msg);
  });

  socket.on('join room', async (room) => {
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
    //Send chat history to user (stored in chatHistory.json)
    const history = await getChatHistory(room);
    socket.emit('chat history', history);
  });

  //Private room logic

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
      socket.join(roomId);
      socket.emit('private room created', { roomId, name: newRoom.name });
      invites.forEach(invitedUser => {
        for (let [id, s] of io.of('/').sockets) {
          if (s.username === invitedUser) {
            s.emit('private room invite', { roomId, name: newRoom.name, from: socket.username });
            sendUserRooms(s, invitedUser);
          }
        }
      });
      sendUserRooms(socket, socket.username);
    })();
  });

  socket.on('invite to room', ({ roomId, invitee }) => {
    (async () => {
      const rooms = await getRooms();
      const room = rooms.find(r => r.roomId === roomId);
      if (!room || !socket.username) return;
      if (!room.members.includes(socket.username)) return;
      if (!room.invites.includes(invitee)) {
        room.invites.push(invitee);
        await saveRooms(rooms);
      }
      for (const s of Array.from(io.sockets.sockets.values())) {
        if (s.username === invitee) {
          s.emit('private room invite', {
            roomId,
            name: room?.name || "Untitled Room",
            from: socket.username
          });
        }
      }
    })();
  });

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
      socket.emit('rooms update', userRooms);
    })();
  }

  socket.on('get rooms', () => {
    if (!socket.username) return;
    sendUserRooms(socket, socket.username);
  });

  socket.on('accept invite', ({ roomId }) => {
    socket.currentRoom = roomId;
    (async () => {
      const rooms = await getRooms();
      const room = rooms.find(r => r.roomId === roomId);
      if (!room) return;
      if (!socket.username) return;
      if (!room.invites.includes(socket.username)) return;
      room.invites = room.invites.filter(u => u !== socket.username);
      room.members.push(socket.username);
      await saveRooms(rooms);
      socket.join(roomId);
      io.to(roomId).emit('private room joined', { roomId, username: socket.username });
      const members = room.members;
      const allSockets = Array.from(io.sockets.sockets.values());
      for (const s of allSockets) {
        if (s.username && members.includes(s.username)) {
          sendUserRooms(s, s.username);
        }
      }
    })();
  });

  //decline invite
  socket.on('decline invite', ({ roomId }) => {
    (async () => {
      const rooms = await getRooms();
      const room = rooms.find(r => r.roomId === roomId);
      if (!room || !socket.username) return;
      room.invites = room.invites.filter(u => u !== socket.username);
      await saveRooms(rooms);
    })();
  });

  //Leave private room
  socket.on('leave private room', ({ roomId }) => {
    (async () => {
      const rooms = await getRooms();
      const room = rooms.find(r => r.roomId === roomId);
      if (!room || !socket.username) return;
      room.members = room.members.filter(u => u !== socket.username);
      socket.leave(roomId);
      io.to(roomId).emit('private room left', { roomId, username: socket.username });
      if (room.members.length === 0) {
        const idx = rooms.findIndex(r => r.roomId === roomId);
        if (idx !== -1) rooms.splice(idx, 1);
      }
      await saveRooms(rooms);
      for (const s of Array.from(io.sockets.sockets.values())) {
        if (s.username) sendUserRooms(s, s.username);
      }
    })();
  });

  //Set room name
  socket.on('edit room name', ({ roomId, newName }) => {
    (async () => {
      const rooms = await getRooms();
      const room = rooms.find(r => r.roomId === roomId);
      if (!room || room.creator !== socket.username) return;
      room.name = newName;
      await saveRooms(rooms);
      io.to(roomId).emit('room name updated', { roomId, name: newName });
    })();
  });

  socket.on('disconnect', () => {
    if (socket.currentRoom) {
      io.to(socket.currentRoom).emit('message', {
        user: 'admin',
        text: `${socket.username || socket.id} has disconnected.`
      });
    }
  });

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
    socket.username = username;
    socket.emit('login success', { username });
  });

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

//Start the server, listening on all network interfaces
//This allows connections from other devices on the same network, is this a problem? not sure
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
}, 10000); //every 10 seconds check inactive users and sets them offline if no ping in last 30 seconds
