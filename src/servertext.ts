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

/** Deutsch, immer im Du-Stil. Mismo criterio: el texto en español es la clave. */
export const SERVER_DE: Record<string, string> = {
  "El creador de la sala ha deshabilitado nuevos ingresos.": "Der Raumersteller hat neue Beitritte deaktiviert.",
  "La sala ya está llena (máximo 4 jugadores).": "Der Raum ist schon voll (maximal 4 Spieler).",
  "La sala ya no existe.": "Den Raum gibt es nicht mehr.",
  "La partida ya terminó.": "Die Partie ist schon vorbei.",
  "No es tu turno.": "Du bist nicht dran.",
  "Estás eliminado y ya no puedes jugar.": "Du bist ausgeschieden und kannst nicht mehr spielen.",
  "No puedes usar Chicharrón ahora mismo.": "Du kannst Chicharrón gerade nicht einsetzen.",
  "No puedes usar Goyslop ahora mismo.": "Du kannst Goyslop gerade nicht einsetzen.",
  "No puedes usar Balanza ahora mismo.": "Du kannst die Waage gerade nicht einsetzen.",
  "No puedes usar Globo de Pintura sobre ese objetivo.": "Du kannst den Farbballon nicht auf dieses Ziel einsetzen.",
  "No puedes usar Malversión de Fondos sobre esa casilla.": "Du kannst Veruntreuung nicht auf dieses Feld einsetzen.",
  "No puedes usar Postcognición sobre ese objetivo.": "Du kannst Postkognition nicht auf dieses Ziel einsetzen.",
  "No puedes usar Reloj Roto ahora mismo.": "Du kannst die Kaputte Uhr gerade nicht einsetzen.",
  "No puedes usar Brújula Mal Imantada con ese número de turnos.": "Du kannst den Verstimmten Kompass nicht mit dieser Anzahl Züge einsetzen.",
  "No puedes tomar la Papa Caliente ahora mismo.": "Du kannst die Heiße Kartoffel gerade nicht nehmen.",
  "No puedes pasar la Papa Caliente a ese jugador.": "Du kannst die Heiße Kartoffel nicht an diesen Spieler weitergeben.",
  "No puedes usar el Acelerador de Partículas ahora mismo.": "Du kannst den Teilchenbeschleuniger gerade nicht einsetzen.",
  "No se pudo generar un código de sala único.": "Es konnte kein eindeutiger Raumcode erzeugt werden.",
  "Todavía no terminó la partida.": "Die Partie ist noch nicht vorbei.",
  "No se encontró tu jugador en la sala.": "Dein Spieler wurde im Raum nicht gefunden.",
  "El mensaje no puede estar vacío.": "Die Nachricht darf nicht leer sein.",
  "Solo el creador de la sala puede terminar la partida.": "Nur der Raumersteller kann die Partie beenden.",
  "Solo el creador de la sala puede cambiar esto.": "Nur der Raumersteller kann das ändern.",
  "Tienes que aceptar los términos y la política de privacidad para jugar online.": "Du musst die Nutzungsbedingungen und die Datenschutzerklärung akzeptieren, um online zu spielen.",
  "Vas muy rápido, espera un poco.": "Du bist zu schnell, warte kurz.",
  "Mensaje mal formado.": "Fehlerhafte Nachricht.",
  "El servidor está lleno ahora mismo, prueba en unos minutos.": "Der Server ist gerade voll, versuch es in ein paar Minuten nochmal.",
  "Estás creando salas muy rápido, espera un poco.": "Du erstellst Räume zu schnell, warte kurz.",
  "Demasiados códigos que no existen, espera un poco.": "Zu viele Codes, die es nicht gibt, warte kurz.",
  "No estás en ninguna sala.": "Du bist in keinem Raum.",
  "Globo de Pintura necesita un objetivo.": "Der Farbballon braucht ein Ziel.",
  "Malversión de Fondos necesita una casilla objetivo.": "Veruntreuung braucht ein Zielfeld.",
  "Postcognición necesita un objetivo.": "Postkognition braucht ein Ziel.",
  "Brújula Mal Imantada necesita un número de turnos.": "Der Verstimmte Kompass braucht eine Anzahl Züge.",
  "Pasar la Papa Caliente necesita un objetivo.": "Zum Weitergeben der Heißen Kartoffel brauchst du ein Ziel.",
  "Papa Caliente: indica si quieres tomarla o pasarla.": "Heiße Kartoffel: sag, ob du sie nehmen oder weitergeben willst.",
  "Esa habilidad todavía no está disponible.": "Diese Fähigkeit ist noch nicht verfügbar.",
  "Más despacio, que escribes muy rápido.": "Langsamer, du schreibst zu schnell.",
  "Más despacio con los reportes, espera un poco.": "Langsamer mit den Meldungen, warte kurz.",
  "No puedes reportar tus propios mensajes.": "Du kannst deine eigenen Nachrichten nicht melden.",
  "Ese mensaje ya no está disponible para reportar.": "Diese Nachricht kann nicht mehr gemeldet werden.",
  "Ya reportaste ese mensaje.": "Du hast diese Nachricht schon gemeldet.",
  "No se pudo guardar el reporte, prueba otra vez.": "Die Meldung konnte nicht gespeichert werden, versuch es nochmal.",
};

/**
 * Mensajes con datos variables (p. ej. el código de sala). Solo se pasa a minúsculas la plantilla,
 * nunca el dato que escribió el jugador.
 */
const PATTERNS: { re: RegExp; es: (m: RegExpMatchArray) => string; en: (m: RegExpMatchArray) => string; de: (m: RegExpMatchArray) => string }[] = [
  {
    re: /^No existe ninguna sala con el código "(.*)"\.$/s,
    es: (m) => `no existe ninguna sala con el código "${m[1]}".`,
    en: (m) => `there is no room with the code "${m[1]}".`,
    de: (m) => `es gibt keinen raum mit dem code "${m[1]}".`,
  },
];

/** Estilo del producto: los mensajes se muestran en minúsculas (ver styleUi en el frontend). */
export function translateServer(lang: Lang, spanish: string): string {
  const dict = lang === "en" ? SERVER_EN : lang === "de" ? SERVER_DE : null;
  if (dict) {
    const exact = dict[spanish];
    if (exact !== undefined) return exact.toLowerCase();
  }
  for (const p of PATTERNS) {
    const m = spanish.match(p.re);
    if (m) return p[lang](m);
  }
  return spanish.toLowerCase(); // español, o sin traducción: mejor en español que vacío
}
