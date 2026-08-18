import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { Server, Socket } from 'socket.io'
import {
  Direction,
  GameStatus,
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_PLAYERS,
  Maze,
  PLAYER_COLORS,
  PlayerSnapshot,
  Position,
  RoomSnapshot,
  RoundResult,
} from './shared.ts'

type Player = PlayerSnapshot & { socketId: string; lastMoveAt: number }

type Room = {
  code: string
  status: GameStatus
  rounds: number
  currentRound: number
  players: Map<string, Player>
  leaderId: string
  maze: Maze | null
  countdownEndsAt: number | null
  roundStartedAt: number | null
  roundEndsAt: number | null
  nextRoundAt: number | null
  roundResults: RoundResult[]
  countdownTimer?: NodeJS.Timeout
  roundTimer?: NodeJS.Timeout
  nextRoundTimer?: NodeJS.Timeout
}

type JoinPayload = { name: string; code?: string }
type Ack = (result: { ok: true; code: string } | { ok: false; message: string }) => void

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})

app.use(cors())
app.get('/health', (_request, response) => response.json({ ok: true, rooms: rooms.size }))

const rooms = new Map<string, Room>()
const PORT = Number(process.env.PORT) || 3001

function listLanAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([interfaceName, addresses]) =>
    (addresses ?? [])
      .filter((address) => address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.'))
      .map((address) => ({ interfaceName, address: address.address })),
  )
}

function detectPrimaryLanAddress() {
  return new Promise<string | null>((resolve) => {
    const socket = createSocket('udp4')
    const finish = (address: string | null) => {
      socket.close()
      resolve(address)
    }
    const timeout = setTimeout(() => finish(null), 700)
    socket.once('error', () => { clearTimeout(timeout); finish(null) })
    socket.connect(80, '1.1.1.1', () => {
      clearTimeout(timeout)
      const address = socket.address()
      finish(typeof address === 'object' ? address.address : null)
    })
  })
}

const primaryLanAddress = detectPrimaryLanAddress()

app.get('/api/network-info', async (request, response) => {
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  const requestHost = forwardedHost || request.get('host') || `localhost:${PORT}`
  const protocol = forwardedProtocol || request.protocol || 'http'
  const incomingOrigin = `${protocol}://${requestHost}`
  let hostname = 'localhost'
  let port = String(PORT)

  try {
    const parsed = new URL(incomingOrigin)
    hostname = parsed.hostname
    port = parsed.port || (protocol === 'https' ? '443' : '80')
  } catch {
    // Mantém o fallback local quando um proxy envia um Host inválido.
  }

  const primary = await primaryLanAddress
  const candidates = listLanAddresses()
  const orderedAddresses = [...new Set([primary, ...candidates.map((item) => item.address)].filter(Boolean))] as string[]
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  const origins = orderedAddresses.map((address) => `${protocol}://${address}${port === '80' && protocol === 'http' || port === '443' && protocol === 'https' ? '' : `:${port}`}`)

  response.json({
    preferredOrigin: isLoopback ? origins[0] ?? incomingOrigin : incomingOrigin,
    origins,
  })
})

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (rooms.has(code))
  return code
}

function cleanName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 18)
}

function snapshot(room: Room): RoomSnapshot {
  return {
    serverNow: Date.now(),
    code: room.code,
    status: room.status,
    rounds: room.rounds,
    currentRound: room.currentRound,
    players: [...room.players.values()].map(({ socketId: _socketId, lastMoveAt: _lastMoveAt, ...player }) => ({
      ...player,
      isLeader: player.id === room.leaderId,
    })),
    maze: room.maze,
    countdownEndsAt: room.countdownEndsAt,
    roundStartedAt: room.roundStartedAt,
    roundEndsAt: room.roundEndsAt,
    nextRoundAt: room.nextRoundAt,
    roundResults: room.roundResults,
  }
}

function emitRoom(room: Room) {
  io.to(room.code).emit('room:state', snapshot(room))
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function generateMaze(seed: number): Maze {
  const random = seededRandom(seed)
  const cells = Array.from({ length: GRID_HEIGHT }, () => Array(GRID_WIDTH).fill(1))
  let x = 2 + Math.floor(random() * (GRID_WIDTH - 4))
  const start: Position = { x, y: GRID_HEIGHT - 1 }
  cells[start.y][start.x] = 0

  for (let y = GRID_HEIGHT - 1; y > 0; y -= 1) {
    const drift = random() < 0.68 ? (random() < 0.5 ? -1 : 1) : 0
    const run = drift === 0 ? 0 : 1 + Math.floor(random() * 3)
    for (let step = 0; step < run; step += 1) {
      const nextX = Math.max(1, Math.min(GRID_WIDTH - 2, x + drift))
      if (nextX === x) break
      x = nextX
      cells[y][x] = 0
    }
    cells[y - 1][x] = 0

    if (random() < 0.58) {
      const side = random() < 0.5 ? -1 : 1
      const branchLength = 1 + Math.floor(random() * 2)
      for (let branch = 1; branch <= branchLength; branch += 1) {
        const branchX = x + side * branch
        if (branchX > 0 && branchX < GRID_WIDTH - 1) cells[y][branchX] = 0
      }
    }
  }

  const finish: Position = { x, y: 0 }
  cells[finish.y][finish.x] = 0

  for (let y = 1; y < GRID_HEIGHT - 1; y += 1) {
    for (let column = 1; column < GRID_WIDTH - 1; column += 1) {
      if (cells[y][column] === 1 && random() < 0.08) cells[y][column] = 0
    }
  }

  return { width: GRID_WIDTH, height: GRID_HEIGHT, cells, start, finish, seed }
}

function clearRoomTimers(room: Room) {
  if (room.countdownTimer) clearTimeout(room.countdownTimer)
  if (room.roundTimer) clearTimeout(room.roundTimer)
  if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer)
}

function resetPlayersForRound(room: Room) {
  const start = room.maze?.start ?? { x: 0, y: 0 }
  room.players.forEach((player) => {
    player.position = { ...start }
    player.finishedAt = null
    player.finishPlace = null
    player.lastMoveAt = 0
  })
}

function activateRound(room: Room) {
  if (!rooms.has(room.code) || room.status !== 'countdown') return
  const plannedStart = room.countdownEndsAt ?? Date.now()
  room.status = 'playing'
  room.countdownEndsAt = null
  room.roundStartedAt = plannedStart
  room.roundEndsAt = plannedStart + 90_000
  emitRoom(room)
  room.roundTimer = setTimeout(() => endRound(room), Math.max(0, room.roundEndsAt - Date.now()))
}

function prepareRound(room: Room) {
  clearRoomTimers(room)
  room.currentRound += 1
  room.status = 'countdown'
  room.maze = generateMaze(Date.now() ^ (room.currentRound * 7919))
  room.roundResults = []
  room.nextRoundAt = null
  room.roundStartedAt = null
  room.roundEndsAt = null
  room.countdownEndsAt = Date.now() + 3200
  resetPlayersForRound(room)
  emitRoom(room)

  room.countdownTimer = setTimeout(() => {
    activateRound(room)
  }, 3200)
}

function endRound(room: Room) {
  if (room.status !== 'playing') return
  if (room.roundTimer) clearTimeout(room.roundTimer)
  room.status = 'results'
  room.roundEndsAt = null

  const ordered = [...room.players.values()].sort((a, b) => {
    if (a.finishPlace === null && b.finishPlace === null) return a.position.y - b.position.y
    if (a.finishPlace === null) return 1
    if (b.finishPlace === null) return -1
    return a.finishPlace - b.finishPlace
  })

  room.roundResults = ordered.map((player) => {
    const points = player.finishPlace === null ? 0 : Math.max(1, room.players.size - player.finishPlace + 1)
    player.score += points
    return {
      id: player.id,
      name: player.name,
      color: player.color,
      place: player.finishPlace,
      time: player.finishedAt,
      points,
    }
  })

  room.nextRoundAt = Date.now() + 6500
  emitRoom(room)
  room.nextRoundTimer = setTimeout(() => {
    if (!rooms.has(room.code) || room.status !== 'results') return
    if (room.currentRound >= room.rounds) {
      room.status = 'finished'
      room.nextRoundAt = null
      room.players.forEach((player) => { player.ready = false })
      emitRoom(room)
      return
    }
    prepareRound(room)
  }, 6500)
}

function findRoomForSocket(socket: Socket) {
  const code = socket.data.roomCode as string | undefined
  return code ? rooms.get(code) : undefined
}

function leaveCurrentRoom(socket: Socket) {
  const room = findRoomForSocket(socket)
  if (!room) return
  const player = room.players.get(socket.id)
  room.players.delete(socket.id)
  socket.leave(room.code)
  delete socket.data.roomCode

  if (room.players.size === 0) {
    clearRoomTimers(room)
    rooms.delete(room.code)
    return
  }

  if (player?.id === room.leaderId) room.leaderId = room.players.values().next().value!.id
  if (room.status === 'playing' && [...room.players.values()].every((item) => item.finishedAt !== null)) endRound(room)
  else emitRoom(room)
}

function addPlayer(socket: Socket, payload: JoinPayload, code: string, ack: Ack) {
  const name = cleanName(payload.name)
  const room = rooms.get(code)
  if (!name) return ack({ ok: false, message: 'Digite um nome para entrar.' })
  if (!room) return ack({ ok: false, message: 'Sala não encontrada.' })
  if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, message: 'Essa sala já tem 15 jogadores.' })
  if (room.status !== 'lobby') return ack({ ok: false, message: 'A corrida já começou. Aguarde a próxima partida.' })
  if ([...room.players.values()].some((player) => player.name.toLowerCase() === name.toLowerCase())) {
    return ack({ ok: false, message: 'Esse nome já está em uso na sala.' })
  }

  leaveCurrentRoom(socket)
  const player: Player = {
    id: socket.id,
    socketId: socket.id,
    name,
    color: PLAYER_COLORS[room.players.size % PLAYER_COLORS.length],
    ready: false,
    isLeader: room.players.size === 0,
    position: { x: 0, y: 0 },
    finishedAt: null,
    finishPlace: null,
    score: 0,
    lastMoveAt: 0,
  }
  room.players.set(socket.id, player)
  if (!room.leaderId) room.leaderId = player.id
  socket.data.roomCode = room.code
  socket.join(room.code)
  ack({ ok: true, code: room.code })
  emitRoom(room)
}

io.on('connection', (socket) => {
  socket.on('time:sync', (ack: (serverNow: number) => void) => ack(Date.now()))

  socket.on('room:create', (payload: JoinPayload, ack: Ack) => {
    const code = makeCode()
    const room: Room = {
      code,
      status: 'lobby',
      rounds: 3,
      currentRound: 0,
      players: new Map(),
      leaderId: '',
      maze: null,
      countdownEndsAt: null,
      roundStartedAt: null,
      roundEndsAt: null,
      nextRoundAt: null,
      roundResults: [],
    }
    rooms.set(code, room)
    addPlayer(socket, payload, code, ack)
  })

  socket.on('room:join', (payload: JoinPayload, ack: Ack) => {
    addPlayer(socket, payload, String(payload.code ?? '').trim().toUpperCase(), ack)
  })

  socket.on('room:set-ready', (ready: boolean) => {
    const room = findRoomForSocket(socket)
    const player = room?.players.get(socket.id)
    if (!room || !player || room.status !== 'lobby') return
    player.ready = Boolean(ready)
    emitRoom(room)
  })

  socket.on('room:set-rounds', (rounds: number) => {
    const room = findRoomForSocket(socket)
    if (!room || room.status !== 'lobby' || room.leaderId !== socket.id) return
    room.rounds = Math.max(1, Math.min(10, Math.round(Number(rounds) || 3)))
    emitRoom(room)
  })

  socket.on('room:start', () => {
    const room = findRoomForSocket(socket)
    if (!room || room.status !== 'lobby' || room.leaderId !== socket.id) return
    if (![...room.players.values()].every((player) => player.ready)) return
    prepareRound(room)
  })

  socket.on('room:rematch', () => {
    const room = findRoomForSocket(socket)
    if (!room || room.status !== 'finished' || room.leaderId !== socket.id) return
    room.status = 'lobby'
    room.currentRound = 0
    room.maze = null
    room.roundResults = []
    room.players.forEach((player) => {
      player.ready = false
      player.score = 0
    })
    emitRoom(room)
  })

  socket.on('player:move', (direction: Direction) => {
    const room = findRoomForSocket(socket)
    const player = room?.players.get(socket.id)
    if (!room || !player || !room.maze || player.finishedAt !== null) return

    const now = Date.now()
    if (room.status === 'countdown' && room.countdownEndsAt !== null && now >= room.countdownEndsAt) activateRound(room)
    if (room.status !== 'playing') return
    if (now - player.lastMoveAt < 38) return
    player.lastMoveAt = now
    const delta: Record<Direction, Position> = {
      up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
    }
    if (!delta[direction]) return
    const next = { x: player.position.x + delta[direction].x, y: player.position.y + delta[direction].y }
    if (next.x < 0 || next.y < 0 || next.x >= room.maze.width || next.y >= room.maze.height) return
    if (room.maze.cells[next.y][next.x] !== 0) return
    player.position = next

    if (next.x === room.maze.finish.x && next.y === room.maze.finish.y) {
      player.finishPlace = [...room.players.values()].filter((item) => item.finishedAt !== null).length + 1
      player.finishedAt = Math.max(0, now - (room.roundStartedAt ?? now))
    }

    emitRoom(room)
    if ([...room.players.values()].every((item) => item.finishedAt !== null)) setTimeout(() => endRound(room), 800)
  })

  socket.on('disconnect', () => leaveCurrentRoom(socket))
})

const distPath = join(process.cwd(), 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('/{*splat}', (_request, response) => response.sendFile(join(distPath, 'index.html')))
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Tile Rush Arena disponível na porta ${PORT}`)
  void primaryLanAddress.then((address) => {
    if (address) console.log(`Acesso pela rede: http://${address}:${PORT}`)
  })
})
