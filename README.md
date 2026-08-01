# Michi 3D — Servidor

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
- `create_room` — crea una sala nueva, te vuelve jugador 0. Puede incluir `timerConfig` para configurar tiempo por turno y/o vidas.
- `join_room` — te une a una sala existente por código.
- `play_move` — coloca tu marca en una casilla (rechazado si no es tu turno).
- `reset_game` — reinicia el tablero (misma sala, mismos jugadores, vidas restauradas).
- `leave_room` — sales de la sala.
- `end_game` — termina la partida manualmente. Solo el host de la sala puede usarlo; el servidor rechaza el mensaje si lo manda cualquier otro jugador.
- `set_locked` — cierra o abre la sala a nuevos jugadores. Solo el host puede usarlo. Cerrar la sala nunca afecta a quienes ya están dentro; el host siempre puede reconectar incluso con la sala cerrada.

**Servidor → Cliente:**
- `room_created` / `room_joined` — confirmación con tu `playerId` y el estado completo.
- `state_update` — el tablero cambió (alguien jugó, se reinició, se acabó el tiempo de un turno, etc.), se manda a todos en la sala.
- `player_disconnected` / `player_reconnected` — notificación informativa.
- `error` — algo salió mal (sala llena, código inválido, jugada fuera de turno, acción de host sin ser host, etc.).

## Partidas con tiempo y vidas

`timerConfig` (definido en `logic.ts`) tiene tres formas:
- `{ mode: "none" }` — sin límite, como el juego original.
- `{ mode: "turn", secondsPerTurn, onTimeout }` — límite de tiempo por turno. `onTimeout` es `"skip_turn"` (se omite sin castigo) o `"random_move"` (se juega una casilla al azar).
- `{ mode: "life", secondsPerTurn, onTimeout, startingLives }` — igual, pero además cada jugador tiene vidas; al vencer su tiempo pierde una, y al llegar a 0 queda eliminado (`Player.eliminated`). Si solo queda un jugador activo, gana automáticamente (`status.kind === "win_by_elimination"`).

El servidor revisa todas las salas con un temporizador activo cada 1 segundo (`TIMER_CHECK_INTERVAL_MS` en `server.ts`), comparando `game.turnStartedAt` contra `timerConfig.secondsPerTurn`. Cuando se cumple, aplica `applyTurnTimeout` (en `logic.ts`) y lo notifica a la sala — sin que ningún cliente tenga que pedirlo.

## Bugfix: jugadores desconectados en la rotación de turnos

Antes, si alguien se desconectaba a mitad de partida, el juego seguía esperando su turno indefinidamente y nadie más podía jugar. Ahora `nextEligiblePlayerIndex` (en `logic.ts`) salta automáticamente a los jugadores desconectados al calcular a quién le toca. Al reconectar (mismo nombre, ver más abajo), el jugador vuelve a la rotación normal desde la siguiente vuelta.

## Notas de diseño

- Sin base de datos: todo vive en memoria (`Map` de salas). Si el servidor se reinicia, se pierden las partidas activas. Para un prototipo esto es correcto y suficiente.
- Máximo 4 jugadores por sala (`MAX_PLAYERS_PER_ROOM` en `rooms.ts`).
- Las salas sin nadie conectado se eliminan tras 5 minutos (evita fuga de memoria en un servidor de larga duración).
- El host es quien crea la sala, marcado explícitamente (`RoomPlayer.isHost`), no calculado dinámicamente. Solo él puede terminar la partida (`end_game`) o cerrar/abrir la sala (`set_locked`); el servidor rechaza esos mensajes de cualquier otro jugador con un `error`.
- `GameStatus` tiene 5 estados: `playing`, `win` (línea completa), `win_by_elimination` (todos los demás quedaron eliminados en modo Vida), `draw`, y `ended_by_host` (el host la terminó manualmente).
