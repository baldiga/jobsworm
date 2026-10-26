import { NextResponse } from "next/server";
import { createActionClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const supabase = await createActionClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
