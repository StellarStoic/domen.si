// Tic-tac-toe behind the contact gate: the reader wins three games and the email address is shown.
//
// Pure logic, no DOM, so the rules can be tested and the difficulty can be *measured* rather than
// guessed. The opponent deliberately is not perfect: a flawless player makes the prize unwinnable,
// which is the one way this feature can fail while every line of code is correct.
//
// The player is X and always moves first; the house is O.

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export const PLAYER = 'X';
export const HOUSE = 'O';
export const WINS_NEEDED = 3;

/** A fresh board: nine nulls, any of which becomes 'X' or 'O'. */
export function emptyBoard() {
  return Array(9).fill(null);
}

export function available(board) {
  return board.reduce((spots, cell, index) => (cell ? spots : spots.concat(index)), []);
}

/** 'X', 'O', 'draw', or null while the game is still open. */
export function outcome(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return available(board).length === 0 ? 'draw' : null;
}

export function winningLine(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return line;
  }
  return null;
}

/** The spot that completes a line for `player`, or null when there is none. */
export function completingMove(board, player) {
  for (const index of available(board)) {
    const trial = board.slice();
    trial[index] = player;
    if (outcome(trial) === player) return index;
  }
  return null;
}

/**
 * The house's move.
 *
 * It takes a win when one exists. It blocks the player only `blockChance` of the time, and otherwise
 * plays a corner or the centre before an edge. That is enough to feel like an opponent and weak
 * enough that three wins do not turn into an afternoon — measured by `simulate()` in the tests.
 */
export function houseMove(board, random = Math.random, blockChance = 0.5) {
  const open = available(board);
  if (!open.length) return null;

  const win = completingMove(board, HOUSE);
  if (win !== null) return win;

  const block = completingMove(board, PLAYER);
  if (block !== null && random() < blockChance) return block;

  const preferred = [4, 0, 2, 6, 8, 1, 3, 5, 7].filter(index => board[index] === null);
  return preferred[Math.floor(random() * preferred.length)] ?? open[0];
}

/** Apply the reader's move and the house's answer. Returns the new board. */
export function playRound(board, index, random = Math.random, blockChance = 0.5) {
  if (board[index] || outcome(board)) return board;
  const afterPlayer = board.slice();
  afterPlayer[index] = PLAYER;
  if (outcome(afterPlayer)) return afterPlayer;
  const answer = houseMove(afterPlayer, random, blockChance);
  if (answer === null) return afterPlayer;
  const afterHouse = afterPlayer.slice();
  afterHouse[answer] = HOUSE;
  return afterHouse;
}

/** A small deterministic random source, so a test can replay a failure. */
export function seeded(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** How many games a straightforward player needs to win `target` times. Used by the tests. */
export function simulate(target = WINS_NEEDED, { seed = 7, blockChance = 0.5, maxGames = 500 } = {}) {
  const random = seeded(seed);
  let wins = 0;
  let games = 0;
  while (wins < target && games < maxGames) {
    games += 1;
    let board = emptyBoard();
    while (!outcome(board)) {
      const open = available(board);
      // a plain, human-ish reader: complete a line if possible, otherwise centre, corner, edge
      const finish = completingMove(board, PLAYER);
      const spot = finish !== null
        ? finish
        : [4, 0, 2, 6, 8, 1, 3, 5, 7].filter(index => open.includes(index))[0];
      board = playRound(board, spot, random, blockChance);
    }
    if (outcome(board) === PLAYER) wins += 1;
  }
  return { wins, games };
}
