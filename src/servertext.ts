/**
 * Traducción de los mensajes que el SERVIDOR envía al jugador (errores y avisos).
 *
 * El texto original en español es la clave (igual que en el frontend): el código del
 * servidor sigue escribiendo mensajes en español y aquí se traducen al enviarlos,
 * según el idioma que el cliente declaró (`lang` en create_room/join_room o
 * `set_language`). Sin traducción disponible se envía el español, nunca falla.
 * `test/i18n.test.ts` comprueba que ningún mensaje del código se quede sin traducir.
 */

import type { Lang } from "./protocol.js";

export const SERVER_EN: Record<string, string> = {
  // rooms.ts
  "El creador de la sala ha deshabilitado nuevos ingresos.": "The room creator has disabled new players joining.",
  "La sala ya está llena (máximo 4 jugadores).": "The room is already full (maximum 4 players).",
  "La sala ya no existe.": "The room no longer exists.",
  "La partida ya terminó.": "The game has already ended.",
  "No es tu turno.": "It's not your turn.",
  "Estás eliminado y ya no puedes jugar.": "You have been eliminated and can no longer play.",
  "No puedes usar Chicharrón ahora mismo.": "You can't use Chicharrón right now.",
  "No puedes usar Goyslop ahora mismo.": "You can't use Goyslop right now.",
  "No puedes usar Balanza ahora mismo.": "You can't use Scales right now.",
  "No puedes usar Globo de Pintura sobre ese objetivo.": "You can't use Paint Balloon on that target.",
  "No puedes usar Malversión de Fondos sobre esa casilla.": "You can't use Embezzlement on that cell.",
  "No puedes usar Postcognición sobre ese objetivo.": "You can't use Postcognition on that target.",
  "No puedes usar Reloj Roto ahora mismo.": "You can't use Broken Clock right now.",
  "No puedes usar Brújula Mal Imantada con ese número de turnos.": "You can't use Miscalibrated Compass with that number of turns.",
  "No puedes tomar la Papa Caliente ahora mismo.": "You can't take the Hot Potato right now.",
  "No puedes pasar la Papa Caliente a ese jugador.": "You can't pass the Hot Potato to that player.",
  "No puedes usar el Acelerador de Partículas ahora mismo.": "You can't use the Particle Accelerator right now.",
  "No se pudo generar un código de sala único.": "Could not generate a unique room code.",
  "Todavía no terminó la partida.": "The game hasn't finished yet.",
  "No se encontró tu jugador en la sala.": "Your player was not found in the room.",
  "El mensaje no puede estar vacío.": "The message can't be empty.",
  "Solo el creador de la sala puede terminar la partida.": "Only the room creator can end the game.",
  "Solo el creador de la sala puede cambiar esto.": "Only the room creator can change this.",
  // server.ts
  "Tienes que aceptar los términos y la política de privacidad para jugar online.":
    "You need to accept the terms and the privacy policy to play online.",
  "Vas muy rápido, espera un poco.": "You're going too fast, give it a second.",
  "Mensaje mal formado.": "Malformed message.",
  "El servidor está lleno ahora mismo, prueba en unos minutos.": "The server is full right now, try again in a few minutes.",
  "Estás creando salas muy rápido, espera un poco.": "You're creating rooms too quickly, give it a moment.",
  "Demasiados códigos que no existen, espera un poco.": "Too many codes that don't exist, give it a moment.",
  "No estás en ninguna sala.": "You're not in any room.",
  "Globo de Pintura necesita un objetivo.": "Paint Balloon needs a target.",
  "Malversión de Fondos necesita una casilla objetivo.": "Embezzlement needs a target cell.",
  "Postcognición necesita un objetivo.": "Postcognition needs a target.",
  "Brújula Mal Imantada necesita un número de turnos.": "Miscalibrated Compass needs a number of turns.",
  "Pasar la Papa Caliente necesita un objetivo.": "Passing the Hot Potato needs a target.",
  "Papa Caliente: indica si quieres tomarla o pasarla.": "Hot Potato: say whether you want to take it or pass it.",
  "Esa habilidad todavía no está disponible.": "That ability is not available yet.",
  "Más despacio, que escribes muy rápido.": "Slow down, you're typing too fast.",
  "Más despacio con los reportes, espera un poco.": "Easy with the reports, give it a moment.",
  "No puedes reportar tus propios mensajes.": "You can't report your own messages.",
  "Ese mensaje ya no está disponible para reportar.": "That message is no longer available to report.",
  "Ya reportaste ese mensaje.": "You already reported that message.",
  "No se pudo guardar el reporte, prueba otra vez.": "The report couldn't be saved, try again.",
};

/**
 * Mensajes con datos variables (p. ej. el código de sala). Solo se pasa a minúsculas la plantilla,
 * nunca el dato que escribió el jugador.
 */
const PATTERNS: { re: RegExp; es: (m: RegExpMatchArray) => string; en: (m: RegExpMatchArray) => string }[] = [
  {
    re: /^No existe ninguna sala con el código "(.*)"\.$/s,
    es: (m) => `no existe ninguna sala con el código "${m[1]}".`,
    en: (m) => `there is no room with the code "${m[1]}".`,
  },
];

/** Estilo del producto: los mensajes se muestran en minúsculas (ver styleUi en el frontend). */
export function translateServer(lang: Lang, spanish: string): string {
  if (lang === "en") {
    const exact = SERVER_EN[spanish];
    if (exact !== undefined) return exact.toLowerCase();
  }
  for (const p of PATTERNS) {
    const m = spanish.match(p.re);
    if (m) return lang === "en" ? p.en(m) : p.es(m);
  }
  return spanish.toLowerCase(); // español, o sin traducción: mejor en español que vacío
}
