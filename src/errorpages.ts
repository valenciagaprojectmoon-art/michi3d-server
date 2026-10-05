/**
 * Páginas de error HTTP 4XX (y 500) del servidor, en español e inglés.
 *
 * Se muestran a quien abre el servidor en un navegador (cabecera Accept con text/html).
 * Las herramientas (curl, el panel de administrador) reciben JSON o texto plano.
 * El idioma sale de ?lang=es|en o, si no, de Accept-Language (por defecto español).
 */

import type { Lang } from "./protocol.js";

interface Copy {
  title: string;
  text: string;
}

const COPY: Record<number, Record<Lang, Copy>> = {
  400: {
    es: { title: "Petición incorrecta", text: "El servidor no pudo entender lo que enviaste. Revisa la dirección e inténtalo de nuevo." },
    en: { title: "Bad request", text: "The server could not understand what you sent. Check the address and try again." },
  },
  401: {
    es: { title: "No autorizado", text: "Necesitas una clave válida para ver esto." },
    en: { title: "Unauthorized", text: "You need a valid key to see this." },
  },
  403: {
    es: { title: "Acceso prohibido", text: "No tienes permiso para acceder a este recurso." },
    en: { title: "Forbidden", text: "You don't have permission to access this resource." },
  },
  404: {
    es: { title: "Página no encontrada", text: "Esta dirección no existe. Puede que el enlace esté mal escrito o que la página ya no esté." },
    en: { title: "Page not found", text: "This address doesn't exist. The link may be mistyped or the page may be gone." },
  },
  405: {
    es: { title: "Método no permitido", text: "Esta dirección no admite ese tipo de petición." },
    en: { title: "Method not allowed", text: "This address doesn't accept that kind of request." },
  },
  408: {
    es: { title: "Tiempo de espera agotado", text: "La petición tardó demasiado en llegar. Inténtalo de nuevo." },
    en: { title: "Request timeout", text: "The request took too long to arrive. Please try again." },
  },
  413: {
    es: { title: "Petición demasiado grande", text: "Lo que enviaste es demasiado grande para el servidor." },
    en: { title: "Payload too large", text: "What you sent is too large for the server." },
  },
  414: {
    es: { title: "Dirección demasiado larga", text: "La dirección que abriste es demasiado larga." },
    en: { title: "URI too long", text: "The address you opened is too long." },
  },
  429: {
    es: { title: "Demasiadas peticiones", text: "Has hecho demasiadas peticiones en poco tiempo. Espera un momento y vuelve a intentarlo." },
    en: { title: "Too many requests", text: "You've made too many requests in a short time. Wait a moment and try again." },
  },
  431: {
    es: { title: "Cabeceras demasiado grandes", text: "La petición incluye demasiados datos de cabecera." },
    en: { title: "Request header fields too large", text: "The request carries too much header data." },
  },
  500: {
    es: { title: "Error interno", text: "Algo falló en el servidor. Inténtalo de nuevo en un momento." },
    en: { title: "Internal error", text: "Something went wrong on the server. Please try again in a moment." },
  },
};

const BACK: Record<Lang, string> = { es: "Volver al juego", en: "Back to the game" };

export function isErrorStatus(status: number): boolean {
  return status in COPY;
}

/** Elige idioma: ?lang= manda; si no, el primer idioma reconocible de Accept-Language; si no, español. */
export function pickLang(acceptLanguage: string | string[] | undefined, queryLang?: string | null): Lang {
  if (queryLang === "es" || queryLang === "en") return queryLang;
  const raw = Array.isArray(acceptLanguage) ? acceptLanguage.join(",") : acceptLanguage ?? "";
  for (const part of raw.split(",")) {
    const code = part.trim().split(";")[0].toLowerCase();
    if (code.startsWith("es")) return "es";
    if (code.startsWith("en")) return "en";
  }
  return "es";
}

export function errorText(status: number, lang: Lang): Copy {
  return (COPY[status] ?? COPY[500])[lang];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Página HTML autocontenida (sin recursos externos). `frontendUrl` es opcional: añade el botón de volver. */
export function renderErrorPage(status: number, lang: Lang, frontendUrl?: string): string {
  const { title, text } = errorText(status, lang);
  const other: Lang = lang === "es" ? "en" : "es";
  const back = frontendUrl
    ? `<p><a class="btn" href="${escapeHtml(frontendUrl)}">${escapeHtml(BACK[lang])}</a></p>`
    : "";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${status} — ${escapeHtml(title)} · Michi 3D</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #14161e; color: #d7dbe6; font: 16px/1.6 system-ui, -apple-system, sans-serif; text-align: center; padding: 24px; box-sizing: border-box; }
  main { max-width: 460px; }
  .code { font-size: 96px; font-weight: 800; line-height: 1; margin: 0; color: #7aa2f7; letter-spacing: -2px; }
  h1 { font-size: 24px; margin: 8px 0 12px; color: #fff; }
  p { color: #aab1c3; margin: 8px 0; }
  .btn { display: inline-block; margin-top: 12px; padding: 10px 18px; border-radius: 8px; background: #7aa2f7; color: #14161e; font-weight: 600; text-decoration: none; }
  .lang { margin-top: 28px; font-size: 13px; }
  .lang a { color: #7aa2f7; }
  .brand { margin-top: 28px; font-size: 13px; color: #6b7388; }
</style>
</head>
<body>
<main>
  <p class="code">${status}</p>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(text)}</p>
  ${back}
  <p class="lang"><a href="?lang=${other}">${other === "es" ? "Español" : "English"}</a></p>
  <p class="brand">Michi 3D</p>
</main>
</body>
</html>`;
}
