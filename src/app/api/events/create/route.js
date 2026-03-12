import { query } from "@/lib/db";

export async function POST(req) {
  try {
    const formData = await req.formData();
    const name = formData.get("name");
    const slug = formData.get("slug");
    const start_date = formData.get("start_date");
    const end_date = formData.get("end_date");

    if (!name || !slug || !start_date || !end_date) {
      return new Response("Dados incompletos", { status: 400 });
    }

    const res = await query(
      `INSERT INTO events (name, slug, start_date, end_date, is_active, created_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       RETURNING id, name, slug`,
      [name, slug, start_date, end_date]
    );

    return new Response(
      JSON.stringify({ success: true, event: res.rows[0] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response("Erro ao criar evento", { status: 500 });
  }
}
