import { NextRequest } from 'next/server';

/**
 * Backend-for-frontend proxy.
 *
 * The browser never talks to the API directly. Everything goes through this
 * same-origin route, which means:
 *   - the API's address is server-side configuration, not something shipped in
 *     the bundle;
 *   - the session cookie is same-origin and httpOnly, so page JavaScript cannot
 *     read it and there is no CORS credential dance;
 *   - no API key, of any kind, is ever within reach of the client.
 *
 * It forwards only the headers it needs, and only to the one configured host.
 */

const API_URL = process.env['SERVER_API_URL'] ?? 'http://localhost:4000';

export const dynamic = 'force-dynamic';

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const suffix = path.map(encodeURIComponent).join('/');
  const search = request.nextUrl.search;
  const target = `${API_URL}/api/${suffix}${search}`;

  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const accept = request.headers.get('accept');
  if (accept) headers.set('accept', accept);

  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { error: { code: 'api_unreachable', message: 'Dial’s server is not responding.' } },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get('content-type');
  if (upstreamType) responseHeaders.set('content-type', upstreamType);
  // Session cookies are minted by the API and must reach the browser.
  const setCookie = upstream.headers.getSetCookie?.() ?? [];
  for (const value of setCookie) responseHeaders.append('set-cookie', value);
  responseHeaders.set('cache-control', 'no-store');

  // Server-Sent Events must stream rather than buffer.
  if (upstreamType?.includes('text/event-stream')) {
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path);
}
export async function POST(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path);
}
export async function PATCH(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path);
}
export async function DELETE(request: NextRequest, ctx: Context) {
  return proxy(request, (await ctx.params).path);
}
