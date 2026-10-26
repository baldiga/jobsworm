import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth cookie on navigation so Server Components
 * always see a valid session. Does not gate any route.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

/*
 * `hive/` is excluded deliberately.
 *
 * It is the PostHog proxy, and it is the highest-frequency path on the site:
 * one request per pageview, plus one per event. Without this exclusion every
 * one of them would run `supabase.auth.getUser()` above — a network round trip
 * to Supabase, for a beacon that needs no session and returns no HTML. That is
 * the analytics tail wagging the auth dog.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|hive/|.*\.(?:png|jpg|jpeg|svg|ico|webmanifest)$).*)",
  ],
};
