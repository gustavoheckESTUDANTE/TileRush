export const GRID_WIDTH = 11
export const GRID_HEIGHT = 25
export const MAX_PLAYERS = 15

export type Position = { x: number; y: number }
export type Direction = 'up' | 'down' | 'left' | 'right'
export type GameStatus = 'lobby' | 'countdown' | 'playing' | 'results' | 'finished'

export type Maze = {
  width: number
  height: number
  cells: number[][]
  start: Position
  finish: Position
  seed: number
}

export type PlayerSnapshot = {
  id: string
  name: string
  color: string
  ready: boolean
  isLeader: boolean
  position: Position
  finishedAt: number | null
  finishPlace: number | null
  score: number
}

export type RoundResult = {
  id: string
  name: string
  color: string
  place: number | null
  time: number | null
  points: number
}

export type RoomSnapshot = {
  serverNow: number
  code: string
  status: GameStatus
  rounds: number
  currentRound: number
  players: PlayerSnapshot[]
  maze: Maze | null
  countdownEndsAt: number | null
  roundStartedAt: number | null
  roundEndsAt: number | null
  nextRoundAt: number | null
  roundResults: RoundResult[]
}

export const PLAYER_COLORS = [
  '#ff6b6b', '#4ecdc4', '#ffd166', '#8f7cff', '#55a7ff',
  '#ff8ec7', '#9bdd65', '#ff9f5a', '#68d7ff', '#c77dff',
  '#e4d95e', '#63d6a5', '#ff7f78', '#84a9ff', '#df80b5',
]
