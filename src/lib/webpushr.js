// src/lib/webpushr.js
//
// Integração Webpushr no frontend.
//
// Como funciona:
//   1. O script do Webpushr é carregado no <head> (snippet padrão do painel)
//   2. Quando o subscriber dá permissão, o Webpushr chama _webpushrScriptReady()
//   3. Essa função chama initWebpushr(), que:
//      a) Busca o SID do browser via webpushr('fetch_id', ...)
//      b) Envia o SID ao backend via POST /api/push/register
//      c) O backend retorna os atributos (strava_id, eventos, roles...)
//      d) Aplica os atributos no Webpushr via webpushr('attributes', ...)
//
// Uso: chame initWebpushr() dentro de _webpushrScriptReady() no seu layout global
// ou em qualquer página pós-login.
//
// Exemplo no seu layout ou page:
//
//   <script
//     dangerouslySetInnerHTML={{
//       __html: `
//         function _webpushrScriptReady() {
//           if (typeof initWebpushr === 'function') initWebpushr();
//         }
//       `
//     }}
//   />

/**
 * Inicializa o Webpushr para o usuário autenticado.
 * Deve ser chamado dentro de _webpushrScriptReady() ou após o SDK carregar.
 */
export async function initWebpushr() {
  if (typeof webpushr === "undefined") {
    console.warn("[Webpushr] SDK não carregado ainda.");
    return;
  }

  try {
    // 1. Obtém o SID do subscriber atual no browser
    const subscriberId = await fetchWebpushrId();
    if (!subscriberId) {
      // Usuário não deu permissão de push ainda — normal, não é erro
      return;
    }

    // 2. Registra o SID no backend e obtém os atributos do atleta
    const res = await fetch("/api/push/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        platform:      detectPlatform(),
      }),
    });

    if (!res.ok) {
      console.warn("[Webpushr] Erro ao registrar subscriber:", res.status);
      return;
    }

    const data = await res.json();

    // 3. Aplica os atributos via JS do Webpushr
    //    É assim que o strava_id, eventos e roles ficam associados ao SID
    if (data.attributes && Object.keys(data.attributes).length > 0) {
      webpushr("attributes", data.attributes);
    }

  } catch (err) {
    console.error("[Webpushr] Erro na inicialização:", err);
  }
}

/**
 * Retorna o subscriber ID (SID) do browser atual.
 * Retorna null se o usuário não tiver dado permissão.
 */
function fetchWebpushrId() {
  return new Promise((resolve) => {
    try {
      webpushr("fetch_id", function (sid) {
        resolve(sid || null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Detecta a plataforma do subscriber.
 */
function detectPlatform() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "web";
}
