const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');
const validator = require('validator');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const userPings = new Map();
const registrationLimiter = new RateLimiterMemory({
  points: 5, // 5 attempts
  duration: 60, // per 60 seconds per IP
});
const loginLimiter = new RateLimiterMemory({
  points: 5, // 5 attempts
  duration: 60, // per 60 seconds per IP
});

io.on('connection', (socket) => {
  const handshakeUsername = socket.handshake.query?.username;
  if (handshakeUsername) {
    socket.username = handshakeUsername;
  }

  socket.currentRoom = null;

  // --- Registration ---
  socket.on('register', async ({ username, password, email }) => {
    try {
      await registrationLimiter.consume(socket.handshake.address);
      if (
        !username ||
        !password ||
        !email ||
        !validator.isAlphanumeric(username) ||
        !validator.isLength(username, { min: 3, max: 20 }) ||
        !validator.isEmail(email) ||
        !validator.isLength(password, { min: 6, max: 100 })
      ) {
        socket.emit('register error', { message: 'Invalid input.' });
        return;
      }
      const existing = await prisma.user.findFirst({
        where: { OR: [{ username }, { email }] }
      });
      if (existing) {
        socket.emit('register error', { message: 'Username or email already exists' });
        return;
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.create({
        data: { username, email, password: hashedPassword }
      });
      socket.emit('register success', { username });
    } catch (rejRes) {
      socket.emit('register error', { message: 'Too many registration attempts. Please wait.' });
    }
  });

  // --- Login ---
  socket.on('login', async ({ username, password }) => {
    try {
      await loginLimiter.consume(socket.handshake.address);
      if (
        !username ||
        !password ||
        !validator.isAlphanumeric(username) ||
        !validator.isLength(username, { min: 3, max: 20 })
      ) {
        socket.emit('login error', { message: 'Invalid input.' });
        return;
      }
      const user = await prisma.user.findUnique({ where: { username } });
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
      socket.userId = user.id;
      socket.emit('login success', { username });
    } catch (rejRes) {
      socket.emit('login error', { message: 'Too many login attempts. Please wait.' });
    }
  });

  // --- Create Private Room ---
  socket.on('create private room', async ({ roomName, invites = [] }) => {
    if (!socket.userId) return;
    // Create the room with the creator as a member
    const room = await prisma.room.create({
      data: {
        name: roomName || "Untitled Room",
        creator: { connect: { id: socket.userId } },
        members: { connect: [{ id: socket.userId }] }
      }
    });
    // Notify invited users
    for (const invitee of invites) {
      const user = await prisma.user.findUnique({ where: { username: invitee } });
      if (user) {
        for (const s of Array.from(io.sockets.sockets.values())) {
          if (s.username === invitee) {
            s.emit('private room invite', { roomId: room.id, name: room.name, from: socket.username });
          }
        }
      }
    }
    socket.join(room.id.toString());
    socket.emit('private room created', { roomId: room.id, name: room.name });
    sendUserRooms(socket, socket.username);
  });

  // --- Invite to Room (with persistence) ---
  socket.on('invite to room', async ({ roomId, invitee }) => {
    const user = await prisma.user.findUnique({ where: { username: invitee } });
    if (!user) return;
    await prisma.invite.create({
      data: {
        room: { connect: { id: parseInt(roomId) } },
        user: { connect: { id: user.id } },
        from: { connect: { id: socket.userId } }
      }
    });
    // Notify if online
    const roomObj = await prisma.room.findUnique({ where: { id: parseInt(roomId) } });
    for (const s of Array.from(io.sockets.sockets.values())) {
      if (s.username === invitee) {
        s.emit('private room invite', { roomId, name: roomObj?.name || '', from: socket.username });
      }
    }
  });

  // --- On connect, send pending invites ---
  (async () => {
    if (socket.username) {
      const user = await prisma.user.findUnique({
        where: { username: socket.username },
        include: { invites: { include: { room: true, from: true } } }
      });
      if (user && user.invites) {
        user.invites.forEach(invite => {
          socket.emit('private room invite', {
            roomId: invite.roomId,
            name: invite.room.name,
            from: invite.from.username
          });
        });
      }
    }
  })();

  // --- Accept Invite (remove invite from DB) ---
  socket.on('accept invite', async ({ roomId }) => {
    if (!socket.userId) return;
    await prisma.room.update({
      where: { id: parseInt(roomId) },
      data: { members: { connect: { id: socket.userId } } }
    });
    await prisma.invite.deleteMany({
      where: { roomId: parseInt(roomId), userId: socket.userId }
    });
    socket.join(roomId.toString());
    io.to(roomId.toString()).emit('private room joined', { roomId, username: socket.username });
    sendUserRooms(socket, socket.username);
  });

  // --- Decline Invite (remove invite from DB) ---
  socket.on('decline invite', async ({ roomId }) => {
    if (!socket.userId) return;
    await prisma.invite.deleteMany({
      where: { roomId: parseInt(roomId), userId: socket.userId }
    });
  });

  // --- Leave Private Room (delete room if empty) ---
  socket.on('leave private room', async ({ roomId }) => {
    if (!socket.userId) return;
    await prisma.room.update({
      where: { id: parseInt(roomId) },
      data: { members: { disconnect: { id: socket.userId } } }
    });
    socket.leave(roomId.toString());
    io.to(roomId.toString()).emit('private room left', { roomId, username: socket.username });
    sendUserRooms(socket, socket.username);

    // Check if room is empty
    const room = await prisma.room.findUnique({
      where: { id: parseInt(roomId) },
      include: { members: true }
    });
    if (room && room.members.length === 0) {
      await prisma.message.deleteMany({ where: { roomId: room.id } });
      await prisma.invite.deleteMany({ where: { roomId: room.id } });
      await prisma.room.delete({ where: { id: room.id } });
    }
  });

  // --- Edit Room Name ---
  socket.on('edit room name', async ({ roomId, newName }) => {
    // Only allow the creator to edit
    const room = await prisma.room.findUnique({ where: { id: parseInt(roomId) } });
    if (!room || room.creatorId !== socket.userId) return;
    await prisma.room.update({
      where: { id: parseInt(roomId) },
      data: { name: newName }
    });
    io.to(roomId.toString()).emit('room name updated', { roomId, name: newName });
  });

  // --- Get User's Rooms ---
  socket.on('get rooms', () => {
    if (!socket.username) return;
    sendUserRooms(socket, socket.username);
  });

  // --- Helper: Send User Rooms ---
  async function sendUserRooms(socket, username) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { rooms: true }
    });
    if (!user) return;
    const userRooms = user.rooms.map(room => ({
      roomId: room.id,
      name: room.name,
      creator: room.creatorId
    }));
    socket.emit('rooms update', userRooms);
  }

  // --- Chat Message ---
  socket.on('chat message', async (msg) => {
    if (!socket.currentRoom || !socket.userId) return;
    const message = await prisma.message.create({
      data: {
        text: msg.text,
        user: { connect: { id: socket.userId } },
        room: { connect: { id: parseInt(socket.currentRoom) } }
      }
    });
    io.to(socket.currentRoom).emit('chat message', {
      user: socket.username,
      text: msg.text,
      roomId: socket.currentRoom,
      createdAt: message.createdAt
    });
  });

  // --- Join Room (and send chat history) ---
  socket.on('join room', async (roomId) => {
    socket.currentRoom = roomId;
    socket.join(roomId.toString());
    const messages = await prisma.message.findMany({
      where: { roomId: parseInt(roomId) },
      orderBy: { createdAt: 'asc' },
      include: { user: true }
    });
    socket.emit('chat history', messages.map(m => ({
      user: m.user.username,
      text: m.text,
      roomId: m.roomId,
      createdAt: m.createdAt
    })));
  });

  // --- Disconnect ---
  socket.on('disconnect', async () => {
    if (socket.username) {
      await prisma.user.update({
        where: { username: socket.username },
        data: { status: "offline" }
      });
    }
    if (socket.currentRoom) {
      io.to(socket.currentRoom).emit('message', {
        user: 'admin',
        text: `${socket.username || socket.id} has disconnected.`
      });
    }
  });

  // --- User status ping logic (optional) ---
  socket.on('ping', async ({ username }) => {
    if (!username) return;
    userPings.set(username, Date.now());
    await prisma.user.update({
      where: { username },
      data: { status: "online" }
    });
  });
});

// Start the server, listening on all network interfaces
const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.io server running on port ${PORT} (bound to 0.0.0.0)`);
});
