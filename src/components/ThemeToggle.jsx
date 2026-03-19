// src/components/ThemeToggle.jsx
//
// Componente de alternância de tema.
// Opções: claro | escuro | automático (segue o sistema)
//
// Persiste preferência em localStorage sob a chave 'ogt-theme'.
// Aplica data-theme no elemento <html>.
//
// Uso:
//   <ThemeToggle />
//
// Evolução futura: mover persistência para preferências do usuário no banco.

"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "ogt-theme";

const OPTIONS = [
  { value: "light", label: "Claro" },
  { value: "auto",  label: "Auto"  },
  { value: "dark",  label: "Escuro" },
];

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === "auto") {
    html.removeAttribute("data-theme");
  } else {
    html.setAttribute("data-theme", theme);
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState("auto");

  // Inicializar com preferência salva
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) || "auto";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  function handleChange(value) {
    setTheme(value);
    localStorage.setItem(STORAGE_KEY, value);
    applyTheme(value);
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Tema">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          className={`theme-toggle__btn${theme === opt.value ? " theme-toggle__btn--active" : ""}`}
          onClick={() => handleChange(opt.value)}
          aria-pressed={theme === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
