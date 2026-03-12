// /src/components/OneSignalInit.jsx
"use client";

import { useEffect, useRef } from "react";

/**
 * Inicialização global do OneSignal SDK.
 * Incluído no RootLayout — carrega uma única vez para toda a aplicação.
 * A segmentação por evento é feita via tags em cada dashboard.
 */
export default function OneSignalInit() {
  const initialized = useRef(false);

  useEffect(() => {
    const appId       = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    const safariWebId = process.env.NEXT_PUBLIC_ONESIGNAL_SAFARI_WEB_ID;

    if (!appId || initialized.current) return;
    initialized.current = true;

    const script = document.createElement("script");
    script.src   = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.defer = true;
    script.onload = () => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (OneSignal) => {
        await OneSignal.init({
          appId,
          ...(safariWebId ? { safari_web_id: safariWebId } : {}),
          notifyButton:               { enable: false }, // UI própria em cada dashboard
          allowLocalhostAsSecureOrigin: true,
        });
      });
    };
    document.head.appendChild(script);
  }, []);

  return null;
}
