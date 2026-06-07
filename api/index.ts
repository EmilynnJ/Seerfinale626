/**
 * Vercel Serverless Function — wraps the Express API.
 *
 * All /api/* requests route here. Static imports of the compiled server
 * keep the cold start simple and let Vercel's bundler trace the files.
 *
 * Note: WebSocket features (real-time billing, live status) require a
 * persistent server. Those are handled by the standalone server on Fly.io;
 * this function serves the REST API only. Client falls back to polling for
 * live reader status when WS is unavailable.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

let app: express.Application | null = null;

function createApp() {
  if (app) return app;

  // Require the compiled server output lazily, INSIDE createApp (which the
  // handler calls within a try/catch). config.js validates env vars on load
  // and throws if any are missing; doing this here means that failure surfaces
  // as a readable JSON 500 (naming the missing variable) instead of an
  // uncatchable process.exit / FUNCTION_INVOCATION_FAILED at module load.
  // Requires `npm run build` to have produced server/dist (per vercel.json).
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { config } = require('../server/dist/src/config.js');
  const { generalLimiter, webhookLimiter } = require('../server/dist/src/middleware/rate-limit.js');
  const { globalErrorHandler } = require('../server/dist/src/middleware/error-handler.js');
  const authRoutes = require('../server/dist/src/routes/auth.js').default;
  const userRoutes = require('../server/dist/src/routes/users.js').default;
  const readingRoutes = require('../server/dist/src/routes/readings.js').default;
  const paymentRoutes = require('../server/dist/src/routes/payments.js').default;
  const forumRoutes = require('../server/dist/src/routes/forum.js').default;
  const adminRoutes = require('../server/dist/src/routes/admin.js').default;
  const transactionRoutes = require('../server/dist/src/routes/transactions.js').default;
  const webhookRoutes = require('../server/dist/src/routes/webhooks.js').default;
  const applicationRoutes = require('../server/dist/src/routes/applications.js').default;
  const newsletterRoutes = require('../server/dist/src/routes/newsletter.js').default;
  const messageRoutes = require('../server/dist/src/routes/messages.js').default;
  /* eslint-enable @typescript-eslint/no-require-imports */

  app = express();

  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors({
      origin: config.corsOrigin.split(',').map((s: string) => s.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.use(generalLimiter);

  // Stripe webhook paths must use the raw body — mount rate limiter before JSON.
  app.use('/api/payments/webhook', webhookLimiter);
  app.use('/api/webhooks/stripe', webhookLimiter);

  // JSON parsing for everything except Stripe webhook (signature needs raw body)
  app.use((req, res, next) => {
    if (req.path === '/api/payments/webhook' || req.path === '/api/webhooks/stripe') {
      return next();
    }
    express.json({ limit: '2mb' })(req, res, next);
  });
  app.use(express.urlencoded({ extended: false }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      runtime: 'vercel-serverless',
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', userRoutes);
  app.use('/api/readings', readingRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/forum', forumRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/newsletter', newsletterRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/reader-applications', applicationRoutes);
  app.use('/api', transactionRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(globalErrorHandler);

  return app;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const expressApp = createApp();
    return expressApp(req as unknown as express.Request, res as unknown as express.Response);
  } catch (err) {
    // Surface boot errors (e.g. missing/invalid env vars from config.js) as a
    // readable 500 JSON instead of a generic FUNCTION_INVOCATION_FAILED crash,
    // so the exact misconfiguration is visible in the API response.
    console.error('[api] createApp failed:', err);
    res.status(500).json({
      error: 'API boot failure',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
}
