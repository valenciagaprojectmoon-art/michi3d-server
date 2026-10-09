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
    de: { title: "Ungültige Anfrage", text: "Der Server hat nicht verstanden, was du geschickt hast. Prüf die Adresse und versuch es nochmal." },
  },
  401: {
    es: { title: "No autorizado", text: "Necesitas una clave válida para ver esto." },
    en: { title: "Unauthorized", text: "You need a valid key to see this." },
    de: { title: "Nicht autorisiert", text: "Du brauchst einen gültigen Schlüssel, um das zu sehen." },
  },
  403: {
    es: { title: "Acceso prohibido", text: "No tienes permiso para entrar aquí." },
    en: { title: "Forbidden", text: "You don't have permission to get in here." },
    de: { title: "Zugriff verboten", text: "Du darfst hier nicht rein." },
  },
  404: {
    es: { title: "Página no encontrada", text: "Esta página no existe. A lo mejor el enlace está mal escrito." },
    en: { title: "Page not found", text: "This page doesn't exist. The link might be mistyped." },
    de: { title: "Seite nicht gefunden", text: "Diese Seite gibt es nicht. Vielleicht ist der Link falsch geschrieben." },
  },
  405: {
    es: { title: "Método no permitido", text: "Esta dirección no admite ese tipo de petición." },
    en: { title: "Method not allowed", text: "This address doesn't accept that kind of request." },
    de: { title: "Methode nicht erlaubt", text: "Diese Adresse nimmt diese Art von Anfrage nicht an." },
  },
  408: {
    es: { title: "Tiempo de espera agotado", text: "La petición tardó demasiado en llegar. Inténtalo de nuevo." },
    en: { title: "Request timeout", text: "The request took too long to arrive. Please try again." },
    de: { title: "Zeitüberschreitung", text: "Die Anfrage hat zu lange gebraucht. Versuch es nochmal." },
  },
  413: {
    es: { title: "Petición demasiado grande", text: "Lo que enviaste es demasiado grande para el servidor." },
    en: { title: "Payload too large", text: "What you sent is too large for the server." },
    de: { title: "Anfrage zu groß", text: "Was du geschickt hast, ist für den Server zu groß." },
  },
  414: {
    es: { title: "Dirección demasiado larga", text: "La dirección que abriste es demasiado larga." },
    en: { title: "URI too long", text: "The address you opened is too long." },
    de: { title: "Adresse zu lang", text: "Die Adresse, die du geöffnet hast, ist zu lang." },
  },
  429: {
    es: { title: "Demasiadas peticiones", text: "Has hecho demasiadas peticiones seguidas. Espera un poco y vuelve a probar." },
    en: { title: "Too many requests", text: "You've made too many requests in a row. Give it a moment and try again." },
    de: { title: "Zu viele Anfragen", text: "Du hast zu viele Anfragen hintereinander geschickt. Warte kurz und versuch es nochmal." },
  },
  431: {
    es: { title: "Cabeceras demasiado grandes", text: "La petición incluye demasiados datos de cabecera." },
    en: { title: "Request header fields too large", text: "The request carries too much header data." },
    de: { title: "Kopfzeilen zu groß", text: "Die Anfrage enthält zu viele Kopfzeilendaten." },
  },
  500: {
    es: { title: "Error interno", text: "Algo se rompió en el servidor. Prueba otra vez en un rato." },
    en: { title: "Internal error", text: "Something broke on the server. Try again in a bit." },
    de: { title: "Interner Fehler", text: "Auf dem Server ist etwas kaputtgegangen. Versuch es gleich nochmal." },
  },
};

const BACK: Record<Lang, string> = { es: "volver al juego", en: "back to the game", de: "zurück zum spiel" };
const LANG_NAMES: Record<Lang, string> = { es: "español", en: "english", de: "deutsch" };

export function isErrorStatus(status: number): boolean {
  return status in COPY;
}

/** Elige idioma: ?lang= manda; si no, el primer idioma reconocible de Accept-Language; si no, español. */
export function pickLang(acceptLanguage: string | string[] | undefined, queryLang?: string | null): Lang {
  if (queryLang === "es" || queryLang === "en" || queryLang === "de") return queryLang;
  const raw = Array.isArray(acceptLanguage) ? acceptLanguage.join(",") : acceptLanguage ?? "";
  for (const part of raw.split(",")) {
    const code = part.trim().split(";")[0].toLowerCase();
    if (code.startsWith("es")) return "es";
    if (code.startsWith("en")) return "en";
    if (code.startsWith("de")) return "de";
  }
  return "es";
}

/** Estilo del producto: los textos de error se muestran en minúsculas. */
export function errorText(status: number, lang: Lang): Copy {
  const c = (COPY[status] ?? COPY[500])[lang];
  return { title: c.title.toLowerCase(), text: c.text.toLowerCase() };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Página HTML autocontenida (sin recursos externos). `frontendUrl` es opcional: añade el botón de volver. */
export function renderErrorPage(status: number, lang: Lang, frontendUrl?: string): string {
  const { title, text } = errorText(status, lang);
  const others = (["es", "en", "de"] as Lang[]).filter((l) => l !== lang);
  const back = frontendUrl
    ? `<p><a class="btn" href="${escapeHtml(frontendUrl)}">${escapeHtml(BACK[lang])}</a></p>`
    : "";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${status} | ${escapeHtml(title)} | michi 3d</title>
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
  <p class="lang">${others.map((l) => `<a href="?lang=${l}">${LANG_NAMES[l]}</a>`).join(" · ")}</p>
  <p class="brand">michi 3d</p>
</main>
</body>
</html>`;
}
