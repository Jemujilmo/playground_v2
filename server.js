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

//rate limiter for login and registration
const userPings = new Map();
const registrationLimiter = new RateLimiterMemory({
  points: 5, //5 attempts
  duration: 60, //per 60 seconds per IP
});
const loginLimiter = new RateLimiterMemory({
  points: 5, //5 attempts
  duration: 60, //per 60 seconds per IP
});
const userSockets = new Map();

io.on('connection', async (socket) => {
  const handshakeUsername = socket.handshake.query?.username;
  if (handshakeUsername) {
    socket.username = handshakeUsername;
    const user = await prisma.user.findUnique({ where: { username: handshakeUsername } });
    if (user) {
      socket.userId = user.id;
    }
  }

  socket.currentRoom = null;

  //Track sockets per user
  if (socket.username) {
    if (!userSockets.has(socket.username)) userSockets.set(socket.username, new Set());
    userSockets.get(socket.username).add(socket.id);
  }

  //Registration logic
  socket.on('register', async ({ username, password }) => {
    console.log("Received register:", username, password);
    try {
      await registrationLimiter.consume(socket.handshake.address);
      if (
        !username ||
        !password ||
        !validator.isAlphanumeric(username) ||
        !validator.isLength(username, { min: 3, max: 20 }) ||
        !validator.isLength(password, { min: 6, max: 100 })
      ) {
        socket.emit('register error', { message: 'Invalid input.' });
        return;
      }
      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing) {
        socket.emit('register error', { message: 'Username already exists' });
        return;
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.create({
        data: { username, password: hashedPassword }
      });
      const homeRoom = await prisma.room.findUnique({ where: { name: "Home" } });
      if (homeRoom) {
        await prisma.room.update({
          where: { id: homeRoom.id },
          data: { members: { connect: { username } } }
        });
      }
      socket.emit('register success', { username });
    } catch (rejRes) {
      socket.emit('register error', { message: 'Too many registration attempts. Please wait.' });
    }
  });

  //Login logic
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
      await prisma.user.update({
        where: { username },
        data: { status: "online" }
      });
      const homeRoom = await prisma.room.findUnique({ where: { name: "Home" }, include: { members: true } });
      if (homeRoom && !homeRoom.members.some(u => u.username === username)) {
        await prisma.room.update({
          where: { id: homeRoom.id },
          data: { members: { connect: { username } } }
        });
      }
      broadcastUserStatus();
    } catch (rejRes) {
      socket.emit('login error', { message: 'Too many login attempts. Please wait.' });
    }
  });

  //Create private room
  socket.on('create private room', async ({ roomName, invites = [] }) => {
    console.log("create private room event received", roomName, invites, socket.userId);
    if (!socket.userId) {
      console.log("No userId on socket, cannot create room.");
      return;
    }
    try {
      const room = await prisma.room.create({
        data: {
          name: roomName || "Untitled Room",
          creator: { connect: { id: socket.userId } },
          members: { connect: [{ id: socket.userId }] }
        }
      });
      console.log("Room created:", room);

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

      //Private rooms only visible to its members
      sendUserRooms(socket, socket.username);

    } catch (err) {
      console.error("Error creating private room:", err);
      socket.emit('create room error', { message: 'Failed to create room.' });
    }
  });

  //Invite to room
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

    const roomObj = await prisma.room.findUnique({ where: { id: parseInt(roomId) } });
    for (const s of Array.from(io.sockets.sockets.values())) {
      if (s.username === invitee) {
        console.log(`Emitting private room invite to ${invitee} for room ${roomObj?.name}`);
        s.emit('private room invite', { roomId, name: roomObj?.name || '', from: socket.username });
      }
    }
  });

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

  //Accept invite
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

  //Decline invitation
  socket.on('decline invite', async ({ roomId }) => {
    if (!socket.userId) return;
    await prisma.invite.deleteMany({
      where: { roomId: parseInt(roomId), userId: socket.userId }
    });
  });

  //Leave private room, delete if empty
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

  //Edit room name
  socket.on('edit room name', async ({ roomId, newName }) => {
    const room = await prisma.room.findUnique({ where: { id: parseInt(roomId) } });
    if (!room || room.creatorId !== socket.userId) return;
    await prisma.room.update({
      where: { id: parseInt(roomId) },
      data: { name: newName }
    });
    io.to(roomId.toString()).emit('room name updated', { roomId, name: newName });
  });

  //Get User's Rooms
  socket.on('get rooms', () => {
    if (!socket.username) return;
    sendUserRooms(socket, socket.username);
  });

  //Send User Rooms
  async function sendUserRooms(socket, username) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { rooms: { include: { creator: true } } }
    });
    if (!user) return;
    const userRooms = user.rooms.map(room => ({
      roomId: room.id,
      name: room.name,
      creator: room.creator.username
    }));
    socket.emit('rooms update', userRooms);
  }

  //chat messages
  socket.on('chat message', async (msg) => {
    console.log("chat message event received", msg);
    console.log("currentRoom", socket.currentRoom, "userId", socket.userId);
    if (!socket.currentRoom || !socket.userId) return;
    console.log(`[SERVER] Received chat message:`, msg);
    // Save message to DB
    await prisma.message.create({
      data: {
        text: msg.text,
        room: { connect: { id: parseInt(socket.currentRoom) } },
        user: { connect: { id: socket.userId } }
      }
    });
    //Emits chat message to all users in the room
    io.to(socket.currentRoom.toString()).emit("chat message", {
      user: socket.username,
      text: msg.text,
      roomId: socket.currentRoom
    });
  });

  //Join room, and update chat history
  socket.on('join room', async (roomId) => {
    socket.currentRoom = roomId;
    socket.join(roomId.toString());
    const messages = await prisma.message.findMany({
      where: { roomId: parseInt(roomId) },
      orderBy: { createdAt: "asc" },
      include: { user: true }
    });
    socket.emit('chat history', {
      roomId: parseInt(roomId),
      messages: messages.map(m => ({
        user: m.user.username,
        text: m.text,
        roomId: m.roomId,
        createdAt: m.createdAt
      }))
    });
  });

  //Disconnect
  socket.on('disconnect', async () => {
    if (socket.username) {
      const set = userSockets.get(socket.username);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          await prisma.user.update({
            where: { username: socket.username },
            data: { status: "offline" }
          });
          broadcastUserStatus();
        }
      }
    }
    if (socket.currentRoom) {
      io.to(socket.currentRoom).emit('message', {
        user: 'admin',
        text: `${socket.username || socket.id} has disconnected.`
      });
    }
  });

  //User status ping logic
  socket.on('ping', async ({ username }) => {
    if (!username) return;
    userPings.set(username, Date.now());
    await prisma.user.update({
      where: { username },
      data: { status: "online" }
    });
    broadcastUserStatus();
  });

  //Make sure at least one user exists to be the creator
  let creator = await prisma.user.findFirst();
  if (!creator) {
    creator = await prisma.user.create({
      data: { username: "admin", password: await bcrypt.hash("adminpass", 10) }
    });
  }
});

//Broadcast user status to all connected users
async function broadcastUserStatus() {
  const users = await prisma.user.findMany();
  io.emit("user status update", users.map(u => ({
    username: u.username,
    status: u.status || "offline"
  })));
}

//On server start, ensure a Home room exists
async function ensureHomeRoom() {
  let creator = await prisma.user.findFirst();
  if (!creator) {
    creator = await prisma.user.create({
      data: { username: "admin", password: await bcrypt.hash("adminpass", 10) }
    });
  }
  let homeRoom = await prisma.room.findUnique({ where: { name: "Home" } });
  if (!homeRoom) {
    homeRoom = await prisma.room.create({
      data: {
        name: "Home",
        creator: { connect: { id: creator.id } },
        members: { connect: { id: creator.id } }
      }
    });
  }
}
ensureHomeRoom();

// Start the server, listening on all network interfaces
const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Socket.io server running on port ${PORT} (bound to 0.0.0.0)`);
});

//Note: Ensure your firewall allows incoming connections on PORT 3001 if accessing from other devices.
//Also, ensure that your Next.js frontend is configured to connect to the correct IP address of this server.
//I had to use not local host but my IPv4 address with port 3000 to get this to run