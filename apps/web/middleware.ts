import { NextResponse, type NextRequest } from 'next/server';

// Cheap gate: no session cookie → login page. The API still verifies every request.
export function middleware(req: NextRequest) {
  const has = req.cookies.has('chheda_session');
  const isLogin = req.nextUrl.pathname.startsWith('/login');
  if (!has && !isLogin) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next|favicon.ico).*)'] };
