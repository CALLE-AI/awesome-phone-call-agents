import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/drugs";

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ products: [], suggestions: [] });
  return NextResponse.json(await searchProducts(q));
}
