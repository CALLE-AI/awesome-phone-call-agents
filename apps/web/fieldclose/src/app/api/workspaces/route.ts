import { NextResponse } from "next/server";

import { readAuthenticatedActor } from "@/application/authentication";
import {
  ensurePersonalDemoWorkspace,
  listUserWorkspaces,
} from "@/application/workspaces";
import { getDatabase } from "@/persistence/database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await readAuthenticatedActor(request.headers);

  if (!actor) {
    return unauthorizedResponse();
  }

  const workspaces = await listUserWorkspaces(getDatabase().db, actor.userId);
  return NextResponse.json({ workspaces });
}

export async function POST(request: Request) {
  const actor = await readAuthenticatedActor(request.headers);

  if (!actor) {
    return unauthorizedResponse();
  }

  const workspace = await ensurePersonalDemoWorkspace(getDatabase().db, {
    id: actor.userId,
    name: actor.name,
  });

  return NextResponse.json({ workspace }, { status: 201 });
}

function unauthorizedResponse() {
  return NextResponse.json(
    { error: { code: "authentication_required" } },
    { status: 401 },
  );
}
