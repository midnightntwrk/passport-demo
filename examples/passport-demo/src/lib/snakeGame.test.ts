import { describe, expect, it } from 'vitest'

import {
  SNAKE_BOARD,
  SNAKE_CALM_TICK_MS,
  SNAKE_FASTEST_TICK_MS,
  SNAKE_START_LENGTH,
  SNAKE_SWIPE_MIN_PX,
  SNAKE_TICK_MS,
  createSnake,
  pauseSnake,
  placeFood,
  restartSnake,
  resumeSnake,
  snakeDirectionOfKey,
  snakeDirectionOfSwipe,
  snakeTickMs,
  stepSnake,
  turnSnake,
  type SnakeCell,
  type SnakeState,
} from './snakeGame.js'

/** A random source that always answers `value`. */
const fixed = (value: number) => () => value

/** A game on a small board, with the snake and food exactly where a drill wants them. */
function game(overrides: Partial<SnakeState> = {}): SnakeState {
  return {
    columns: 6,
    rows: 5,
    snake: [
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ],
    direction: 'right',
    queued: [],
    food: { x: 5, y: 0 },
    score: 0,
    best: 0,
    status: 'running',
    won: false,
    ...overrides,
  }
}

const cells = (state: SnakeState): string => state.snake.map((cell) => `${cell.x},${cell.y}`).join(' ')

describe('a new game', () => {
  it('starts short, in the middle, heading right, and waiting', () => {
    const state = createSnake(fixed(0))
    expect(state.columns).toBe(SNAKE_BOARD.columns)
    expect(state.rows).toBe(SNAKE_BOARD.rows)
    expect(state.snake).toHaveLength(SNAKE_START_LENGTH)
    expect(cells(state)).toBe('8,6 7,6 6,6')
    expect(state.direction).toBe('right')
    expect(state.status).toBe('ready')
    expect(state.score).toBe(0)
    expect(state.best).toBe(0)
    expect(state.won).toBe(false)
  })

  it('puts the food on the first free cell the random number names', () => {
    expect(createSnake(fixed(0)).food).toEqual({ x: 0, y: 0 })
  })

  it('takes its board size and a best score from the caller', () => {
    const state = createSnake(fixed(0), { columns: 8, rows: 4, best: 7 })
    expect(cells(state)).toBe('4,2 3,2 2,2')
    expect(state.best).toBe(7)
  })

  it('keeps the best score, and only that, across a restart', () => {
    const played = game({ score: 5, best: 9, status: 'over', columns: 6, rows: 5 })
    const again = restartSnake(played, fixed(0))
    expect(again.best).toBe(9)
    expect(again.score).toBe(0)
    expect(again.status).toBe('ready')
    expect(again.columns).toBe(6)
  })
})

describe('placing the food', () => {
  const snake: SnakeCell[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]

  it('never puts it on the snake', () => {
    expect(placeFood(snake, 2, 2, fixed(0))).toEqual({ x: 0, y: 1 })
    expect(placeFood(snake, 2, 2, fixed(0.99))).toEqual({ x: 1, y: 1 })
  })

  it('keeps an out-of-range random number on the board', () => {
    expect(placeFood(snake, 2, 2, fixed(1))).toEqual({ x: 1, y: 1 })
    expect(placeFood(snake, 2, 2, fixed(-1))).toEqual({ x: 0, y: 1 })
  })

  it('has nowhere to put it on a full board', () => {
    expect(placeFood([{ x: 0, y: 0 }], 1, 1, fixed(0))).toBeNull()
  })
})

describe('turning', () => {
  it('starts a ready game on the first turn', () => {
    const ready = game({ status: 'ready' })
    const turned = turnSnake(ready, 'up')
    expect(turned.status).toBe('running')
    expect(turned.queued).toEqual(['up'])
  })

  it('starts a ready game on a press that is not a turn, too', () => {
    expect(turnSnake(game({ status: 'ready' }), 'right').status).toBe('running')
  })

  it('ignores a turn back into the body, and a repeat of the way it is going', () => {
    const running = game()
    expect(turnSnake(running, 'left')).toBe(running)
    expect(turnSnake(running, 'right')).toBe(running)
  })

  it('queues two quick turns in order, and judges the second against the first', () => {
    const once = turnSnake(game(), 'up')
    expect(turnSnake(once, 'down')).toBe(once)
    const twice = turnSnake(once, 'left')
    expect(twice.queued).toEqual(['up', 'left'])
    /* No more than two ahead. */
    expect(turnSnake(twice, 'down')).toBe(twice)
  })

  it('does nothing to a game that is paused or over', () => {
    const paused = game({ status: 'paused' })
    const over = game({ status: 'over' })
    expect(turnSnake(paused, 'up')).toBe(paused)
    expect(turnSnake(over, 'up')).toBe(over)
  })
})

describe('pausing', () => {
  it('stops a running game and carries it on again', () => {
    const paused = pauseSnake(game())
    expect(paused.status).toBe('paused')
    expect(resumeSnake(paused).status).toBe('running')
    expect(resumeSnake(game({ status: 'ready' })).status).toBe('running')
  })

  it('leaves every other state untouched', () => {
    const over = game({ status: 'over' })
    const ready = game({ status: 'ready' })
    expect(pauseSnake(over)).toBe(over)
    expect(pauseSnake(ready)).toBe(ready)
    expect(resumeSnake(over)).toBe(over)
    const running = game()
    expect(resumeSnake(running)).toBe(running)
  })

  it('never advances a game that is not running — the promise the screen leans on', () => {
    for (const status of ['ready', 'paused', 'over'] as const) {
      const state = game({ status })
      expect(stepSnake(state, fixed(0))).toBe(state)
    }
  })
})

describe('a step', () => {
  it('moves the whole snake one cell the way it is going', () => {
    const next = stepSnake(game(), fixed(0))
    expect(cells(next)).toBe('3,2 2,2 1,2')
    expect(next.score).toBe(0)
    expect(next.status).toBe('running')
  })

  it('takes the oldest queued turn, and leaves the other for the next step', () => {
    const turned = turnSnake(turnSnake(game(), 'up'), 'left')
    const first = stepSnake(turned, fixed(0))
    expect(first.direction).toBe('up')
    expect(cells(first)).toBe('2,1 2,2 1,2')
    expect(first.queued).toEqual(['left'])
    const second = stepSnake(first, fixed(0))
    expect(cells(second)).toBe('1,1 2,1 2,2')
  })

  it('grows by one, scores, and puts the food somewhere free when it eats', () => {
    const eating = game({ food: { x: 3, y: 2 }, best: 0 })
    const next = stepSnake(eating, fixed(0))
    expect(cells(next)).toBe('3,2 2,2 1,2 0,2')
    expect(next.score).toBe(1)
    expect(next.best).toBe(1)
    expect(next.food).toEqual({ x: 0, y: 0 })
    expect(next.status).toBe('running')
  })

  it('keeps a best score higher than the run', () => {
    const next = stepSnake(game({ food: { x: 3, y: 2 }, best: 12 }), fixed(0))
    expect(next.best).toBe(12)
  })

  it.each([
    ['right', { x: 5, y: 2 }],
    ['left', { x: 0, y: 2 }],
    ['up', { x: 2, y: 0 }],
    ['down', { x: 2, y: 4 }],
  ] as const)('ends at the %s wall', (direction, head) => {
    const state = game({
      snake: [head],
      direction,
    })
    const next = stepSnake(state, fixed(0))
    expect(next.status).toBe('over')
    expect(next.won).toBe(false)
    expect(next.snake).toBe(state.snake)
  })

  it('ends when the head runs into the body', () => {
    /* A hook: the head at (2,2) heading down into (2,3), which is body. */
    const state = game({
      snake: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 2, y: 3 },
        { x: 1, y: 3 },
      ],
      direction: 'left',
      queued: ['down'],
    })
    expect(stepSnake(state, fixed(0)).status).toBe('over')
  })

  it('may follow its own tail into the cell the tail is leaving', () => {
    const loop = game({
      snake: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
      ],
      direction: 'left',
      queued: ['down'],
    })
    const next = stepSnake(loop, fixed(0))
    expect(next.status).toBe('running')
    expect(cells(next)).toBe('1,2 1,1 2,1 2,2')
  })

  it('may not run into its tail on the step it grows', () => {
    const loop = game({
      snake: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
      ],
      direction: 'left',
      queued: ['down'],
      food: { x: 1, y: 2 },
    })
    expect(stepSnake(loop, fixed(0)).status).toBe('over')
  })

  it('wins when the last free cell is eaten', () => {
    const almost = game({
      columns: 2,
      rows: 2,
      snake: [
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      direction: 'down',
      queued: ['right'],
      food: { x: 1, y: 1 },
    })
    const won = stepSnake(almost, fixed(0))
    expect(won.status).toBe('over')
    expect(won.won).toBe(true)
    expect(won.food).toBeNull()
    expect(won.score).toBe(1)
  })

  it('replays exactly from the same random numbers', () => {
    const play = () => {
      let state = turnSnake(createSnake(fixed(0.5)), 'down')
      for (let index = 0; index < 20; index += 1) {
        state = stepSnake(state, fixed(0.37))
        if (index === 3) state = turnSnake(state, 'left')
      }
      return state
    }
    expect(play()).toEqual(play())
  })
})

describe('pace, keys, and swipes', () => {
  it('speeds up a little with every point, down to a floor', () => {
    expect(snakeTickMs(0, false)).toBe(SNAKE_TICK_MS)
    expect(snakeTickMs(5, false)).toBe(SNAKE_TICK_MS - 20)
    expect(snakeTickMs(1_000, false)).toBe(SNAKE_FASTEST_TICK_MS)
  })

  it('keeps one slow, steady pace for a reader who asked for less motion', () => {
    expect(snakeTickMs(0, true)).toBe(SNAKE_CALM_TICK_MS)
    expect(snakeTickMs(50, true)).toBe(SNAKE_CALM_TICK_MS)
  })

  it.each([
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    ['w', 'up'],
    ['A', 'left'],
    ['s', 'down'],
    ['D', 'right'],
    [' ', null],
    ['Enter', null],
  ] as const)('reads %j as %s', (key, direction) => {
    expect(snakeDirectionOfKey(key)).toBe(direction)
  })

  it('reads a swipe by its longer axis, and a short one as a tap', () => {
    expect(snakeDirectionOfSwipe(40, 10)).toBe('right')
    expect(snakeDirectionOfSwipe(-40, 10)).toBe('left')
    expect(snakeDirectionOfSwipe(5, 40)).toBe('down')
    expect(snakeDirectionOfSwipe(5, -40)).toBe('up')
    expect(snakeDirectionOfSwipe(SNAKE_SWIPE_MIN_PX - 1, 0)).toBeNull()
  })
})
