import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env.local'
  );
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections from growing exponentially
 * during API Route usage.
 */
let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

async function dbConnect() {
  // Reuse a live connection. If a previously-cached connection has since
  // dropped (readyState 1 = connected), discard it so we reconnect below
  // instead of running queries against a dead socket.
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }
  if (cached.conn) {
    cached.conn = null;
    cached.promise = null;
  }

  if (!cached.promise) {
    const opts = {
      // Queue queries until the initial connection completes rather than
      // throwing instantly. Without this, the first request after a cold
      // `npm run dev` can fire before Mongoose finishes connecting to the
      // Atlas replica set and fail with "...before initial connection is
      // complete" — the intermittent login error that a restart "fixes".
      bufferCommands: true,
      // Give up (and let the next request retry) after 10s of not finding a
      // reachable server, instead of the 30s default.
      serverSelectionTimeoutMS: 10000,
      // --- Connection pool (throughput + latency) ---------------------------
      // Keep a warm pool of sockets so concurrent API requests reuse open
      // connections instead of each paying the TCP+TLS handshake to Atlas.
      // minPoolSize keeps a few sockets primed so the first request after an
      // idle period doesn't stall — the other half of the "slow/failed login".
      maxPoolSize: 10,
      minPoolSize: 2,
      // Recycle idle sockets after 60s so we don't hold dead connections.
      maxIdleTimeMS: 60000,
      // Fail a stuck operation in a reasonable time instead of hanging.
      socketTimeoutMS: 45000,
      // Prefer IPv4 — some hosts resolve Atlas SRV to an IPv6 address that
      // then times out, surfacing as a slow/failed first request.
      family: 4,
      // Retry a transient write once (Atlas replica-set failover) instead of
      // surfacing a one-off error to the user.
      retryWrites: true,
    };

    cached.promise = mongoose.connect(MONGODB_URI as string, opts).then((m) => m);
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    // Never cache a rejected promise — the next request should retry cleanly.
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default dbConnect;
