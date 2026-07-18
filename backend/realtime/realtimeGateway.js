const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const REALTIME_CHANNEL = process.env.REALTIME_REDIS_CHANNEL || 'vca:realtime';
const LOCAL_QUEUE_MODES = new Set(['local', 'memory', 'in-memory', 'inline']);

let ioInstance = null;
let redisPublisher = null;

function shouldUseRealtimeRedis() {
  const explicitSetting = String(process.env.REALTIME_REDIS_ENABLED || '')
    .trim()
    .toLowerCase();

  if (explicitSetting) {
    return ['1', 'true', 'yes', 'on'].includes(explicitSetting) && Boolean(process.env.REDIS_URL);
  }

  const queueMode = String(process.env.PROCESSING_QUEUE || 'redis').trim().toLowerCase();
  return Boolean(process.env.REDIS_URL) && !LOCAL_QUEUE_MODES.has(queueMode);
}

function createRealtimeRedisClient(createClient) {
  return createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries >= 3) return new Error('Realtime Redis nije dostupan.');
        return Math.min(250 * (2 ** retries), 2000);
      },
    },
  });
}

async function closeRedisClients(clients) {
  await Promise.allSettled(clients.map(async (client) => {
    if (client.isOpen) {
      await client.quit();
      return;
    }
    if (client.isReady) client.disconnect();
  }));
}

function emitEnvelope(io, message) {
  const envelope = message.envelope;
  for (const recipient of message.recipients || []) {
    io.to(`user:${recipient}`).emit('notification', envelope);
  }
  for (const role of message.roles || []) {
    io.to(`role:${role}`).emit('domain-event', envelope);
  }
}

async function configureRedis(io) {
  if (!shouldUseRealtimeRedis()) {
    console.log('Realtime koristi lokalni gateway; Redis adapter je isključen.');
    return;
  }

  let clients = [];

  try {
    const { createClient } = require('redis');
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pubClient = createRealtimeRedisClient(createClient);
    const subClient = pubClient.duplicate();
    const eventSubClient = pubClient.duplicate();
    clients = [pubClient, subClient, eventSubClient];

    for (const client of clients) {
      client.on('error', (error) => console.error('Realtime Redis error:', error.message));
    }

    await Promise.all([pubClient.connect(), subClient.connect(), eventSubClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    await eventSubClient.subscribe(REALTIME_CHANNEL, (raw) => {
      try {
        emitEnvelope(io, JSON.parse(raw));
      } catch (error) {
        console.error('Invalid realtime Redis message:', error.message);
      }
    });
    redisPublisher = pubClient;
    console.log('Realtime Redis adapter connected.');
  } catch (error) {
    await closeRedisClients(clients);
    console.error('Realtime Redis adapter unavailable; using local gateway:', error.message);
  }
}

function initializeRealtime(httpServer) {
  const io = new Server(httpServer, {
    path: '/api/v2/events',
    cors: { origin: true, credentials: true },
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token || !process.env.JWT_SECRET) return next(new Error('unauthorized'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch (error) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);
    socket.join(`role:${socket.user.role}`);
    socket.emit('realtime:ready', { connectedAt: new Date().toISOString() });
  });

  ioInstance = io;
  configureRedis(io).catch((error) => console.error('Realtime setup failed:', error));
  return io;
}

async function publishRealtimeEvent(message) {
  if (ioInstance) {
    emitEnvelope(ioInstance, message);
    return;
  }

  if (!shouldUseRealtimeRedis()) return;
  if (!redisPublisher) {
    const { createClient } = require('redis');
    redisPublisher = createRealtimeRedisClient(createClient);
    redisPublisher.on('error', (error) => console.error('Realtime publish error:', error.message));
    await redisPublisher.connect();
  }
  await redisPublisher.publish(REALTIME_CHANNEL, JSON.stringify(message));
}

module.exports = {
  initializeRealtime,
  publishRealtimeEvent,
};
