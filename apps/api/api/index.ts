/**
 * Vercel entry point for a stand-alone API project (Root Directory apps/api): the whole Express API as one serverless function.
 * The usual setup runs the API inside the dashboard project instead – see apps/web/pages/api/[...path].ts and docs/DEPLOY-VERCEL.md.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getApi } from '../src/serverless';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApi();
  app(req, res);
}
