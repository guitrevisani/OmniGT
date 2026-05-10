// src/app/api/admin/confirm-payment/route.js
//
// Endpoint protegido para confirmação manual de pagamento.
// Chamado pela Cloudflare Function após validação da ADMIN_KEY.
// Atualiza status do registro, vincula room_partner se necessário,
// e dispara email de confirmação via ZeptoMail.

import { NextResponse } from "next/server";
import { query }        from "@/lib/db";

export const runtime = "nodejs";

const ALLOWED_ORIGIN = "https://camps.treine.com.gt";

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin",  ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

// ── GET — lista inscritos para o painel admin ─────────────────────────────────

export async function GET(request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.PROVIDER_SECRET}`) {
    return cors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const result = await query(
    `SELECT
       id, firstname, lastname, email, option,
       accommodation, status,
       extra->>'shirt_size' AS shirt_size,
       room_partner,
       created_at
     FROM registrations
     WHERE status IN ('pending','confirmed')
     ORDER BY status ASC, created_at ASC`
  );

  // Monta txid para cada inscrito
  const rows = result.rows.map(r => ({
    ...r,
    txid: buildTxId("recon_letape26", r.id, r.option),
  }));

  return cors(NextResponse.json({ registrations: rows }));
}

// ── POST — confirma pagamento ─────────────────────────────────────────────────

export async function POST(request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.PROVIDER_SECRET}`) {
    return cors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const { registration_id, method } = await request.json();

  if (!registration_id) {
    return cors(NextResponse.json({ error: "registration_id é obrigatório" }, { status: 400 }));
  }

  // Busca registro
  const regResult = await query(
    `SELECT id, firstname, lastname, email, option,
            accommodation, room_partner, status
     FROM registrations WHERE id = $1`,
    [registration_id]
  );

  if (regResult.rows.length === 0) {
    return cors(NextResponse.json({ error: "Registro não encontrado" }, { status: 404 }));
  }

  const reg = regResult.rows[0];

  if (reg.status === "confirmed") {
    return cors(NextResponse.json({ error: "Pagamento já confirmado" }, { status: 409 }));
  }

  // Confirma registro principal
  await query(
    `UPDATE registrations
     SET status = 'confirmed',
         payment_method = $2,
         confirmed_at   = now(),
         updated_at     = now()
     WHERE id = $1`,
    [registration_id, method || "manual"]
  );

  // Confirma room_partner atleta se existir
  const partner = reg.room_partner;
  if (partner?.id) {
    await query(
      `UPDATE registrations
       SET status = 'confirmed',
           payment_method = $2,
           confirmed_at   = now(),
           updated_at     = now()
       WHERE id = $1 AND status != 'confirmed'`,
      [partner.id, method || "manual"]
    );
  }

  // Dispara email de confirmação
  let emailSent = false;
  if (reg.email) {
    emailSent = await sendConfirmationEmail(reg);
  }

  return cors(NextResponse.json({
    ok:         true,
    name:       `${reg.firstname} ${reg.lastname}`,
    option:     reg.option,
    email_sent: emailSent,
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTxId(slug, id, option) {
  const s = slug.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 20);
  const n = String(id).padStart(4, "0").substring(0, 4);
  const c = (option || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 3);
  return `${s}${n}${c}`;
}

async function sendConfirmationEmail(reg) {
  const optionLabels = {
    "1d": "Reconhecimento · 1 dia · 13/11",
    "2d": "Camp · 2 dias · 12 e 13/11",
  };

  const optionLabel = optionLabels[reg.option] || reg.option;

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:2rem 0">
        <tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#0b1a3b;border-radius:4px;overflow:hidden">

            <!-- Header -->
            <tr>
              <td style="padding:2.5rem 2rem;border-bottom:1px solid rgba(244,230,191,0.1)">
                <p style="margin:0;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#e8a020;font-family:Arial,sans-serif">Jordan Camp 2026</p>
                <h1 style="margin:.75rem 0 0;font-size:32px;font-weight:700;color:#f4e6bf;letter-spacing:-0.5px;line-height:1.1">
                  Inscrição confirmada!
                </h1>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:2rem">
                <p style="margin:0 0 1.5rem;color:rgba(244,230,191,0.7);font-size:15px;line-height:1.6">
                  Olá, <strong style="color:#f4e6bf">${reg.firstname}</strong>! Seu pagamento foi confirmado e sua vaga no Jordan Camp 2026 está garantida.
                </p>

                <!-- Resumo -->
                <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(244,230,191,0.05);border:1px solid rgba(244,230,191,0.1);margin-bottom:1.5rem">
                  <tr>
                    <td style="padding:1.25rem">
                      <p style="margin:0 0 .75rem;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#e8a020">Sua inscrição</p>
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding:.4rem 0;font-size:13px;color:rgba(244,230,191,0.5);width:45%">Opção</td>
                          <td style="padding:.4rem 0;font-size:13px;color:#f4e6bf">${optionLabel}</td>
                        </tr>
                        ${reg.accommodation ? `
                        <tr>
                          <td style="padding:.4rem 0;font-size:13px;color:rgba(244,230,191,0.5)">Acomodação</td>
                          <td style="padding:.4rem 0;font-size:13px;color:#f4e6bf">${reg.accommodation === "individual" ? "Individual" : "Compartilhada"}</td>
                        </tr>` : ""}
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Próximos passos -->
                <p style="margin:0 0 .75rem;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#e8a020">Próximos passos</p>
                <p style="margin:0 0 .5rem;color:rgba(244,230,191,0.7);font-size:14px;line-height:1.6">
                  Em breve você receberá o link do grupo de WhatsApp do Jordan Camp 2026 com todas as informações sobre logística, equipamentos e programa.
                </p>
                <p style="margin:1rem 0 0;color:rgba(244,230,191,0.7);font-size:14px;line-height:1.6">
                  Qualquer dúvida, responda este email ou fale pelo WhatsApp:
                  <a href="https://wa.me/5511956384365" style="color:#e8a020;text-decoration:none">+55 11 95638-4365</a>
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:1.5rem 2rem;border-top:1px solid rgba(244,230,191,0.1)">
                <p style="margin:0;font-size:12px;color:rgba(244,230,191,0.3);line-height:1.6">
                  JordanCamp 2026 · desenvolvido por
                  <a href="https://treine.com.gt" style="color:rgba(244,230,191,0.4);text-decoration:none">treine.com.gt</a>
                </p>
              </td>
            </tr>

          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  try {
    const res = await fetch("https://api.zeptomail.com/v1.1/email", {
      method: "POST",
      headers: {
        "Accept":        "application/json",
        "Content-Type":  "application/json",
        "Authorization": `Zoho-enczapikey ${process.env.ZEPTOMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        from: {
          address: "gt@treine.com.gt",
          name:    "JordanCamp 2026",
        },
        to: [{
          email_address: {
            address: reg.email,
            name:    `${reg.firstname} ${reg.lastname}`,
          },
        }],
        subject: "✓ Inscrição confirmada — Jordan Camp 2026",
        htmlbody: html,
      }),
    });

    return res.ok;
  } catch (err) {
    console.error("[confirm-payment] Erro ao enviar email:", err);
    return false;
  }
}
