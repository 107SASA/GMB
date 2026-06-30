import dbConnect from '@/lib/mongodb';
import ConversationThread from '@/models/ConversationThread';
import mongoose from 'mongoose';
import { requireBusinessContext } from '@/lib/tenant';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 2500;
const MAX_DURATION_MS  = 55_000; // stay under 60 s serverless limit

export async function GET(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const businessId = new mongoose.Types.ObjectId(ctx.businessId);
  const enc        = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client already gone
        }
      };

      // Send initial heartbeat so browser confirms the connection
      send('connected', { ts: Date.now() });

      let lastCheck  = new Date();
      const deadline = Date.now() + MAX_DURATION_MS;

      await dbConnect();

      while (!req.signal.aborted && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        if (req.signal.aborted) break;

        try {
          const since = lastCheck;
          lastCheck   = new Date();

          const updated = await ConversationThread.find({
            businessId,
            lastActivityAt: { $gt: since },
          })
            .populate('leadId', 'name phone source pipelineStage aiLeadScore')
            .sort({ lastActivityAt: -1 })
            .lean();

          if (updated.length > 0) {
            send('threads', updated);
          } else {
            // Heartbeat to keep the connection alive through proxies
            send('ping', { ts: Date.now() });
          }
        } catch (err) {
          console.error('[inbox/sse] poll error', err);
        }
      }

      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      // Browser closed — nothing to clean up
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}
