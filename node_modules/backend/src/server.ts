import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './models/db';
import { setupRoutes } from './controllers/api';
import { initCronJobs } from './utils/cron';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend interactions
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Base diagnostic endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

async function startServer() {
  try {
    // 1. Initialize Database connection (handles MongoDB Memory Server fallback internally)
    await connectDB();

    // 2. Create HTTP & Socket.io server
    const server = http.createServer(app);
    const io = new Server(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    // Socket connection logging
    io.on('connection', (socket) => {
      console.log(`[SOCKET] Client connected: ${socket.id}`);
      socket.on('disconnect', () => {
        console.log(`[SOCKET] Client disconnected: ${socket.id}`);
      });
    });

    // 3. Register controllers & API routers
    setupRoutes(app, io);

    // 4. Initialize real-time cron jobs
    initCronJobs(io);

    // 5. Start listening
    server.listen(PORT, () => {
      console.log(`[SERVER] KeyRing Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[SERVER] Critical server initialization failure:', err);
    process.exit(1);
  }
}

startServer();
