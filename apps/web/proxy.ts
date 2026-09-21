import { NextResponse, type NextRequest } from 'next/server';

// Cheap gate: no session cookie → login page. The API still verifies every request.
export function proxy(req: NextRequest) {
  // DEV ONLY: with DEV_AUTO_LOGIN=1 (and the API's DEV_AUTO_LOGIN_EMAIL) there is no login screen
  if (process.env.DEV_AUTO_LOGIN === '1' && process.env.NODE_ENV !== 'production') return NextResponse.next();
  const has = req.cookies.has('chheda_session');
  const isLogin = req.nextUrl.pathname.startsWith('/login');
  if (!has && !isLogin) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next|favicon.ico).*)'] };
