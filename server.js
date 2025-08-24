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

// Handle socket.io connections
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  // Register user credentials to the server (persistent, hashed)
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
    // 'user connected' message to all users in the current room
    io.to(currentRoom).emit('chat message', msg);
    // Store the message in the chat history
    if (!chatHistory[currentRoom]) {
      chatHistory[currentRoom] = [];
    }
    chatHistory[currentRoom].push(msg);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    if (currentRoom) {
      io.to(currentRoom).emit('message', {
        user: 'admin',
        text: `${socket.username} has disconnected.`
      });
    }

    if (socket.username) {
      db.read();
      const user = db.data.users.find(u => u.username === socket.username);
      if (user) {
        user.status = "offline";
        db.write();
      }
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
    user.status = "online";
    await db.write();
    socket.emit('login success', { username });
  });

  // Room and chat logic
  let currentRoom = null;

    socket.on('join room', (room) => {
  if (currentRoom) {
    // Notify room that user left
    io.to(currentRoom).emit('message', {
      user: 'admin',
      text: `${socket.username} has left the room.`
    });
    socket.leave(currentRoom);
  }
  currentRoom = room;
  socket.join(room);

  // Welcome to the user
  socket.emit('message', {
    user: 'admin',
    text: `${socket.username}, welcome to room ${room}.`
  });

  // Public join message to the room
  socket.to(room).emit('message', {
    user: 'admin',
    text: `${socket.username} has joined the room.`
  });

  // Send chat history to the user when they join a room
  if (chatHistory[room]) {
    socket.emit('chat history', chatHistory[room]);
  }
});
});

// Start the server
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});