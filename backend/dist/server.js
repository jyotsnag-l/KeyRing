"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./models/db");
const api_1 = require("./controllers/api");
const cron_1 = require("./utils/cron");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// Enable CORS for frontend interactions
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express_1.default.json());
// Base diagnostic endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date() });
});
async function startServer() {
    try {
        // 1. Initialize Database connection (handles MongoDB Memory Server fallback internally)
        await (0, db_1.connectDB)();
        // 2. Create HTTP & Socket.io server
        const server = http_1.default.createServer(app);
        const io = new socket_io_1.Server(server, {
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
        (0, api_1.setupRoutes)(app, io);
        // 4. Initialize real-time cron jobs
        (0, cron_1.initCronJobs)(io);
        // 5. Start listening
        server.listen(PORT, () => {
            console.log(`[SERVER] KeyRing Backend running on http://localhost:${PORT}`);
        });
    }
    catch (err) {
        console.error('[SERVER] Critical server initialization failure:', err);
        process.exit(1);
    }
}
startServer();
