import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase-config.js';
import { v4 as uuidv4 } from 'uuid';
import { setInterval } from 'timers'; // Add this to ensure we can use setInterval

// Initialize Express app
const app = express();
app.use(cors({
  origin: '*', // Adjust for production to specific frontend URL
}));
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*', // Adjust for production
    methods: ['GET', 'POST'],
  },
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  socket.on('join-room', async (roomId) => {
    try {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room: ${roomId}`);

      // Fetch code from Firestore
      const docRef = doc(db, 'codes', roomId);
      const docSnap = await getDoc(docRef);
      const code = docSnap.exists() ? docSnap.data().code : '';

      // Emit the loaded code to the client
      socket.emit('load-code', code);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', 'Failed to join room');
    }
  });

  socket.on('code-change', async ({ roomId, code }) => {
    try {
      // Save code to Firestore
      await setDoc(doc(db, 'codes', roomId), { code }, { merge: true });

      // Broadcast code change to other clients in the room
      socket.to(roomId).emit('code-change', code);
    } catch (error) {
      console.error('Error saving code:', error);
      socket.emit('error', 'Failed to save code');
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
  });
});

// REST routes
app.get('/api/code/:roomId', async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const docRef = doc(db, 'codes', roomId);
    const docSnap = await getDoc(docRef);
    const code = docSnap.exists() ? docSnap.data().code : '';
    res.json({ code });
  } catch (error) {
    console.error('Error fetching code:', error);
    res.status(500).json({ error: 'Failed to fetch code' });
  }
});

app.post('/api/code/:roomId', async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const { code } = req.body;
    await setDoc(doc(db, 'codes', roomId), { code }, { merge: true });
    res.json({ message: 'Code saved successfully' });
  } catch (error) {
    console.error('Error saving code:', error);
    res.status(500).json({ error: 'Failed to save code' });
  }
});

app.get('/api/keep-alive', (req, res) => {
  res.json({ message: 'Server is alive' });
});

// Generate a new random route
app.get('/api/new', (req, res) => {
  const roomId = uuidv4();
  res.json({ roomId });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});



// Call keep-alive API every 14 minutes
setInterval(() => {
  http.get(`http://${process.env.VITE_APP_BACKEND_URL}/api/keep-alive`, (res) => {
    console.log('Keep-alive ping sent');
  }).on('error', (e) => {
    console.error(`Error with keep-alive request: ${e.message}`);
  });
}, 14 * 60 * 1000);
