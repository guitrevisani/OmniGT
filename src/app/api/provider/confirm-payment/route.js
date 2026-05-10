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

  const optionLabel    = optionLabels[reg.option] || reg.option;
  const accommodLabel  = reg.accommodation === "single" ? "Individual" : reg.accommodation === "double" ? "Compartilhada" : "N/A";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede6;padding:2rem 0">
    <tr><td align="center" style="padding:0 1rem">

      <!-- Card -->
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

        <!-- Header navy -->
        <tr>
          <td style="background:#0b1a3b;padding:2.5rem 2rem 2rem">
            <table cellpadding="0" cellspacing="0" style="margin-bottom:.75rem">
              <tr>
                <td style="vertical-align:middle;padding-right:.75rem">
                  <img src="https://camps.treine.com.gt/img/jordancamp_icon.png" alt="Jordan Camp 2026" width="48" height="48" style="display:block;border:0;border-radius:4px" />
                </td>
                <td style="vertical-align:middle">
                  <p style="margin:0;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#e8a020;font-family:Arial,sans-serif">Jordan Camp 2026</p>
                </td>
              </tr>
            </table>
            <h1 style="margin:0;font-size:28px;font-weight:700;color:#f4e6bf;line-height:1.15;letter-spacing:-.5px">Inscrição confirmada!</h1>
          </td>
        </tr>

        <!-- Faixa âmbar -->
        <tr>
          <td style="background:#e8a020;padding:.65rem 2rem">
            <p style="margin:0;font-size:13px;color:#0b1a3b;font-weight:700">
              Sua vaga no Jordan Camp 2026 está garantida.
            </p>
          </td>
        </tr>

        <!-- Body claro -->
        <tr>
          <td style="padding:2rem 2rem 1.5rem">
            <p style="margin:0 0 1.5rem;color:#333;font-size:15px;line-height:1.7">
              Olá, <strong>${reg.firstname}</strong>! Recebemos a confirmação do seu pagamento.
              Abaixo estão os dados da sua inscrição.
            </p>

            <!-- Tabela de resumo -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0d9cc;margin-bottom:1.75rem">
              <tr>
                <td colspan="2" style="background:#f7f3ec;padding:.85rem 1rem;border-bottom:1px solid #e0d9cc">
                  <p style="margin:0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9a7d3a;font-weight:700">Sua inscrição</p>
                </td>
              </tr>
              <tr>
                <td style="padding:.6rem 1rem;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em;width:40%;border-bottom:1px solid #f0ede6">Opção</td>
                <td style="padding:.6rem 1rem;font-size:13px;color:#1a1a1a;font-weight:600;border-bottom:1px solid #f0ede6">${optionLabel}</td>
              </tr>
              ${accommodLabel ? `<tr>
                <td style="padding:.6rem 1rem;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em;width:40%;border-bottom:1px solid #f0ede6">Acomodação</td>
                <td style="padding:.6rem 1rem;font-size:13px;color:#1a1a1a;font-weight:600;border-bottom:1px solid #f0ede6">${accommodLabel}</td>
              </tr>` : ""}
              <tr>
                <td style="padding:.6rem 1rem;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Nome</td>
                <td style="padding:.6rem 1rem;font-size:13px;color:#1a1a1a;font-weight:600">${reg.firstname} ${reg.lastname}</td>
              </tr>
            </table>

            <!-- Grupo WhatsApp -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ec;border:1px solid #e0d9cc;margin-bottom:1.75rem">
              <tr>
                <td style="padding:1.25rem 1.5rem">
                  <p style="margin:0 0 .5rem;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9a7d3a;font-weight:700">Próximo passo</p>
                  <p style="margin:0 0 1rem;font-size:14px;color:#333;line-height:1.6">
                    Entre no grupo de WhatsApp do Jordan Camp 2026 para receber todas as informações sobre logística, equipamentos e programa.
                  </p>
                  <a href="https://chat.whatsapp.com/CTiD5zY0onFF0ec3Gt9Pd0"
                     style="display:inline-block;background:#25d366;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;padding:.7rem 1.5rem;border-radius:2px;letter-spacing:.05em">
                    Entrar no grupo →
                  </a>
                </td>
              </tr>
            </table>

            <!-- Contato -->
            <p style="margin:0;font-size:13px;color:#666;line-height:1.7">
              Dúvidas? Responda este email ou fale pelo WhatsApp:
              <a href="https://wa.me/5511956384365" style="color:#9a7d3a;text-decoration:none;font-weight:700">+55 11 95638-4365</a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f7f3ec;padding:1.5rem 2rem;border-top:1px solid #e0d9cc">

            <!-- Info -->
            <p style="margin:0 0 .25rem;font-size:13px;font-weight:700;color:#333;letter-spacing:.03em">JordanCamp 2026</p>
            <p style="margin:0 0 .75rem;font-size:12px;color:#666;line-height:1.6">
              Desenvolvido para a comunidade
              <a href="https://www.instagram.com/valepedal" style="color:#333;text-decoration:none;font-weight:700">@ValePedal</a>
              &nbsp;·&nbsp;
              <a href="mailto:gt@treine.com.gt" style="color:#666;text-decoration:underline">gt@treine.com.gt</a>
              &nbsp;·&nbsp;
              <a href="https://wa.me/5511956384365" style="color:#2CB742;text-decoration:none">WhatsApp</a>
            </p>

            <!-- Divisor -->
            <div style="border-top:1px solid #e0d9cc;margin:.75rem 0"></div>

            <!-- Apoio -->
            <p style="margin:0 0 .5rem;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#aaa">Apoio</p>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:.75rem">
              <tr>
                <td style="padding-right:1rem;vertical-align:middle">
                  <a href="https://www.cobix.com.br" target="_blank">
                    <img src="https://camps.treine.com.gt/img/cobix.png" alt="COBIX" width="115" height="40" style="display:block;border:0;filter:grayscale(1);opacity:.8" />
                  </a>
                </td>
                <td style="vertical-align:middle">
                  <a href="https://www.flwst.com.br" target="_blank">
                    <img src="https://camps.treine.com.gt/img/flwst.png" alt="FLWST" width="40" height="40" style="display:block;border:0;filter:grayscale(1);opacity:.8" />
                  </a>
                </td>
              </tr>
            </table>

            <!-- Realização -->
            <p style="margin:0 0 .5rem;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#aaa">Realização</p>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:1rem">
              <tr>
                <td style="padding-right:1rem;vertical-align:middle">
                  <a href="https://www.treine.com.gt" target="_blank">
                    <img src="https://camps.treine.com.gt/img/treine.png" alt="treine.com.gt" width="40" height="40" style="display:block;border:0" />
                  </a>
                </td>
                <td style="vertical-align:middle">
                  <a href="https://www.instagram.com/valepedal" target="_blank">
                    <img src="https://camps.treine.com.gt/img/valepedal.png" alt="ValePedal" width="40" height="40" style="display:block;border:0" />
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:11px;color:#bbb">© 2026 Todos os direitos reservados.</p>

          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;

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
          address: "jordancamp26@treine.com.gt",
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
