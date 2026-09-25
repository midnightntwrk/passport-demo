/**
 * SNAKE, THE RULES AND NOTHING ELSE — the game offered while recovery is
 * being added (2026/09/24).
 *
 * "Add a different mini game, like Snake, to play while it is being done." The
 * setup keeps its runner (`./waitingGame.ts`); the recovery add gets this, so
 * the two waits do not feel like the same wait twice.
 *
 * IT HOLDS NO CANVAS, NO TIMER, NO KEYBOARD, AND NO `Math.random`. A state goes
 * in and a state comes out; the random numbers food is placed with are handed
 * in by the caller, so a run replays exactly and every rule — the turn that
 * cannot reverse, the wall, the body, the growth, the full board — is drilled
 * in `./snakeGame.test.ts` rather than eyeballed. Its other half,
 * `../screens/SnakeGame.tsx`, measures time, reads keys and swipes, and paints.
 *
 * THE PROMISE IT SHARES WITH THE RUNNER: a step on a state that is not running
 * returns that same state, unadvanced. That is what makes "stop the instant the
 * reader is wanted" one call rather than a race with a timer.
 */

export type SnakeDirection = 'up' | 'down' | 'left' | 'right'

export interface SnakeCell {
  readonly x: number
  readonly y: number
}

/** Every state the game can be in. Only `running` advances. */
export type SnakeStatus = 'ready' | 'running' | 'paused' | 'over'

export interface SnakeState {
  readonly columns: number
  readonly rows: number
  /** Head first. */
  readonly snake: readonly SnakeCell[]
  /** The way the snake moved on its last step. */
  readonly direction: SnakeDirection
  /** Turns pressed and not yet taken, oldest first — at most two. */
  readonly queued: readonly SnakeDirection[]
  /** Null only when there is nowhere left to put it: the board is full. */
  readonly food: SnakeCell | null
  readonly score: number
  /** The best score this wait, carried across restarts. */
  readonly best: number
  readonly status: SnakeStatus
  /** True when the game ended because the snake filled the board. */
  readonly won: boolean
}

/** A number in [0, 1), as `Math.random` gives one. Injected, never read here. */
export type SnakeRandom = () => number

/** The board the screen paints: small enough to cross in a couple of seconds. */
export const SNAKE_BOARD = { columns: 16, rows: 12 } as const

/** The length a new snake starts at. */
export const SNAKE_START_LENGTH = 3

/** How many turns can be pressed ahead of the snake. */
const QUEUE_LIMIT = 2

const DELTA: Record<SnakeDirection, SnakeCell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<SnakeDirection, SnakeDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

function same(a: SnakeCell, b: SnakeCell): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * Where the food goes: one of the free cells, chosen by `random`, or null when
 * there are none. A `random` that returns 1 or more (which `Math.random` never
 * does, and a careless fake might) lands on the last free cell rather than off
 * the board.
 */
export function placeFood(
  snake: readonly SnakeCell[],
  columns: number,
  rows: number,
  random: SnakeRandom,
): SnakeCell | null {
  const free: SnakeCell[] = []
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (!snake.some((cell) => cell.x === x && cell.y === y)) free.push({ x, y })
    }
  }
  if (free.length === 0) return null
  const index = Math.min(free.length - 1, Math.max(0, Math.floor(random() * free.length)))
  return free[index]
}

/**
 * A new game: a short snake in the middle of the board, heading right, and
 * waiting for its first turn or press. `best` carries a previous run's best.
 */
export function createSnake(
  random: SnakeRandom,
  options: { columns?: number; rows?: number; best?: number } = {},
): SnakeState {
  const columns = options.columns ?? SNAKE_BOARD.columns
  const rows = options.rows ?? SNAKE_BOARD.rows
  const headX = Math.floor(columns / 2)
  const y = Math.floor(rows / 2)
  const snake: SnakeCell[] = []
  for (let index = 0; index < SNAKE_START_LENGTH; index += 1) snake.push({ x: headX - index, y })
  return {
    columns,
    rows,
    snake,
    direction: 'right',
    queued: [],
    food: placeFood(snake, columns, rows, random),
    score: 0,
    best: options.best ?? 0,
    status: 'ready',
    won: false,
  }
}

/** A new game on the same board, keeping the best score. */
export function restartSnake(state: SnakeState, random: SnakeRandom): SnakeState {
  return createSnake(random, { columns: state.columns, rows: state.rows, best: state.best })
}

/**
 * A turn pressed. It is QUEUED rather than applied, so two quick presses
 * between steps are both taken in order — the classic way a fast turn gets
 * eaten. A turn back the way the snake came, or a repeat of the last one, is
 * ignored: reversing into the body is not a move, it is a trap.
 *
 * A turn on a game that is ready starts it; on one that is paused or over it
 * does nothing, because the reader was not playing.
 */
export function turnSnake(state: SnakeState, direction: SnakeDirection): SnakeState {
  if (state.status === 'paused' || state.status === 'over') return state
  const last = state.queued.at(-1) ?? state.direction
  if (direction === last || direction === OPPOSITE[last] || state.queued.length >= QUEUE_LIMIT) {
    return state.status === 'ready' ? { ...state, status: 'running' } : state
  }
  return { ...state, queued: [...state.queued, direction], status: 'running' }
}

/** Starts a ready game, or carries on with a paused one. */
export function resumeSnake(state: SnakeState): SnakeState {
  return state.status === 'ready' || state.status === 'paused' ? { ...state, status: 'running' } : state
}

/** Stops a running game where it is. Anything else is returned untouched. */
export function pauseSnake(state: SnakeState): SnakeState {
  return state.status === 'running' ? { ...state, status: 'paused' } : state
}

/**
 * One step. The next queued turn is taken, the head moves one cell, and then:
 *
 *   a wall or the body ends the game — the body without its last cell, which
 *   moves out of the way on the same step unless the snake is growing;
 *   the food grows the snake by one, scores, and is put somewhere free — and a
 *   board with nowhere free is a game won;
 *   anything else is a move.
 */
export function stepSnake(state: SnakeState, random: SnakeRandom): SnakeState {
  if (state.status !== 'running') return state
  const [next, ...rest] = state.queued
  const direction = next ?? state.direction
  const head = state.snake[0]
  const delta = DELTA[direction]
  const moved: SnakeCell = { x: head.x + delta.x, y: head.y + delta.y }
  const base = { ...state, direction, queued: rest }

  const offBoard = moved.x < 0 || moved.y < 0 || moved.x >= state.columns || moved.y >= state.rows
  const eating = state.food !== null && same(moved, state.food)
  const body = eating ? state.snake : state.snake.slice(0, -1)
  if (offBoard || body.some((cell) => same(cell, moved))) {
    return { ...base, status: 'over' }
  }

  if (!eating) return { ...base, snake: [moved, ...body] }
  const snake = [moved, ...state.snake]
  const score = state.score + 1
  const food = placeFood(snake, state.columns, state.rows, random)
  return {
    ...base,
    snake,
    score,
    best: Math.max(state.best, score),
    food,
    status: food === null ? 'over' : 'running',
    won: food === null,
  }
}

/* -------------------------------------------------------------------------- */
/* Pace, keys, and swipes                                                     */
/* -------------------------------------------------------------------------- */

/** The step at the start of a game. */
export const SNAKE_TICK_MS = 150
/** The fastest it gets. */
export const SNAKE_FASTEST_TICK_MS = 90
/** A reader who asked for less motion gets a slower snake that does not speed up. */
export const SNAKE_CALM_TICK_MS = 240

/**
 * Milliseconds between steps: a little faster with every point, down to a
 * floor — or one slow, steady pace for a reader who asked for less motion.
 */
export function snakeTickMs(score: number, reducedMotion: boolean): number {
  if (reducedMotion) return SNAKE_CALM_TICK_MS
  return Math.max(SNAKE_FASTEST_TICK_MS, SNAKE_TICK_MS - score * 4)
}

const KEYS: Record<string, SnakeDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
}

/** The direction a key means — arrows and WASD, either case — or null. */
export function snakeDirectionOfKey(key: string): SnakeDirection | null {
  return KEYS[key] ?? KEYS[key.toLowerCase()] ?? null
}

/** How far a finger has to travel before it is a swipe rather than a tap. */
export const SNAKE_SWIPE_MIN_PX = 24

/** The direction a swipe means, by its longer axis, or null for a tap. */
export function snakeDirectionOfSwipe(dx: number, dy: number): SnakeDirection | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SNAKE_SWIPE_MIN_PX) return null
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}
