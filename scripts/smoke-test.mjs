import { io } from 'socket.io-client'
import assert from 'node:assert/strict'

const url = process.argv[2] ?? process.env.TEST_URL ?? 'http://localhost:3001'
const first = io(url)
const second = io(url)
let firstRoom = null
let secondRoom = null

first.on('room:state', (room) => { firstRoom = room })
second.on('room:state', (room) => { secondRoom = room })

function waitUntil(condition, timeout = 20_000, label = 'estado esperado') {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval)
        resolve()
      } else if (Date.now() - startedAt > timeout) {
        clearInterval(interval)
        reject(new Error(`Tempo esgotado na simulação: ${label}.`))
      }
    }, 20)
  })
}

function request(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve))
}

function solve(maze) {
  const queue = [{ ...maze.start, path: [] }]
  const visited = new Set([`${maze.start.x},${maze.start.y}`])
  const directions = [
    ['up', 0, -1], ['right', 1, 0], ['left', -1, 0], ['down', 0, 1],
  ]
  while (queue.length) {
    const current = queue.shift()
    if (current.x === maze.finish.x && current.y === maze.finish.y) return current.path
    for (const [direction, dx, dy] of directions) {
      const x = current.x + dx
      const y = current.y + dy
      const key = `${x},${y}`
      if (x < 0 || y < 0 || x >= maze.width || y >= maze.height || maze.cells[y][x] || visited.has(key)) continue
      visited.add(key)
      queue.push({ x, y, path: [...current.path, direction] })
    }
  }
  throw new Error('Labirinto sem solução.')
}

try {
  await waitUntil(() => first.connected && second.connected, 20_000, 'conexão dos dois clientes')
  const created = await request(first, 'room:create', { name: 'roberto' })
  assert.equal(created.ok, true)
  const joined = await request(second, 'room:join', { name: 'roberto 2', code: created.code })
  assert.equal(joined.ok, true)
  await waitUntil(() => firstRoom?.players.length === 2 && secondRoom?.players.length === 2, 20_000, 'entrada dos dois jogadores')
  first.emit('room:set-ready', true)
  second.emit('room:set-ready', true)
  await waitUntil(() => firstRoom?.players.every((player) => player.ready), 20_000, 'estado de pronto')
  first.emit('room:set-rounds', 2)
  first.emit('room:start')
  await waitUntil(() => firstRoom?.status === 'playing' && secondRoom?.status === 'playing', 20_000, 'início da primeira rodada')
  assert.deepEqual(firstRoom.maze, secondRoom.maze)

  const path = solve(firstRoom.maze)
  for (const direction of path) {
    first.emit('player:move', direction)
    await new Promise((resolve) => setTimeout(resolve, 45))
  }
  await waitUntil(() => firstRoom?.players.find((player) => player.name === 'roberto')?.finishedAt !== null, 20_000, 'chegada do primeiro jogador')
  const finisher = firstRoom.players.find((player) => player.name === 'roberto')
  assert.equal(finisher.finishPlace, 1)
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(firstRoom.status, 'playing', 'A rodada avançou antes do segundo jogador terminar.')
  assert.equal(secondRoom.status, 'playing', 'Os clientes discordaram sobre o estado da rodada.')

  for (const direction of path) {
    second.emit('player:move', direction)
    await new Promise((resolve) => setTimeout(resolve, 45))
  }
  await waitUntil(() => firstRoom?.status === 'results' && secondRoom?.status === 'results', 20_000, 'resultados após o segundo jogador')
  assert.equal(firstRoom.nextRoundAt, secondRoom.nextRoundAt, 'Os clientes receberam contagens diferentes.')
  await waitUntil(() => firstRoom?.status === 'countdown' && firstRoom?.currentRound === 2 && secondRoom?.currentRound === 2, 20_000, 'segunda rodada sincronizada')
  assert.equal(firstRoom.maze.seed, secondRoom.maze.seed)
  console.log(`OK — sala ${created.code}, 2 jogadores, espera pelo último colocado e rodada 2 sincronizada.`)
} finally {
  first.disconnect()
  second.disconnect()
}
