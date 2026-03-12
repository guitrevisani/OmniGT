// /src/lib/events.js
import { query } from "@/lib/db";

/**
 * Busca eventos no banco.
 * @param {string} [slug] - se fornecido, retorna o evento com esse slug
 * @returns {Promise<Object|Object[]>} - um evento ou lista de eventos
 */
export async function getEvent(slug) {
  try {
    let sql = `
      SELECT id, slug, name, start_date, end_date, is_active, access_mode
      FROM events
      WHERE is_active = true
    `;
    const params = [];

    if (slug) {
      sql += " AND slug = $1";
      params.push(slug);
    } else {
      // Sem slug, filtra apenas eventos públicos
      sql += " AND access_mode != 'invite_only'";
    }

    sql += " ORDER BY created_at DESC";

    const res = await query(sql, params);

    if (!slug) {
      // Retorna todos os eventos públicos ativos
      return res.rows.map(r => ({
        ...r,
        start_date: r.start_date.toISOString().split("T")[0],
        end_date: r.end_date.toISOString().split("T")[0],
      }));
    }

    // Retorna um único evento ou null
    if (res.rows.length === 0) return null;

    const event = res.rows[0];
    return {
      ...event,
      start_date: event.start_date.toISOString().split("T")[0],
      end_date: event.end_date.toISOString().split("T")[0],
    };
  } catch (err) {
    console.error("Erro ao buscar evento:", err);
    return null;
  }
}
