// /src/app/api/events/route.js
import { query } from "@/lib/db";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    let sql = "SELECT id, slug, name, start_date, end_date FROM events";
    const params = [];

    if (slug) {
      sql += " WHERE slug = $1 AND is_active = true";
      params.push(slug);
    } else {
      sql += " ORDER BY created_at DESC";
    }

    const res = await query(sql, params);

    if (slug && res.rows.length === 0) {
      return new Response(
        JSON.stringify({ error: "Evento não encontrado" }),
        { status: 404 }
      );
    }

    const events = res.rows.map((r) => ({
      ...r,
      start_date: r.start_date.toISOString().split("T")[0],
      end_date: r.end_date.toISOString().split("T")[0],
    }));

    // Se slug informado, retorna apenas o objeto do evento
    return new Response(
      JSON.stringify(slug ? events[0] : { events }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Erro ao listar eventos:", err);
    return new Response("Erro ao listar eventos", { status: 500 });
  }
}
