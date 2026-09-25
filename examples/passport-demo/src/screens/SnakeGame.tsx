import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, X } from 'lucide-react'

import {
  createSnake,
  pauseSnake,
  restartSnake,
  resumeSnake,
  snakeDirectionOfKey,
  snakeDirectionOfSwipe,
  snakeTickMs,
  stepSnake,
  turnSnake,
  type SnakeDirection,
  type SnakeState,
} from '../lib/snakeGame.js'
import './waiting-game.css'
import './snake-game.css'

/**
 * Snake, painted — a timer, a few listeners, and a canvas (2026/09/24).
 *
 * IT HOLDS NO RULES. Where the snake is, what it ate, and whether it hit
 * anything are `../lib/snakeGame.ts`'s, which is drilled; this file keeps
 * time, turns keys, swipes, and presses into directions, and paints.
 *
 * WHAT IT MUST NEVER DO, and it is the waiting runner's list
 * (`./WaitingGame.tsx`):
 *
 *   It never covers anything. It sits BENEATH the timeline in normal flow.
 *
 *   It stops dead when asked. `paused` — a passkey prompt, or the sign-in's
 *   own approval, is up — stops the timer and takes the board out of the
 *   document in the same render; the run is kept in a ref and carries on
 *   when the reader is back. A hidden tab pauses it the same way.
 *
 *   It never takes a key the screen wanted: nothing is read out of a field,
 *   and an arrow key is only claimed while the game is on screen.
 *
 * Reduced motion is a slower, steady snake and nothing that flashes — which
 * is nothing at all here: a game that ends simply stops and says so.
 */

/** A colour token off the element, with a fallback for a page without it. */
function token(element: Element, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim()
  return value.length > 0 ? value : fallback
}

/** The side of one cell on the canvas, in CSS pixels. */
const CELL = 18

export interface SnakeGameProps {
  /** True whenever the host needs the reader back. The run is kept. */
  paused: boolean
  /** Puts the game away for the rest of this wait. */
  onDismiss: () => void
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const DIRECTIONS: readonly { direction: SnakeDirection; label: string; Icon: typeof ArrowUp }[] = [
  { direction: 'up', label: 'Move up', Icon: ArrowUp },
  { direction: 'left', label: 'Move left', Icon: ArrowLeft },
  { direction: 'down', label: 'Move down', Icon: ArrowDown },
  { direction: 'right', label: 'Move right', Icon: ArrowRight },
]

export default function SnakeGame({ paused, onDismiss }: SnakeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const gameRef = useRef<SnakeState>(createSnake(Math.random))
  /* What React re-renders for: the score line and the state it names. The
     board itself is painted, so a step re-renders only when these change. */
  const [view, setView] = useState(() => ({
    status: gameRef.current.status,
    score: gameRef.current.score,
    best: gameRef.current.best,
    won: gameRef.current.won,
  }))
  const [hidden, setHidden] = useState(false)
  const [calm, setCalm] = useState(prefersReducedMotion)
  const swipeFrom = useRef<{ x: number; y: number } | null>(null)

  const publish = useCallback((next: SnakeState) => {
    gameRef.current = next
    setView((previous) =>
      previous.status === next.status &&
      previous.score === next.score &&
      previous.best === next.best &&
      previous.won === next.won
        ? previous
        : { status: next.status, score: next.score, best: next.best, won: next.won },
    )
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return
    const state = gameRef.current
    const width = state.columns * CELL
    const height = state.rows * CELL
    context.clearRect(0, 0, width, height)
    const grid = token(canvas, '--mn-border-hairline', '#252938')
    context.strokeStyle = grid
    context.lineWidth = 1
    context.strokeRect(0.5, 0.5, width - 1, height - 1)
    if (state.food !== null) {
      context.fillStyle = token(canvas, '--mn-accent-violet', '#655cff')
      context.beginPath()
      context.arc(state.food.x * CELL + CELL / 2, state.food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2)
      context.fill()
    }
    const body = token(canvas, '--mn-accent-ink', '#a8adff')
    const head = token(canvas, '--mn-accent', '#0000fe')
    state.snake.forEach((cell, index) => {
      context.fillStyle = index === 0 ? head : body
      context.fillRect(cell.x * CELL + 1, cell.y * CELL + 1, CELL - 2, CELL - 2)
    })
  }, [])

  /* A turn on a game the host paused carries it on: the reader is back, and
     steering is the plainest way of saying so. */
  const turn = useCallback(
    (direction: SnakeDirection) => {
      const current = gameRef.current
      publish(turnSnake(current.status === 'paused' ? resumeSnake(current) : current, direction))
    },
    [publish],
  )

  const restart = useCallback(() => {
    publish(restartSnake(gameRef.current, Math.random))
    draw()
  }, [draw, publish])

  /* A hidden tab is not played in. */
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  /* The reader may change their motion setting with the game open. */
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setCalm(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const stopped = paused || hidden

  /* Drawn at the device's own resolution, once the board is in the document. */
  useEffect(() => {
    if (stopped) {
      publish(pauseSnake(gameRef.current))
      return
    }
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = gameRef.current.columns * CELL * ratio
    canvas.height = gameRef.current.rows * CELL * ratio
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    draw()
  }, [draw, publish, stopped])

  /* THE TIMER. Restarted when the pace changes — a point scored, or the
     motion setting — and stopped the moment the game is. */
  const running = !stopped && view.status === 'running'
  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => {
      publish(stepSnake(gameRef.current, Math.random))
      draw()
    }, snakeTickMs(view.score, calm))
    return () => window.clearInterval(timer)
  }, [calm, draw, publish, running, view.score])

  useEffect(() => {
    if (stopped) return undefined
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true) return
      const direction = snakeDirectionOfKey(event.key)
      if (direction === null) return
      // An arrow scrolls a page; here it steers and does nothing else.
      event.preventDefault()
      turn(direction)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stopped, turn])

  if (stopped) return null

  const line =
    view.status === 'over'
      ? view.won
        ? `The board is full. Score ${view.score}`
        : `Game over. Score ${view.score}, best ${view.best}`
      : view.status === 'ready'
        ? 'Arrow keys, WASD, or swipe to start'
        : view.status === 'paused'
          ? `Paused. Score ${view.score}`
          : `Score ${view.score} · Best ${view.best}`

  return (
    <div className="mngame mnsnake" data-testid="snake-game">
      <div className="mngame-head">
        <span className="mngame-title">Snake</span>
        <button type="button" className="mngame-close" onClick={onDismiss} aria-label="Close the game">
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="mnsnake-board"
        width={gameRef.current.columns * CELL}
        height={gameRef.current.rows * CELL}
        role="img"
        aria-label="Snake board"
        onPointerDown={(event) => {
          swipeFrom.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={(event) => {
          const from = swipeFrom.current
          swipeFrom.current = null
          if (from === null) return
          const direction = snakeDirectionOfSwipe(event.clientX - from.x, event.clientY - from.y)
          if (direction !== null) {
            turn(direction)
          } else if (gameRef.current.status === 'paused' || gameRef.current.status === 'ready') {
            publish(resumeSnake(gameRef.current))
          }
        }}
        onPointerCancel={() => {
          swipeFrom.current = null
        }}
      />
      {/* The score is text, so it is read; polite, and only when it changes. */}
      <p className="mngame-prompt mnsnake-score" aria-live="polite" data-testid="snake-score">
        {line}
      </p>
      <div className="mnsnake-controls">
        <div className="mnsnake-pad" role="group" aria-label="Steer the snake">
          {DIRECTIONS.map(({ direction, label, Icon }) => (
            <button
              key={direction}
              type="button"
              className={`mnsnake-key mnsnake-key-${direction}`}
              aria-label={label}
              onClick={() => turn(direction)}
            >
              <Icon size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
        {view.status === 'over' ? (
          <button type="button" className="mnsnake-restart" onClick={restart}>
            <RotateCcw size={14} aria-hidden="true" />
            Play again
          </button>
        ) : null}
      </div>
    </div>
  )
}
