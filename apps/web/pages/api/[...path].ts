/**
 * The API inside the dashboard project (Vercel): every /api/* request is handed to the Express app from apps/api.
 * Not used when API_INTERNAL_URL is set (local dev, separate server) – next.config.ts then rewrites /api/v1/* to that server first.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getApi } from '@chheda/api/serverless';

export const config = {
  api: { bodyParser: false, externalResolver: true, responseLimit: false },   // Express parses bodies itself (webhook signatures need the raw bytes)
  maxDuration: 60,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const app = await getApi();
  app(req, res);
}
