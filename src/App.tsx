import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Clipboard, Crown, Eye, Flag, Gamepad2, LogOut, Medal, Radio, RotateCcw,
  Trophy, Users, Zap,
} from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import type { Direction, Maze, PlayerSnapshot, RoomSnapshot, RoundResult } from '../shared'

const socket = io({ autoConnect: false })

function useClock(speed = 100) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), speed)
    return () => window.clearInterval(timer)
  }, [speed])
  return now
}

function formatTime(milliseconds: number | null) {
  if (milliseconds === null) return '—'
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1000)
  const hundredths = Math.floor((milliseconds % 1000) / 10)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`
}

function ordinal(place: number | null) {
  return place ? `${place}º` : 'DNF'
}

export function App() {
  const [name, setName] = useState(() => sessionStorage.getItem('tile-rush-name') ?? '')
  const [roomCode, setRoomCode] = useState(() => new URLSearchParams(location.search).get('sala') ?? '')
  const [room, setRoom] = useState<RoomSnapshot | null>(null)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shareOrigin, setShareOrigin] = useState(location.origin)
  const [serverOffset, setServerOffset] = useState(0)

  useEffect(() => {
    const onState = (nextRoom: RoomSnapshot) => { setRoom(nextRoom); setJoining(false) }
    const syncClock = () => {
      if (!socket.connected) return
      const sentAt = Date.now()
      socket.emit('time:sync', (serverNow: number) => {
        const receivedAt = Date.now()
        setServerOffset(serverNow - (sentAt + receivedAt) / 2)
      })
    }
    const onDisconnect = () => setError('Conexão perdida. Tentando reconectar…')
    const onConnect = () => { setError(''); syncClock() }
    socket.on('room:state', onState)
    socket.on('disconnect', onDisconnect)
    socket.on('connect', onConnect)
    if (socket.connected) syncClock()
    const syncInterval = window.setInterval(syncClock, 5000)
    return () => {
      window.clearInterval(syncInterval)
      socket.off('room:state', onState)
      socket.off('disconnect', onDisconnect)
      socket.off('connect', onConnect)
    }
  }, [])

  useEffect(() => {
    fetch('/api/network-info')
      .then((response) => response.ok ? response.json() as Promise<{ preferredOrigin?: string }> : null)
      .then((network) => network?.preferredOrigin && setShareOrigin(network.preferredOrigin))
      .catch(() => undefined)
  }, [])

  function enterRoom(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim()
    const cleanCode = roomCode.trim().toUpperCase()
    if (!cleanName) return setError('Escolha um nome antes de entrar.')
    setError('')
    setJoining(true)
    sessionStorage.setItem('tile-rush-name', cleanName)

    const send = () => {
      const eventName = cleanCode ? 'room:join' : 'room:create'
      socket.emit(eventName, { name: cleanName, code: cleanCode }, (result: { ok: boolean; code?: string; message?: string }) => {
        if (!result.ok) {
          setError(result.message ?? 'Não foi possível entrar na sala.')
          setJoining(false)
          return
        }
        const code = result.code ?? cleanCode
        setRoomCode(code)
        history.replaceState(null, '', `?sala=${code}`)
      })
    }

    if (socket.connected) send()
    else {
      socket.connect()
      socket.once('connect', send)
      window.setTimeout(() => {
        if (!socket.connected) {
          setJoining(false)
          setError('O servidor não respondeu. Confira se ele está ligado.')
        }
      }, 5000)
    }
  }

  function leaveRoom() {
    socket.disconnect()
    setRoom(null)
    setRoomCode('')
    setError('')
    history.replaceState(null, '', location.pathname)
  }

  async function copyInvite() {
    const url = `${shareOrigin}${location.pathname}?sala=${room?.code}`
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url)
    else {
      const field = document.createElement('textarea')
      field.value = url
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.appendChild(field)
      field.select()
      document.execCommand('copy')
      field.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const player = room?.players.find((item) => item.id === socket.id) ?? null

  if (!room || !player) {
    return <Landing name={name} roomCode={roomCode} setName={setName} setRoomCode={setRoomCode} enterRoom={enterRoom} error={error} joining={joining} />
  }
  if (room.status === 'lobby') return <Lobby room={room} player={player} copied={copied} copyInvite={copyInvite} shareOrigin={shareOrigin} leaveRoom={leaveRoom} />
  if (room.status === 'finished') return <MatchFinished room={room} player={player} leaveRoom={leaveRoom} />
  return <Game room={room} player={player} serverOffset={serverOffset} leaveRoom={leaveRoom} />
}

type LandingProps = {
  name: string; roomCode: string; setName: (value: string) => void; setRoomCode: (value: string) => void
  enterRoom: (event: FormEvent) => void; error: string; joining: boolean
}

function Landing({ name, roomCode, setName, setRoomCode, enterRoom, error, joining }: LandingProps) {
  return (
    <main className="minimal-entry-shell">
      <section className="minimal-entry">
        <a className="entry-wordmark" href="/" aria-label="Tile Rush Arena — início">TILE RUSH</a>
        <form className="entry-form" onSubmit={enterRoom}>
          <label htmlFor="player-name">NOME</label>
          <div className="entry-input-wrap">
            <input id="player-name" maxLength={18} value={name} onChange={(event) => setName(event.target.value)} placeholder="roberto" autoComplete="nickname" autoFocus />
            <span>{name.length}/18</span>
          </div>
          <label htmlFor="room-code">CÓDIGO DA SALA <small>OPCIONAL</small></label>
          <input id="room-code" className="entry-code" maxLength={5} value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ABCDE" />
          {error && <div className="entry-error" role="alert">{error}</div>}
          <button className="entry-button" type="submit" disabled={joining}>{joining ? 'CONECTANDO...' : roomCode ? 'ENTRAR NA SALA' : 'CRIAR SALA'}<ArrowRight size={17} /></button>
        </form>
      </section>
    </main>
  )
}

function Lobby({ room, player, copied, copyInvite, shareOrigin, leaveRoom }: { room: RoomSnapshot; player: PlayerSnapshot; copied: boolean; copyInvite: () => void; shareOrigin: string; leaveRoom: () => void }) {
  const everyoneReady = room.players.every((item) => item.ready)
  const canStart = player.isLeader && everyoneReady && room.players.length > 0
  return (
    <main className="app-shell lobby-shell">
      <AppHeader room={room} leaveRoom={leaveRoom} />
      <section className="lobby-content">
        <div className="lobby-title-row">
          <div><span className="section-kicker"><i /> SALA ABERTA</span><h1>PREPARE-SE<br /><em>PARA CORRER.</em></h1></div>
          <div className="room-ticket"><span>CÓDIGO DA SALA</span><strong>{room.code}</strong><button onClick={copyInvite}><Clipboard size={15} /> {copied ? 'LINK COPIADO' : 'COPIAR CONVITE'}</button><small className="lan-address">{shareOrigin.replace(/^https?:\/\//, '')}</small></div>
        </div>
        <div className="lobby-board">
          <div className="roster-panel">
            <div className="panel-heading"><div><Users size={17} /><strong>JOGADORES</strong><span>{room.players.length}/15</span></div><small>Todos precisam estar prontos</small></div>
            <div className="player-grid">
              {room.players.map((item, index) => <PlayerSlot key={item.id} player={item} index={index} isYou={item.id === player.id} />)}
              {Array.from({ length: Math.max(0, 6 - room.players.length) }, (_, index) => <div className="player-slot empty" key={`empty-${index}`}><span>+</span><small>AGUARDANDO</small></div>)}
            </div>
          </div>
          <aside className="settings-panel">
            <div className="panel-heading"><div><Gamepad2 size={17} /><strong>CONFIGURAÇÃO</strong></div></div>
            <label>QUANTIDADE DE RODADAS</label>
            <div className="round-selector">{[1, 3, 5, 7].map((count) => <button disabled={!player.isLeader} className={room.rounds === count ? 'active' : ''} key={count} onClick={() => socket.emit('room:set-rounds', count)}>{count}</button>)}</div>
            <div className="setting-note"><Flag size={16} /><span><strong>{room.rounds} {room.rounds === 1 ? 'PERCURSO' : 'PERCURSOS'}</strong><small>Um labirinto novo por rodada</small></span></div>
            {!player.isLeader && <p className="leader-note"><Crown size={13} /> Apenas o líder altera as rodadas.</p>}
            <div className="settings-spacer" />
            <button className={`ready-button ${player.ready ? 'is-ready' : ''}`} onClick={() => socket.emit('room:set-ready', !player.ready)}>{player.ready ? <><Check size={20} /> PRONTO!</> : <>MARCAR COMO PRONTO <ArrowRight size={20} /></>}</button>
            {player.isLeader && <button className="start-button" disabled={!canStart} onClick={() => socket.emit('room:start')}><Zap size={18} /> INICIAR PARTIDA</button>}
            <p className="waiting-copy">{everyoneReady ? 'A equipe está pronta.' : `Esperando ${room.players.filter((item) => !item.ready).length} jogador(es)…`}</p>
          </aside>
        </div>
      </section>
    </main>
  )
}

function PlayerSlot({ player, index, isYou }: { player: PlayerSnapshot; index: number; isYou: boolean }) {
  return <div className={`player-slot ${player.ready ? 'ready' : ''}`}><div className="avatar" style={{ '--player-color': player.color } as React.CSSProperties}>{player.name.slice(0, 1).toUpperCase()}</div><div className="player-info"><strong>{player.name}{isYou && <em>VOCÊ</em>}</strong><span>{player.isLeader ? <><Crown size={11} /> LÍDER</> : `JOGADOR ${String(index + 1).padStart(2, '0')}`}</span></div><div className="ready-state">{player.ready ? <Check size={15} /> : <i />}</div></div>
}

function AppHeader({ room, leaveRoom }: { room: RoomSnapshot; leaveRoom: () => void }) {
  return <nav className="game-topbar"><a className="brand" href="/" onClick={(event) => { event.preventDefault(); leaveRoom() }}><span className="brand-mark"><span /></span><span>TILE_RUSH.EXE</span></a><div className="header-room"><span>SALA</span><strong>{room.code}</strong><i /></div><button className="leave-button" onClick={leaveRoom}><LogOut size={15} /> SAIR</button></nav>
}

function Game({ room, player, serverOffset, leaveRoom }: { room: RoomSnapshot; player: PlayerSnapshot; serverOffset: number; leaveRoom: () => void }) {
  const now = useClock(50) + serverOffset
  const [spectating, setSpectating] = useState<string | null>(null)
  const unfinishedPlayers = room.players.filter((item) => item.finishedAt === null)
  const shouldSpectate = player.finishedAt !== null
  const canMove = room.status === 'playing' || (room.status === 'countdown' && room.countdownEndsAt !== null && now >= room.countdownEndsAt)

  useEffect(() => setSpectating(null), [room.currentRound])

  useEffect(() => {
    if (spectating && !room.players.some((item) => item.id === spectating)) setSpectating(null)
    else if (shouldSpectate && (!spectating || spectating === player.id) && unfinishedPlayers.length > 0) setSpectating(unfinishedPlayers[0].id)
  }, [shouldSpectate, spectating, room.players, unfinishedPlayers, player.id])

  useEffect(() => {
    const directions: Record<string, Direction> = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' }
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = directions[event.key]
      if (!direction || !canMove || player.finishedAt !== null) return
      event.preventDefault(); socket.emit('player:move', direction)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canMove, player.finishedAt])

  const focusPlayer = room.players.find((item) => item.id === spectating) ?? player
  const isViewingOther = focusPlayer.id !== player.id
  const elapsed = player.finishedAt ?? (room.roundStartedAt ? Math.max(0, now - room.roundStartedAt) : 0)
  const countdown = room.countdownEndsAt ? Math.max(0, Math.ceil((room.countdownEndsAt - now) / 1000)) : 0
  const mazeHeight = room.maze?.height ?? 25
  const sortedPlayers = [...room.players].sort((a, b) => {
    if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt
    if (a.finishedAt !== null) return -1
    if (b.finishedAt !== null) return 1
    return a.position.y - b.position.y
  })

  return (
    <main className="game-shell">
      <header className="race-header">
        <a className="brand light-brand" href="/" onClick={(event) => { event.preventDefault(); leaveRoom() }}><span className="brand-mark"><span /></span><span>TILE_RUSH.EXE</span></a>
        <div className="round-progress"><span>RODADA</span><strong>{room.currentRound}<small>/ {room.rounds}</small></strong><div>{Array.from({ length: room.rounds }, (_, index) => <i className={index < room.currentRound ? 'done' : ''} key={index} />)}</div></div>
        <div className="race-clock"><span>{room.status === 'countdown' ? 'COMEÇA EM' : 'SEU TEMPO'}</span><strong>{room.status === 'countdown' ? `00:0${countdown}` : formatTime(elapsed)}</strong></div>
        <div className="race-room"><span>SALA {room.code}</span><i /> AO VIVO</div>
      </header>
      <section className="race-layout">
        <div className="course-column">
          <div className="course-caption"><div><span>{isViewingOther ? <><Eye size={13} /> ASSISTINDO</> : 'SEU PERCURSO'}</span><strong>{isViewingOther ? focusPlayer.name : 'CHEGUE ATÉ A BANDEIRA'}</strong></div><small>↑ FINAL</small></div>
          {room.maze && <MazeBoard maze={room.maze} players={room.players} focusPlayer={focusPlayer} localPlayerId={player.id} showAll={false} />}
          <div className="course-start">INÍCIO <i /></div>
          {room.status === 'countdown' && countdown > 0 && <div className="countdown-overlay"><span>{countdown}</span><small>PREPARE-SE</small></div>}
          {shouldSpectate && room.status === 'playing' && <div className="finished-badge"><Check size={18} /><span><strong>VOCÊ TERMINOU EM {ordinal(player.finishPlace)}</strong><small>Aguardando {unfinishedPlayers.length} jogador(es)</small></span></div>}
        </div>
        <aside className="racer-rail">
          <div className="rail-heading"><div><Radio size={15} /><strong>CORRIDA AO VIVO</strong></div><span>{unfinishedPlayers.length} CORRENDO</span></div>
          <div className="racer-list">
            {sortedPlayers.map((item, index) => <button type="button" aria-label={`Ver percurso de ${item.name}`} key={item.id} style={{ '--player-color': item.color } as React.CSSProperties} className={`racer-card ${item.id === focusPlayer.id ? 'selected' : ''} ${item.finishedAt !== null ? 'finished' : ''}`} onClick={() => setSpectating(item.id)}>
              <span className="race-position">{item.finishPlace ? ordinal(item.finishPlace) : String(index + 1).padStart(2, '0')}</span>
              {room.maze && <MiniMaze maze={room.maze} player={item} />}
              <span className="racer-meta"><strong><i style={{ background: item.color }} />{item.name}{item.id === player.id && <em>VOCÊ</em>}</strong><small>{item.finishedAt !== null ? formatTime(item.finishedAt) : `${Math.round(((mazeHeight - 1 - item.position.y) / (mazeHeight - 1)) * 100)}% DO PERCURSO`}</small></span>
              {item.finishedAt !== null && <Check className="finish-check" size={16} />}
            </button>)}
          </div>
          <div className="controls-card"><div><span>CONTROLES</span><small>Mova um tile por vez</small></div><div className="key-cluster"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div><span className="or">OU</span><div className="key-cluster arrows"><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></div></div>
        </aside>
      </section>
      <TouchControls disabled={!canMove || player.finishedAt !== null} />
      {room.status === 'results' && <RoundResults room={room} now={now} />}
    </main>
  )
}

function MazeBoard({ maze, players, focusPlayer, localPlayerId, showAll }: { maze: Maze; players: PlayerSnapshot[]; focusPlayer: PlayerSnapshot; localPlayerId: string; showAll: boolean }) {
  const visiblePlayers = showAll ? players : [focusPlayer]
  const isOwnView = focusPlayer.id === localPlayerId
  const focusColor = isOwnView ? '#f4f4f4' : focusPlayer.color
  return <div className={`maze-frame ${isOwnView ? 'own-view' : 'spectator-view'}`} style={{ '--focus-color': focusColor } as React.CSSProperties}><div className="maze-board" style={{ '--columns': maze.width, '--rows': maze.height } as React.CSSProperties}>
    {maze.cells.flatMap((row, y) => row.map((cell, x) => <div key={`${x}-${y}`} className={`maze-cell ${cell ? 'wall' : 'path'} ${x === maze.finish.x && y === maze.finish.y ? 'goal' : ''}`} />))}
    {visiblePlayers.map((item) => <div key={item.id} className="maze-player" style={{ '--x': item.position.x, '--y': item.position.y, '--player-color': item.id === localPlayerId ? '#f4f4f4' : item.color } as React.CSSProperties}><span /></div>)}
    <div className="goal-flag" style={{ '--x': maze.finish.x, '--y': maze.finish.y } as React.CSSProperties}><Flag size={11} fill="currentColor" /></div>
  </div></div>
}

function MiniMaze({ maze, player }: { maze: Maze; player: PlayerSnapshot }) {
  return <div className="mini-maze" style={{ '--columns': maze.width, '--rows': maze.height, '--player-color': player.color } as React.CSSProperties}>{maze.cells.flatMap((row, y) => row.map((cell, x) => <i key={`${x}-${y}`} className={cell ? 'wall' : ''} />))}<b style={{ '--x': player.position.x, '--y': player.position.y, '--player-color': player.color } as React.CSSProperties} /></div>
}

function TouchControls({ disabled }: { disabled: boolean }) {
  const move = (direction: Direction) => !disabled && socket.emit('player:move', direction)
  return <div className="touch-controls" aria-label="Controles de movimento"><button disabled={disabled} onPointerDown={() => move('up')} aria-label="Cima"><ChevronUp /></button><button disabled={disabled} onPointerDown={() => move('left')} aria-label="Esquerda"><ChevronLeft /></button><button disabled={disabled} onPointerDown={() => move('down')} aria-label="Baixo"><ChevronDown /></button><button disabled={disabled} onPointerDown={() => move('right')} aria-label="Direita"><ChevronRight /></button></div>
}

function RoundResults({ room, now }: { room: RoomSnapshot; now: number }) {
  const seconds = room.nextRoundAt ? Math.max(0, Math.ceil((room.nextRoundAt - now) / 1000)) : 0
  return <div className="modal-backdrop result-backdrop"><section className="results-modal"><span className="modal-kicker">RODADA {room.currentRound} CONCLUÍDA</span><h2>{room.roundResults[0]?.name ?? 'Ninguém'} <em>VENCEU!</em></h2><div className="result-table">{room.roundResults.map((result, index) => <ResultRow key={result.id} result={result} index={index} />)}</div><div className="next-round"><span>{room.currentRound >= room.rounds ? 'PLACAR FINAL EM' : 'PRÓXIMO PERCURSO EM'}</span><strong>{seconds}</strong><div><i style={{ width: `${(seconds / 7) * 100}%` }} /></div></div></section></div>
}

function ResultRow({ result, index }: { result: RoundResult; index: number }) {
  return <div className={`result-row place-${index + 1}`}><span>{ordinal(result.place)}</span><i style={{ background: result.color }} /><strong>{result.name}</strong><small>{formatTime(result.time)}</small><b>+{result.points}</b></div>
}

function MatchFinished({ room, player, leaveRoom }: { room: RoomSnapshot; player: PlayerSnapshot; leaveRoom: () => void }) {
  const ranking = [...room.players].sort((a, b) => b.score - a.score)
  const winner = ranking[0]
  return <main className="app-shell final-shell"><AppHeader room={room} leaveRoom={leaveRoom} /><section className="final-content"><div className="trophy-box"><Trophy size={55} strokeWidth={1.5} /><i /><i /></div><span className="section-kicker">PARTIDA CONCLUÍDA</span><h1>{winner.name}<br /><em>DOMINOU A ARENA.</em></h1><p>Depois de {room.rounds} {room.rounds === 1 ? 'percurso' : 'percursos'}, este é o placar definitivo.</p><div className="final-ranking">{ranking.map((item, index) => <div className={`final-player rank-${index + 1}`} key={item.id}><span>{index < 3 ? <Medal size={21} /> : `${index + 1}º`}</span><i>{item.name.slice(0, 1).toUpperCase()}</i><strong>{item.name}{item.id === player.id && <em>VOCÊ</em>}</strong><b>{item.score}<small> PTS</small></b></div>)}</div><div className="final-actions">{player.isLeader && <button className="primary-button" onClick={() => socket.emit('room:rematch')}><RotateCcw size={18} /> JOGAR NOVAMENTE</button>}<button className="secondary-button" onClick={leaveRoom}><ArrowLeft size={17} /> VOLTAR AO INÍCIO</button></div></section></main>
}
