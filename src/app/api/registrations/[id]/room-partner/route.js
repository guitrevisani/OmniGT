// src/app/api/registrations/[id]/room-partner/route.js
import { NextResponse } from "next/server";
import { query }        from "@/lib/db";

export const runtime = "nodejs";

const ALLOWED_ORIGIN = "https://camps.treine.com.gt";

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin",  ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "PATCH, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function PATCH(request, { params }) {
  const { id }         = await params;
  const { room_partner } = await request.json();

  if (!id || !room_partner) {
    return cors(NextResponse.json({ error: "id e room_partner são obrigatórios" }, { status: 400 }));
  }

  await query(
    `UPDATE registrations SET room_partner = $1, updated_at = now() WHERE id = $2`,
    [JSON.stringify(room_partner), Number(id)]
  );

  return cors(NextResponse.json({ ok: true }));
}
