# Michi 3D - Servidor

Servidor WebSocket para el modo online de Michi 3D. Coordina salas, turnos y estado del juego para 2 a 4 jugadores.

Ver el README del frontend (`../michi3d/README.md`) para instrucciones completas de despliegue conjunto en Render + Vercel/Netlify.

## Correr en local

```bash
npm install
npm run dev
```

Escucha en el puerto `8080` por defecto (configurable con la variable de entorno `PORT`, que es lo que usan la mayoría de los hostings gratuitos).

## Build de producción

```bash
npm run build
npm start
```

## Protocolo

Ver `src/protocol.ts` para los tipos exactos de mensaje. Resumen:

**Cliente → Servidor:**
- `create_room` - crea una sala nueva, te vuelve jugador 0. Puede incluir `timerConfig` para configurar tiempo por turno y/o vidas.
- `join_room` - te une a una sala existente por código.
- `play_move` - coloca tu marca en una casilla (rechazado si no es tu turno).
- `reset_game` - reinicia el tablero (misma sala, mismos jugadores, vidas restauradas).
- `leave_room` - sales de la sala.
- `end_game` - termina la partida manualmente. Solo el host de la sala puede usarlo; el servidor rechaza el mensaje si lo manda cualquier otro jugador.
- `set_locked` - cierra o abre la sala a nuevos jugadores. Solo el host puede usarlo. Cerrar la sala nunca afecta a quienes ya están dentro; el host siempre puede reconectar incluso con la sala cerrada.

**Servidor → Cliente:**
- `room_created` / `room_joined` - confirmación con tu `playerId` y el estado completo.
- `state_update` - el tablero cambió (alguien jugó, se reinició, se acabó el tiempo de un turno, etc.), se manda a todos en la sala.
- `player_disconnected` / `player_reconnected` - notificación informativa.
- `error` - algo salió mal (sala llena, código inválido, jugada fuera de turno, acción de host sin ser host, etc.).

## Partidas con tiempo y vidas

`timerConfig` (definido en `logic.ts`) tiene tres formas:
- `{ mode: "none" }` - sin límite, como el juego original.
- `{ mode: "turn", secondsPerTurn, onTimeout }` - límite de tiempo por turno. `onTimeout` es `"skip_turn"` (se omite sin castigo) o `"random_move"` (se juega una casilla al azar).
- `{ mode: "life", secondsPerTurn, onTimeout, startingLives }` - igual, pero además cada jugador tiene vidas; al vencer su tiempo pierde una, y al llegar a 0 queda eliminado (`Player.eliminated`). Si solo queda un jugador activo, gana automáticamente (`status.kind === "win_by_elimination"`).

El servidor revisa todas las salas con un temporizador activo cada 1 segundo (`TIMER_CHECK_INTERVAL_MS` en `server.ts`), comparando `game.turnStartedAt` contra `timerConfig.secondsPerTurn`. Cuando se cumple, aplica `applyTurnTimeout` (en `logic.ts`) y lo notifica a la sala - sin que ningún cliente tenga que pedirlo.

## Bugfix: jugadores desconectados en la rotación de turnos

Antes, si alguien se desconectaba a mitad de partida, el juego seguía esperando su turno indefinidamente y nadie más podía jugar. Ahora `nextEligiblePlayerIndex` (en `logic.ts`) salta automáticamente a los jugadores desconectados al calcular a quién le toca. Al reconectar (mismo nombre, ver más abajo), el jugador vuelve a la rotación normal desde la siguiente vuelta.

## Notas de diseño

- Sin base de datos: todo vive en memoria (`Map` de salas). Si el servidor se reinicia, se pierden las partidas activas. Para un prototipo esto es correcto y suficiente.
- Máximo 4 jugadores por sala (`MAX_PLAYERS_PER_ROOM` en `rooms.ts`).
- Las salas sin nadie conectado se eliminan tras 5 minutos (evita fuga de memoria en un servidor de larga duración).
- El host es quien crea la sala, marcado explícitamente (`RoomPlayer.isHost`), no calculado dinámicamente. Solo él puede terminar la partida (`end_game`) o cerrar/abrir la sala (`set_locked`); el servidor rechaza esos mensajes de cualquier otro jugador con un `error`.
- `GameStatus` tiene 5 estados: `playing`, `win` (línea completa), `win_by_elimination` (todos los demás quedaron eliminados en modo Vida), `draw`, y `ended_by_host` (el host la terminó manualmente).

## Registro del chat (moderación + protocolo general)

El chat de cada sala se registra. Se guarda: sala, id y nombre del jugador, texto, hora y versión de los
términos aceptados. No se guardan cuentas, correos ni IPs.

Variables de entorno (en Render → Environment):

| Variable | Qué hace | Por defecto |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión de Postgres (p. ej. el Postgres de Render). **Sin ella el registro es solo en memoria y se pierde al reiniciar.** | - |
| `ADMIN_KEY` | Clave para consultar el registro. Sin ella, `/admin/...` no existe. Usa una larga y aleatoria. | - |
| `CHAT_RETENTION_DAYS` | Días que se conservan los mensajes | `30` |
| `REPORT_RETENTION_DAYS` | Días que se conserva el chat de una sala con reportes (y los reportes) | `180` |
| `PGSSLMODE` | `disable` para Postgres local sin TLS | - |

Las tablas (`chat_messages`, `chat_reports`) se crean solas al arrancar. La purga corre al arrancar y cada hora.
**Los plazos deben coincidir con `michi3d/public/privacidad.html`.**

### Consulta de administrador

Todas las rutas exigen la cabecera `Authorization: Bearer <ADMIN_KEY>`:

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" https://TU-SERVIDOR/admin/chat/rooms             # salas con registro
curl -H "Authorization: Bearer $ADMIN_KEY" https://TU-SERVIDOR/admin/chat/reports           # reportes recibidos
curl -H "Authorization: Bearer $ADMIN_KEY" "https://TU-SERVIDOR/admin/chat/room/ABCD%3A1730000000000?format=txt"  # chat de una sala (roomId = CÓDIGO:createdAt)
curl -X DELETE -H "Authorization: Bearer $ADMIN_KEY" "https://TU-SERVIDOR/admin/chat/room/ABCD%3A1730000000000"    # supresión a petición del usuario
```

### Textos legales

`michi3d/public/terminos.html`, `privacidad.html` (y sus versiones en inglés `terms.html`, `privacy.html`) ya incluyen el responsable (ValenciagaPM) y el correo de contacto.
No indican país ni jurisdicción todavía. Si cambias los textos de forma sustancial, cambia
`TERMS_VERSION` en `protocol.ts` (servidor y frontend) para que todos vuelvan a aceptar.

## Límites de peticiones (anti-bombardeo)

Implementado en `src/ratelimit.ts` y aplicado en `src/server.ts`. Por defecto:

| Capa | Límite por defecto |
|---|---|
| Mensajes por conexión | **400 por minuto** sostenidos (ráfagas cortas de hasta 30) |
| Tamaño de mensaje | 16 KB (si no, se cierra la conexión) |
| Conexiones simultáneas por IP | 40 |
| Conexiones nuevas por IP | ráfaga de 40, luego 1 por segundo |
| Chat | ráfaga de 5, luego 1 mensaje cada 2 s (por conexión) |
| Crear salas | ráfaga de 10, luego 1 cada 30 s (por IP) |
| Códigos de sala inválidos | ráfaga de 10 fallos, luego 1 cada 6 s (por IP; frena adivinar códigos) |
| Reportes | ráfaga de 10, luego 1 cada 30 s (por IP) |
| HTTP | 60 por minuto por IP; 5 claves de admin incorrectas y bloqueo temporal |
| Inundación | 40 mensajes descartados en 10 s: se cierra la conexión y se banea la IP 2 min |
| Salas totales | 2000 |

Todo se ajusta con variables `RL_*` (ver `loadLimits()` en `ratelimit.ts`), p. ej. `RL_MSG_REFILL_PER_SEC`, `RL_MAX_ROOMS`, `RL_BAN_MS`.

### IMPORTANTE al desplegar en Render: comprueba la IP

Los límites por IP solo sirven si el servidor ve la IP **real** de cada jugador. Detrás del proxy de Render se lee de `X-Forwarded-For`
contando desde la derecha: `TRUST_PROXY_HOPS` (por defecto `1`) es el número de proxies de confianza. Si estuviera mal, **todos los jugadores
parecerían la misma IP** y un solo abusador podría bloquear a todos. Compruébalo una vez desplegado:

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" https://TU-SERVIDOR/admin/ip
```

`ipQueUsaElServidor` debe ser **tu IP pública real** (la que ves en cualquier "cuál es mi IP"). Si sale una IP de Render/Cloudflare, o varía distinta a la tuya,
sube `TRUST_PROXY_HOPS` a `2` (o ajusta) y vuelve a probar.

## Idiomas y páginas de error

- **Idiomas:** español (base) e inglés. El jugador elige en el selector de abajo a la izquierda (se guarda en el navegador; por defecto usa el idioma del navegador).
  El cliente envía su idioma al servidor (`lang` en `create_room`/`join_room`, y `set_language` al cambiarlo), y el servidor traduce sus avisos y errores
  (`src/servertext.ts`). El texto en español es la clave de traducción; si falta una traducción se muestra el español.
- **Añadir un idioma:** diccionario nuevo en `michi3d/src/i18n/` (como `en.ts`), registrarlo en `index.tsx`, añadirlo a `servertext.ts` y `errorpages.ts`,
  y crear las páginas legales y de error de ese idioma. `npx tsx test/i18n.test.ts` avisa de cualquier texto sin traducir o traducción huérfana.
- **Páginas de error del servidor** (`src/errorpages.ts`): 400, 401, 403, 404, 405, 408, 413, 414, 429, 431 y 500, en HTML para navegadores y JSON para `curl`.
  Idioma por `?lang=es|en` o `Accept-Language`. Variable opcional `FRONTEND_URL` para mostrar el botón "Volver al juego".
- **Páginas de error del frontend:** `public/404.html` (Vercel la usa sola para rutas inexistentes) y `public/error.html?code=403` para otros códigos.
- **Textos legales en inglés:** `terms.html` y `privacy.html` (traducción de cortesía; prevalece la versión en español). 

Pruebas: `npx tsx test/i18n.test.ts`, `node test/errors-lang.mjs` (con el servidor en el puerto 8097 y `RL_HTTP_BURST=12 RL_HTTP_REFILL_PER_SEC=0.01`).
