<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from "vue"
import * as multiplayer from '../game/multiplayer.js'

const props = defineProps({
  mode: { type: String, default: 'single' },
})

const emit = defineEmits(['back'])

const isMultiplayer = computed(() => props.mode === 'host' || props.mode === 'guest')
const playerIndex = computed(() => props.mode === 'host' ? 0 : (props.mode === 'guest' ? 1 : 0))

const canvas = ref(null)
const score = ref(0)
const gameStatus = ref("idle")
const peerId = ref('')
const myReady = ref(false)
const opponentReady = ref(false)
const countdownValue = ref(5)
const matchScore = ref(0)
const opponentMatchScore = ref(0)
const currentRound = ref(1)
const rematchRequested = ref(false)
const opponentRematch = ref(false)
const WIN_SCORE = 5
let countdownTimer = null


const moveSpeed = ref(10)
const difficulty = ref("normal")
const enableObstacles = ref(false)
const boardSize = ref("medium")

const difficultyOptions = [
  { label: "Easy", value: "easy", speed: 7, obstacles: false },
  { label: "Normal", value: "normal", speed: 10, obstacles: false },
  { label: "Hard", value: "hard", speed: 13, obstacles: true },
  { label: "Insane", value: "insane", speed: 17, obstacles: true }
]

const gameInterval = computed(() => 200 - moveSpeed.value * 10)

const boardSizeOptions = [
  { label: "Small", value: "small", grid: 10 },
  { label: "Medium", value: "medium", grid: 15 },
  { label: "Large", value: "large", grid: 20 }
]

const gameModeOptions = [
  { label: "Normal", value: "normal" },
  { label: "Greedy", value: "greedy" },
  { label: "Auto", value: "auto" }
]

const gameMode = ref("normal")
const ATTRACTION_SPEED = 0.3
const MAX_FOODS = 16

const CANVAS_SIZE = 400

const GRID_SIZE = computed(() => {
  const opt = boardSizeOptions.find(o => o.value === boardSize.value)
  return opt ? opt.grid : 15
})

const CELL_SIZE = computed(() => CANVAS_SIZE / GRID_SIZE.value)

let snake = []
let foods = []
let direction = { x: 1, y: 0 }
let nextDirection = { x: 1, y: 0 }
let animFrameId = null
let inputQueue = []
let guestInputQueue = []
let obstacles = []
let obstaclesActive = false
let prevSnake = []

function sp(index) {
  return snake[index]
}

let opponentSnake = []
let opponentDirection = { x: 1, y: 0 }
let opponentFoods = []
let opponentScore = 0
let opponentAlive = true
let opponentPrevSnake = []

let gameWinner = null
let accumulator = 0
let lastTime = 0
let travelingFood = null
const Q_WEIGHT = 15
const Q_LR = 0.15
const Q_GAMMA = 0.85
let qTable = {}
let lastQState = null
let lastQAction = -1
let prevFoodDist = Infinity

function loadQTable() {
  try { const d = localStorage.getItem("snakeQ"); if (d) qTable = JSON.parse(d) } catch {}
}
function saveQTable() {
  try { localStorage.setItem("snakeQ", JSON.stringify(qTable)) } catch {}
}
function qStateKey(head, foods, gridSize) {
  const bodySet = new Set()
  for (const s of snake) bodySet.add(`${s.x},${s.y}`)
  for (const o of obstacles) bodySet.add(`${o.x},${o.y}`)
  const dirs = [{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}]
  let dm = 0
  for (let i = 0; i < 4; i++) {
    const nx = head.x + dirs[i].x, ny = head.y + dirs[i].y
    if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize || bodySet.has(`${nx},${ny}`)) dm |= (1 << i)
  }
  let foodDir = 0
  if (foods.length > 0) {
    let bx = foods[0].x, by = foods[0].y, bd = Infinity
    for (const f of foods) {
      const d = Math.abs(head.x + 0.5 - f.x) + Math.abs(head.y + 0.5 - f.y)
      if (d < bd) { bd = d; bx = f.x; by = f.y }
    }
    const dx = Math.round(bx - 0.5 - head.x), dy = Math.round(by - 0.5 - head.y)
    if (dx > 0) foodDir = 4; else if (dx < 0) foodDir = 3; else if (dy > 0) foodDir = 2; else if (dy < 0) foodDir = 1
  }
  const total = gridSize * gridSize
  const cat = snake.length < total * 0.33 ? 0 : snake.length < total * 0.66 ? 1 : 2
  return `${dm}|${foodDir}|${cat}`
}
function qGet(key) {
  if (!qTable[key]) qTable[key] = [0, 0, 0, 0]
  return qTable[key]
}
function qUpdate(reward, nextKey) {
  if (lastQState === null || lastQAction < 0) return
  const vals = qGet(lastQState)
  const maxNext = nextKey ? Math.max(...qGet(nextKey)) : 0
  vals[lastQAction] += Q_LR * (reward + Q_GAMMA * maxNext - vals[lastQAction])
  lastQState = null
  lastQAction = -1
}

function startFoodTravel() {
  travelingFood = { progress: 0 }
}

const leaderboard = ref([])
const activeModeTab = ref("Normal")

const leaderboardGrid = computed(() => {
  const result = {}
  for (const gm of gameModeOptions) {
    if (gm.value === "auto") continue
    const grid = {}
    for (const diff of difficultyOptions) {
      grid[diff.label] = {}
      for (const bs of boardSizeOptions) {
        grid[diff.label][bs.label] = []
      }
    }
    for (const entry of leaderboard.value) {
      if (entry.gameMode === "auto") continue
      const gmLabel = entry.gameMode === "greedy" ? "Greedy" : "Normal"
      if (gmLabel !== gm.label) continue
      const row = grid[entry.difficulty]
      if (row) {
        const cell = row[entry.boardSize || "Medium"]
        if (cell) cell.push(entry)
      }
    }
    for (const diff of difficultyOptions) {
      for (const bs of boardSizeOptions) {
        grid[diff.label][bs.label].sort((a, b) => b.score - a.score)
        grid[diff.label][bs.label] = grid[diff.label][bs.label].slice(0, 3)
      }
    }
    result[gm.label] = grid
  }
  return result
})

function isActiveCell(diffLabel, bsLabel) {
  if (gameMode.value === "auto") return false
  const modeMatch = (activeModeTab.value === "Normal" && gameMode.value === "normal") ||
                    (activeModeTab.value === "Greedy" && gameMode.value === "greedy")
  if (!modeMatch) return false
  const diffMatch = difficultyOptions.find(o => o.label === diffLabel)?.value === difficulty.value
  const bsMatch = boardSizeOptions.find(o => o.label === bsLabel)?.value === boardSize.value
  return diffMatch && bsMatch
}

const currentSpeedLabel = computed(() => {
  const opt = difficultyOptions.find(o => o.value === difficulty.value)
  return opt ? opt.label : "Custom"
})

const currentBoardSizeLabel = computed(() => {
  const opt = boardSizeOptions.find(o => o.value === boardSize.value)
  return opt ? opt.label : "Medium"
})

const leaderboardByMode = computed(() => {
  const groups = {}
  for (const gm of gameModeOptions) {
    if (gm.value === "auto") continue
    groups[gm.label] = {}
    for (const bs of boardSizeOptions) {
      groups[gm.label][bs.label] = { obs: [], noObs: [] }
    }
  }
  for (const entry of leaderboard.value) {
    if (entry.gameMode === "auto") continue
    const gmLabel = entry.gameMode === "greedy" ? "Greedy" : "Normal"
    const bsLabel = entry.boardSize || "Medium"
    const bucket = entry.obstacles ? "obs" : "noObs"
    const g = groups[gmLabel]?.[bsLabel]?.[bucket]
    if (g) g.push(entry)
  }
  for (const gmKey of Object.keys(groups)) {
    for (const bsKey of Object.keys(groups[gmKey])) {
      for (const bucket of ["obs", "noObs"]) {
        groups[gmKey][bsKey][bucket].sort((a, b) => b.score - a.score)
        groups[gmKey][bsKey][bucket] = groups[gmKey][bsKey][bucket].slice(0, 5)
      }
    }
  }
  return groups
})

function loadLeaderboard() {
  try {
    const data = localStorage.getItem("snakeLeaderboard")
    leaderboard.value = data ? JSON.parse(data) : []
  } catch {
    leaderboard.value = []
  }
}

function saveLeaderboard() {
  localStorage.setItem("snakeLeaderboard", JSON.stringify(leaderboard.value))
}

function addScoreToLeaderboard(newScore) {
  if (gameMode.value === "auto") return
  const entry = {
    score: newScore,
    difficulty: currentSpeedLabel.value,
    boardSize: currentBoardSizeLabel.value,
    gameMode: gameMode.value,
    obstacles: enableObstacles.value,
    date: new Date().toLocaleString()
  }
  leaderboard.value.push(entry)
  leaderboard.value.sort((a, b) => b.score - a.score)
  saveLeaderboard()
}

function syncSettingsToGuest() {
  if (props.mode === 'host' && gameStatus.value === 'ready') {
    multiplayer.send({
      type: 'obstacle_layout',
      obstacles: obstacles.map(o => ({...o})),
      boardSize: boardSize.value,
      difficulty: difficulty.value,
      enableObstacles: enableObstacles.value,
      gameMode: gameMode.value,
      gridSize: GRID_SIZE.value,
    })
  }
}

watch(difficulty, (newVal) => {
  const opt = difficultyOptions.find(o => o.value === newVal)
  if (opt) {
    moveSpeed.value = opt.speed
    enableObstacles.value = opt.obstacles
  }
  if (isMultiplayer.value && props.mode === 'host') {
    initGame()
    draw()
    syncSettingsToGuest()
  }
})

watch(gameMode, () => {
  if (gameStatus.value === "playing" || gameStatus.value === "gameover") {
    initGame()
    gameStatus.value = "idle"
    draw()
    if (gameMode.value === "auto") startGame()
  } else {
    initGame()
    draw()
    if (gameMode.value === "auto") startGame()
    syncSettingsToGuest()
  }
})

watch(boardSize, () => {
  if (gameStatus.value === "playing" || gameStatus.value === "gameover") {
    initGame()
    gameStatus.value = "idle"
    draw()
    if (gameMode.value === "auto") startGame()
  } else {
    initGame()
    draw()
    if (gameMode.value === "auto") startGame()
    syncSettingsToGuest()
  }
})

watch(enableObstacles, () => {
  if (isMultiplayer.value && props.mode === 'host') {
    initGame()
    draw()
    syncSettingsToGuest()
  }
})

function generateObstacles() {
  obstacles = []
  if (!enableObstacles.value || !obstaclesActive) return

  const sizeCounts = { small: 4, medium: 7, large: 10 }
  const count = sizeCounts[boardSize.value] || 5
  const startSafeX = Math.floor(GRID_SIZE.value / 4)
  const startSafeY = Math.floor(GRID_SIZE.value / 2)
  for (let i = 0; i < count; i++) {
    let pos
    let attempts = 0
    do {
      pos = {
        x: Math.floor(Math.random() * GRID_SIZE.value),
        y: Math.floor(Math.random() * GRID_SIZE.value)
      }
      attempts++
    } while (
      attempts < 100 &&
      (snake.some(seg => seg.x === pos.x && seg.y === pos.y) ||
        foods.some(f => Math.abs(f.x - pos.x - 0.5) < 1 && Math.abs(f.y - pos.y - 0.5) < 1) ||
        (Math.abs(pos.x - startSafeX) < 3 && Math.abs(pos.y - startSafeY) < 3))
    )
    if (attempts < 100) {
      obstacles.push(pos)
    }
  }
}

function placeFood(count) {
  for (let i = 0; i < (count || 1); i++) {
    if (foods.length >= MAX_FOODS) break
    let newFood
    let attempts = 0
    do {
      newFood = {
        x: Math.floor(Math.random() * GRID_SIZE.value) + 0.5,
        y: Math.floor(Math.random() * GRID_SIZE.value) + 0.5
      }
      attempts++
    } while (attempts < 100 && (
      snake.some(seg => Math.abs(seg.x + 0.5 - newFood.x) < 0.8 && Math.abs(seg.y + 0.5 - newFood.y) < 0.8) ||
      obstacles.some(obs => Math.abs(obs.x + 0.5 - newFood.x) < 0.8 && Math.abs(obs.y + 0.5 - newFood.y) < 0.8) ||
      foods.some(f => Math.abs(f.x - newFood.x) < 0.8 && Math.abs(f.y - newFood.y) < 0.8)
    ))
    if (attempts < 100) foods.push(newFood)
  }
}

function initGame() {
  travelingFood = null
  foods = []
  obstaclesActive = false
  prevFoodDist = Infinity
  lastQState = null
  lastQAction = -1
  const startX = Math.floor(GRID_SIZE.value / 4)
  const startY = Math.floor(GRID_SIZE.value / 2)

  if (isMultiplayer.value) {
    const gs = GRID_SIZE.value
    snake = [
      { x: Math.floor(gs / 4), y: Math.floor(gs / 2) },
      { x: Math.floor(gs / 4) - 1, y: Math.floor(gs / 2) },
      { x: Math.floor(gs / 4) - 2, y: Math.floor(gs / 2) },
    ]
    direction = { x: 1, y: 0 }
    nextDirection = { x: 1, y: 0 }
    inputQueue = []
    guestInputQueue = []
    score.value = 0

    opponentSnake = [
      { x: Math.floor(3 * gs / 4), y: Math.floor(gs / 2) },
      { x: Math.floor(3 * gs / 4) + 1, y: Math.floor(gs / 2) },
      { x: Math.floor(3 * gs / 4) + 2, y: Math.floor(gs / 2) },
    ]
    opponentDirection = { x: -1, y: 0 }
    opponentFoods = []
    opponentScore = 0
    opponentAlive = true
    opponentPrevSnake = []
    gameWinner = null

    obstacles = []
    if (props.mode === 'host') {
      generateObstacles()
    }
    placeFood()
    return
  }

  snake = [
    { x: startX, y: startY },
    { x: startX - 1, y: startY },
    { x: startX - 2, y: startY }
  ]
  direction = { x: 1, y: 0 }
  nextDirection = { x: 1, y: 0 }
  inputQueue = []
  score.value = 0
  generateObstacles()
  placeFood()
}

function drawBoard(ctx, boardX, snakeArr, dirObj, foodArr, obsArr, lbl, colorScheme, offsetSnake) {
  const gs = GRID_SIZE.value
  const cs = CELL_SIZE.value

  ctx.fillStyle = "#1a1a2e"
  ctx.fillRect(boardX, 0, CANVAS_SIZE, CANVAS_SIZE)

  ctx.strokeStyle = "#3a3a5e"
  ctx.lineWidth = 1
  for (let i = 0; i <= gs; i++) {
    ctx.beginPath()
    ctx.moveTo(boardX + i * cs, 0)
    ctx.lineTo(boardX + i * cs, CANVAS_SIZE)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(boardX, i * cs)
    ctx.lineTo(boardX + CANVAS_SIZE, i * cs)
    ctx.stroke()
  }

  obsArr.forEach(obs => {
    ctx.fillStyle = "#8b4513"
    ctx.shadowColor = "#8b4513"
    ctx.shadowBlur = 5
    ctx.fillRect(boardX + obs.x * cs + 1, obs.y * cs + 1, cs - 2, cs - 2)
  })
  ctx.shadowBlur = 0

  for (const f of foodArr) {
    ctx.shadowColor = "#ff6b6b"
    ctx.shadowBlur = 10
    ctx.fillStyle = "#ff6b6b"
    ctx.beginPath()
    ctx.arc(boardX + f.x * cs, f.y * cs, cs / 2 - 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  const cStart = colorScheme.start
  const cEnd = colorScheme.end
  if (snakeArr.length > 1) {
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = cs - 4
    for (let i = 0; i < snakeArr.length - 1; i++) {
      const t = i / (snakeArr.length - 1)
      const r = Math.round(cStart.r + (cEnd.r - cStart.r) * t)
      const g = Math.round(cStart.g + (cEnd.g - cStart.g) * t)
      const b = Math.round(cStart.b + (cEnd.b - cStart.b) * t)
      ctx.strokeStyle = `rgb(${r},${g},${b})`
      ctx.shadowColor = `rgb(${r},${g},${b})`
      ctx.shadowBlur = 6
      const p0 = offsetSnake ? { x: snakeArr[i].x + offsetSnake, y: snakeArr[i].y } : snakeArr[i]
      const p1 = offsetSnake ? { x: snakeArr[i + 1].x + offsetSnake, y: snakeArr[i + 1].y } : snakeArr[i + 1]
      ctx.beginPath()
      ctx.moveTo(boardX + p0.x * cs + cs / 2, p0.y * cs + cs / 2)
      ctx.lineTo(boardX + p1.x * cs + cs / 2, p1.y * cs + cs / 2)
      ctx.stroke()
    }
    ctx.shadowBlur = 0
  }

  if (snakeArr.length > 0) {
    const head = snakeArr[0]
    const cx = boardX + head.x * cs + cs / 2
    const cy = head.y * cs + cs / 2
    const radius = cs / 2 - 2
    ctx.fillStyle = `rgb(${cStart.r},${cStart.g},${cStart.b})`
    ctx.shadowColor = `rgb(${cStart.r},${cStart.g},${cStart.b})`
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.fillStyle = "#ffffff"
    const eox = dirObj.x * radius * 0.3
    const eoy = dirObj.y * radius * 0.3
    const esp = radius * 0.45
    let ex1, ey1, ex2, ey2
    if (dirObj.x !== 0) {
      ex1 = cx + eox; ey1 = cy - esp
      ex2 = cx + eox; ey2 = cy + esp
    } else {
      ex1 = cx - esp; ey1 = cy + eoy
      ex2 = cx + esp; ey2 = cy + eoy
    }
    ctx.beginPath()
    ctx.arc(ex1, ey1, radius * 0.25, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(ex2, ey2, radius * 0.25, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#1a1a2e"
    ctx.beginPath()
    ctx.arc(ex1 + dirObj.x * 1, ey1 + dirObj.y * 1, radius * 0.12, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(ex2 + dirObj.x * 1, ey2 + dirObj.y * 1, radius * 0.12, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = "#ffffff"
  ctx.font = "bold 11px system-ui"
  ctx.textAlign = "center"
  ctx.fillText(lbl, boardX + CANVAS_SIZE / 2, 14)
}

function draw(alpha) {
  const ctx = canvas.value.getContext("2d")
  const gridSize = GRID_SIZE.value
  const canvasSize = CANVAS_SIZE
  const cellSize = CELL_SIZE.value

  if (isMultiplayer.value) {
    drawBoard(ctx, 0, snake, direction, foods, obstacles, `You (P${playerIndex.value + 1})`,
      { start: { r: 78, g: 205, b: 196 }, end: { r: 26, g: 107, b: 101 } })
    drawBoard(ctx, CANVAS_SIZE + 10, opponentSnake, opponentDirection, opponentFoods, obstacles, 'Opponent',
      { start: { r: 255, g: 107, b: 179 }, end: { r: 180, g: 40, b: 110 } })

    const mw = CANVAS_SIZE * 2 + 10
    const w = gameWinner
    if (gameStatus.value === 'gameover' && w !== null) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)"
      ctx.fillRect(0, 0, mw, CANVAS_SIZE)
      let msg, color
      if (w === playerIndex.value) { msg = "YOU WIN!"; color = "#4ecdc4" }
      else if (w === 1 - playerIndex.value) { msg = "YOU LOSE"; color = "#ff6b6b" }
      else { msg = "DRAW"; color = "#ffd700" }
      ctx.fillStyle = color
      ctx.font = "bold 36px system-ui"
      ctx.textAlign = "center"
      ctx.fillText(msg, mw / 2, CANVAS_SIZE / 2 - 20)
      ctx.fillStyle = "#ffffff"
      ctx.font = "20px system-ui"
      ctx.fillText(`You: ${score.value}  Opponent: ${opponentScore}`, mw / 2, CANVAS_SIZE / 2 + 20)
    }
    return
  }

  ctx.fillStyle = "#1a1a2e"
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  ctx.strokeStyle = "#3a3a5e"
  ctx.lineWidth = 1
  for (let i = 0; i <= gridSize; i++) {
    ctx.beginPath()
    ctx.moveTo(i * cellSize, 0)
    ctx.lineTo(i * cellSize, canvasSize)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i * cellSize)
    ctx.lineTo(canvasSize, i * cellSize)
    ctx.stroke()
  }

  obstacles.forEach(obs => {
    ctx.fillStyle = "#8b4513"
    ctx.shadowColor = "#8b4513"
    ctx.shadowBlur = 5
    ctx.fillRect(obs.x * cellSize + 1, obs.y * cellSize + 1, cellSize - 2, cellSize - 2)
  })
  ctx.shadowBlur = 0

  for (const f of foods) {
    ctx.shadowColor = "#ff6b6b"
    ctx.shadowBlur = 10
    ctx.fillStyle = "#ff6b6b"
    ctx.beginPath()
    ctx.arc(f.x * cellSize, f.y * cellSize, cellSize / 2 - 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  if (snake.length > 1) {
    const bodyLen = snake.length
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = cellSize - 4
    for (let i = 0; i < bodyLen - 1; i++) {
      const t = i / (bodyLen - 1)
      const r = Math.round(78 + (26 - 78) * t)
      const g = Math.round(205 + (107 - 205) * t)
      const b = Math.round(196 + (101 - 196) * t)
      ctx.strokeStyle = `rgb(${r},${g},${b})`
      ctx.shadowColor = `rgb(${r},${g},${b})`
      ctx.shadowBlur = 6
      const p0 = sp(i)
      const p1 = sp(i + 1)
      ctx.beginPath()
      ctx.moveTo(p0.x * cellSize + cellSize / 2, p0.y * cellSize + cellSize / 2)
      ctx.lineTo(p1.x * cellSize + cellSize / 2, p1.y * cellSize + cellSize / 2)
      ctx.stroke()
    }
    ctx.shadowBlur = 0
  }

  const headPos = sp(0)
  const cx = headPos.x * cellSize + cellSize / 2
  const cy = headPos.y * cellSize + cellSize / 2
  const radius = cellSize / 2 - 2

  ctx.fillStyle = "#4ecdc4"
  ctx.shadowColor = "#4ecdc4"
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0

  ctx.fillStyle = "#ffffff"
  const eyeOffsetX = direction.x * radius * 0.3
  const eyeOffsetY = direction.y * radius * 0.3
  const eyeSpacing = radius * 0.45
  let eye1X, eye1Y, eye2X, eye2Y
  if (direction.x !== 0) {
    eye1X = cx + eyeOffsetX; eye1Y = cy - eyeSpacing
    eye2X = cx + eyeOffsetX; eye2Y = cy + eyeSpacing
  } else {
    eye1X = cx - eyeSpacing; eye1Y = cy + eyeOffsetY
    eye2X = cx + eyeSpacing; eye2Y = cy + eyeOffsetY
  }
  ctx.beginPath()
  ctx.arc(eye1X, eye1Y, radius * 0.25, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(eye2X, eye2Y, radius * 0.25, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#1a1a2e"
  ctx.beginPath()
  ctx.arc(eye1X + direction.x * 1, eye1Y + direction.y * 1, radius * 0.12, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(eye2X + direction.x * 1, eye2Y + direction.y * 1, radius * 0.12, 0, Math.PI * 2)
  ctx.fill()

  if (travelingFood) {
    travelingFood.progress += 0.018
    if (travelingFood.progress >= 1 || snake.length < 2) {
      travelingFood = null
    } else {
      const totalDist = snake.length - 1
      const rawIdx = travelingFood.progress * totalDist
      const idx = Math.floor(rawIdx)
      const frac = rawIdx - idx
      const i0 = Math.min(idx, totalDist)
      const i1 = Math.min(idx + 1, totalDist)
      const p0 = sp(i0)
      const p1 = sp(i1)
      const fx = (p0.x + (p1.x - p0.x) * frac) * cellSize + cellSize / 2
      const fy = (p0.y + (p1.y - p0.y) * frac) * cellSize + cellSize / 2
      ctx.beginPath()
      ctx.arc(fx, fy, cellSize / 2, 0, Math.PI * 2)
      ctx.fillStyle = "rgba(26, 107, 101, 0.3)"
      ctx.fill()
      ctx.beginPath()
      ctx.arc(fx, fy, cellSize / 2 - 2, 0, Math.PI * 2)
      ctx.fillStyle = "#1a6b65"
      ctx.shadowColor = "#1a6b65"
      ctx.shadowBlur = 20
      ctx.fill()
      ctx.shadowBlur = 0
    }
  }

  if (gameStatus.value === "win") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)"
    ctx.fillRect(0, 0, canvasSize, canvasSize)
    ctx.fillStyle = "#ffd700"
    ctx.font = "bold 36px system-ui"
    ctx.textAlign = "center"
    ctx.fillText("YOU WIN!", canvasSize / 2, canvasSize / 2 - 30)
    ctx.fillStyle = "#4ecdc4"
    ctx.font = "22px system-ui"
    ctx.fillText(`Score: ${score.value}`, canvasSize / 2, canvasSize / 2 + 10)
    ctx.fillStyle = "#ffffff"
    ctx.font = "16px system-ui"
    ctx.fillText(`Mode: ${currentSpeedLabel.value}${enableObstacles.value ? " + Obstacles" : ""}`, canvasSize / 2, canvasSize / 2 + 40)
  } else if (gameStatus.value === "gameover") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)"
    ctx.fillRect(0, 0, canvasSize, canvasSize)
    ctx.fillStyle = "#ff6b6b"
    ctx.font = "bold 36px system-ui"
    ctx.textAlign = "center"
    ctx.fillText("GAME OVER", canvasSize / 2, canvasSize / 2 - 30)
    ctx.fillStyle = "#ffffff"
    ctx.font = "22px system-ui"
    ctx.fillText(`Score: ${score.value}`, canvasSize / 2, canvasSize / 2 + 10)
    ctx.fillStyle = "#ffd700"
    ctx.font = "16px system-ui"
    ctx.fillText(`Mode: ${currentSpeedLabel.value}${enableObstacles.value ? " + Obstacles" : ""}`, canvasSize / 2, canvasSize / 2 + 40)
  }
}

function countReachable(fromX, fromY, blocked) {
  const n = GRID_SIZE.value
  const key = `${fromX},${fromY}`
  if (fromX < 0 || fromX >= n || fromY < 0 || fromY >= n || blocked.has(key)) return 0
  const visited = new Set([key])
  const q = [{ x: fromX, y: fromY }]
  let count = 0
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }]
  while (q.length > 0) {
    const { x, y } = q.shift()
    count++
    for (const d of dirs) {
      const nx = x + d.x, ny = y + d.y, k = `${nx},${ny}`
      if (nx >= 0 && nx < n && ny >= 0 && ny < n && !blocked.has(k) && !visited.has(k)) {
        visited.add(k)
        q.push({ x: nx, y: ny })
      }
    }
  }
  return count
}

function findNextDirection() {
  const head = snake[0]
  const gridSize = GRID_SIZE.value
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }]

  const sk = qStateKey(head, foods, gridSize)
  const qVals = qGet(sk)

  let bestDir = null, bestScore = -Infinity, bestIdx = -1

  for (let i = 0; i < 4; i++) {
    const d = dirs[i]
    const nx = head.x + d.x, ny = head.y + d.y
    if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue

    let willEat = false
    for (const f of foods) {
      if (Math.abs(nx + 0.5 - f.x) < 0.6 && Math.abs(ny + 0.5 - f.y) < 0.6) { willEat = true; break }
    }

    const blocked = new Set()
    for (const o of obstacles) blocked.add(`${o.x},${o.y}`)
    if (willEat) {
      for (const s of snake) blocked.add(`${s.x},${s.y}`)
    } else {
      for (let j = 0; j < snake.length - 1; j++) blocked.add(`${snake[j].x},${snake[j].y}`)
    }

    const headKey = `${nx},${ny}`
    const tail = snake[snake.length - 1]
    if (blocked.has(headKey)) {
      if (!willEat && headKey === `${tail.x},${tail.y}`) {
      } else { continue }
    }

    const simBlocked = new Set(blocked)
    simBlocked.add(headKey)
    const reachable = countReachable(nx, ny, simBlocked)

    let minFoodDist = Infinity
    for (const f of foods) {
      const dist = Math.abs(nx + 0.5 - f.x) + Math.abs(ny + 0.5 - f.y)
      if (dist < minFoodDist) minFoodDist = dist
    }
    if (foods.length === 0) minFoodDist = 0

    const score = reachable * 1000 - minFoodDist + qVals[i] * Q_WEIGHT
    if (score > bestScore) { bestScore = score; bestDir = d; bestIdx = i }
  }

  lastQState = sk
  lastQAction = bestIdx
  if (bestDir) return bestDir
  return direction
}

function update() {
  prevSnake = snake.map(s => ({ x: s.x, y: s.y }))

  if (gameMode.value === "auto") {
    inputQueue = []
    const nextDir = findNextDirection()
    direction = { ...nextDir }
  } else {
    if (inputQueue.length > 0) {
      const next = inputQueue.shift()
      if (next.x !== -direction.x || next.y !== -direction.y) {
        nextDirection = next
      }
    }
    direction = { ...nextDirection }
  }

  const head = {
    x: snake[0].x + direction.x,
    y: snake[0].y + direction.y
  }

  if (head.x < 0 || head.x >= GRID_SIZE.value || head.y < 0 || head.y >= GRID_SIZE.value) {
    endGame()
    return
  }

  if (snake.some(seg => seg.x === head.x && seg.y === head.y)) {
    endGame()
    return
  }

  if (obstacles.some(obs => obs.x === head.x && obs.y === head.y)) {
    endGame()
    return
  }

  snake.unshift(head)

  if (gameMode.value === "greedy") {
    const hx = head.x + 0.5
    const hy = head.y + 0.5
    for (const f of foods) {
      const dx = hx - f.x
      const dy = hy - f.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > 0.01) {
        let blocked = false
        for (let i = 0; i < snake.length - 1; i++) {
          const s1 = snake[i]
          const s2 = snake[i + 1]
          const ax = s1.x + 0.5, ay = s1.y + 0.5
          const bx = s2.x + 0.5, by = s2.y + 0.5
          const segDx = bx - ax, segDy = by - ay
          const lenSq = segDx * segDx + segDy * segDy
          if (lenSq > 0) {
            let t = ((f.x - ax) * segDx + (f.y - ay) * segDy) / lenSq
            t = Math.max(0, Math.min(1, t))
            const cx = ax + t * segDx
            const cy = ay + t * segDy
            const d = Math.sqrt((f.x - cx) ** 2 + (f.y - cy) ** 2)
            if (d < 1) { blocked = true; break }
          }
        }
        if (!blocked) {
          f.x += (dx / dist) * ATTRACTION_SPEED
          f.y += (dy / dist) * ATTRACTION_SPEED
        }
      }
    }
  }

  let ate = 0
  for (let i = foods.length - 1; i >= 0; i--) {
    const f = foods[i]
    if (Math.abs(head.x + 0.5 - f.x) < 0.6 && Math.abs(head.y + 0.5 - f.y) < 0.6) {
      foods.splice(i, 1)
      ate++
    }
  }

  if (ate) {
    if (!obstaclesActive) {
      obstaclesActive = true
    }
    generateObstacles()
    score.value += (enableObstacles.value ? 15 : 10) * ate
    startFoodTravel()
    if (snake.length >= GRID_SIZE.value * GRID_SIZE.value) {
      winGame()
      return
    }
    if (gameMode.value === "greedy") {
      placeFood(4 * ate)
    } else {
      placeFood()
    }
  } else {
    snake.pop()
  }

  if (gameMode.value === "auto") {
    let reward = -0.01
    if (ate) reward += 10
    let newDist = Infinity
    for (const f of foods) {
      const dist = Math.abs(snake[0].x + 0.5 - f.x) + Math.abs(snake[0].y + 0.5 - f.y)
      if (dist < newDist) newDist = dist
    }
    if (foods.length > 0) {
      if (newDist < prevFoodDist) reward += 0.2
      else if (newDist > prevFoodDist) reward -= 0.2
    }
    prevFoodDist = foods.length > 0 ? newDist : Infinity
    if (ate) saveQTable()
    const nextState = qStateKey(snake[0], foods, GRID_SIZE.value)
    qUpdate(reward, nextState)
  }
}

function mpUpdate() {
  prevSnake = snake.map(s => ({...s}))
  opponentPrevSnake = opponentSnake.map(s => ({...s}))

  const gs = GRID_SIZE.value

  if (inputQueue.length > 0) {
    const next = inputQueue.shift()
    if (next.x !== -direction.x || next.y !== -direction.y) {
      direction = { ...next }
    }
  }
  if (guestInputQueue.length > 0) {
    const next = guestInputQueue.shift()
    if (next.x !== -opponentDirection.x || next.y !== -opponentDirection.y) {
      opponentDirection = { ...next }
    }
  }

  const hostHead = { x: snake[0].x + direction.x, y: snake[0].y + direction.y }
  const guestHead = { x: opponentSnake[0].x + opponentDirection.x, y: opponentSnake[0].y + opponentDirection.y }

  let hostAlive = true
  let guestAlive = true

  if (hostHead.x < 0 || hostHead.x >= gs || hostHead.y < 0 || hostHead.y >= gs) hostAlive = false
  else if (snake.some(seg => seg.x === hostHead.x && seg.y === hostHead.y)) hostAlive = false
  else if (obstacles.some(o => o.x === hostHead.x && o.y === hostHead.y)) hostAlive = false
  else if (opponentSnake.some(seg => seg.x === hostHead.x && seg.y === hostHead.y)) hostAlive = false

  if (guestHead.x < 0 || guestHead.x >= gs || guestHead.y < 0 || guestHead.y >= gs) guestAlive = false
  else if (opponentSnake.some(seg => seg.x === guestHead.x && seg.y === guestHead.y)) guestAlive = false
  else if (obstacles.some(o => o.x === guestHead.x && o.y === guestHead.y)) guestAlive = false
  else if (snake.some(seg => seg.x === guestHead.x && seg.y === guestHead.y)) guestAlive = false

  if (hostHead.x === guestHead.x && hostHead.y === guestHead.y) {
    hostAlive = false
    guestAlive = false
  }

  if (!hostAlive && !guestAlive) { endMpRound(-1); return }
  if (!hostAlive) { endMpRound(1 - playerIndex.value); return }
  if (!guestAlive) { endMpRound(playerIndex.value); return }

  snake.unshift(hostHead)
  opponentSnake.unshift(guestHead)

  if (gameMode.value === "greedy") {
    for (const f of foods) {
      const hx = snake[0].x + 0.5, hy = snake[0].y + 0.5
      const ox = opponentSnake[0].x + 0.5, oy = opponentSnake[0].y + 0.5
      const dh2 = (hx - f.x) ** 2 + (hy - f.y) ** 2
      const dg2 = (ox - f.x) ** 2 + (oy - f.y) ** 2
      const nearX = dh2 < dg2 ? hx : ox
      const nearY = dh2 < dg2 ? hy : oy
      const dx = nearX - f.x, dy = nearY - f.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > 0.01) {
        f.x += (dx / dist) * ATTRACTION_SPEED
        f.y += (dy / dist) * ATTRACTION_SPEED
      }
    }
  }

  let hostAte = false
  for (let i = foods.length - 1; i >= 0; i--) {
    if (Math.abs(hostHead.x + 0.5 - foods[i].x) < 0.6 && Math.abs(hostHead.y + 0.5 - foods[i].y) < 0.6) {
      foods.splice(i, 1)
      hostAte = true
      score.value++
    }
  }

  let guestAte = false
  for (let i = foods.length - 1; i >= 0; i--) {
    if (Math.abs(guestHead.x + 0.5 - foods[i].x) < 0.6 && Math.abs(guestHead.y + 0.5 - foods[i].y) < 0.6) {
      foods.splice(i, 1)
      guestAte = true
      opponentScore++
    }
  }

  if (!hostAte) snake.pop()
  else if (gameMode.value === "greedy") placeFood(4)
  else placeFood()

  if (!guestAte) opponentSnake.pop()
  else if (gameMode.value === "greedy") placeFood(4)
  else placeFood()

  multiplayer.send({
    type: 'game_state',
    snake: snake.map(s => ({...s})),
    direction: { ...direction },
    opponentSnake: opponentSnake.map(s => ({...s})),
    opponentDirection: { ...opponentDirection },
    foods: foods.map(f => ({...f})),
    hostScore: score.value,
    guestScore: opponentScore,
    obstacles: obstacles.map(o => ({...o})),
  })
}

function endMpRound(winner) {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  animFrameId = null
  accumulator = 0
  lastTime = 0

  if (winner === playerIndex.value) matchScore.value++
  else if (winner === 1 - playerIndex.value) opponentMatchScore.value++

  multiplayer.send({
    type: 'round_result',
    winner,
    matchScore: matchScore.value,
    opponentMatchScore: opponentMatchScore.value,
    round: currentRound.value,
  })

  if (matchScore.value >= WIN_SCORE || opponentMatchScore.value >= WIN_SCORE) {
    endMpMatch(winner)
  } else {
    currentRound.value++
    gameStatus.value = 'ready'
    myReady.value = false
    opponentReady.value = false
    resetMpRound()
    draw()
  }
}

function endMpMatch(winner) {
  gameWinner = winner
  myReady.value = false
  opponentReady.value = false
  gameStatus.value = 'match_over'
  draw()
}

function resetMpRound() {
  const gs = GRID_SIZE.value
  snake = [
    { x: Math.floor(gs / 4), y: Math.floor(gs / 2) },
    { x: Math.floor(gs / 4) - 1, y: Math.floor(gs / 2) },
    { x: Math.floor(gs / 4) - 2, y: Math.floor(gs / 2) },
  ]
  direction = { x: 1, y: 0 }
  nextDirection = { x: 1, y: 0 }
  inputQueue = []
  guestInputQueue = []
  foods = []
  obstaclesActive = false
  score.value = 0
  opponentScore = 0
  opponentSnake = [
    { x: Math.floor(3 * gs / 4), y: Math.floor(gs / 2) },
    { x: Math.floor(3 * gs / 4) + 1, y: Math.floor(gs / 2) },
    { x: Math.floor(3 * gs / 4) + 2, y: Math.floor(gs / 2) },
  ]
  opponentDirection = { x: -1, y: 0 }
  opponentFoods = []
  opponentAlive = true
  opponentPrevSnake = []
  gameWinner = null
  if (props.mode === 'host') { generateObstacles() }
  placeFood()
  draw()
}

function requestRematch() {
  rematchRequested.value = true
  multiplayer.send({ type: 'rematch' })
}

function acceptRematch() {
  multiplayer.send({ type: 'rematch_accept' })
  startNewMatch()
}

function startNewMatch() {
  matchScore.value = 0
  opponentMatchScore.value = 0
  currentRound.value = 1
  rematchRequested.value = false
  opponentRematch.value = false
  myReady.value = false
  opponentReady.value = false
  resetMpRound()
  gameStatus.value = 'ready'
  draw()
}

function gameLoop(timestamp) {
  if (gameStatus.value !== "playing") return
  if (!lastTime) lastTime = timestamp
  const delta = timestamp - lastTime
  lastTime = timestamp
  accumulator += delta
  while (accumulator >= gameInterval.value) {
    if (isMultiplayer.value) {
      if (props.mode === 'host') mpUpdate()
    } else {
      update()
    }
    if (gameStatus.value !== "playing") return
    accumulator -= gameInterval.value
  }
  const alpha = accumulator / gameInterval.value
  draw(alpha)
  animFrameId = requestAnimationFrame(gameLoop)
}

function winGame() {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  animFrameId = null
  accumulator = 0
  lastTime = 0
  gameStatus.value = "win"
  if (gameMode.value === "auto") { qUpdate(20, null); saveQTable() }
  addScoreToLeaderboard(score.value)
  draw()
  if (gameMode.value === "auto") setTimeout(startGame, 500)
}

function endGame() {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  animFrameId = null
  accumulator = 0
  lastTime = 0
  gameStatus.value = "gameover"
  if (gameMode.value === "auto") { qUpdate(-10, null); saveQTable() }
  addScoreToLeaderboard(score.value)
  draw()
  if (gameMode.value === "auto") setTimeout(startGame, 500)
}

function startGame() {
  if (isMultiplayer.value) {
    if (props.mode === 'host') {
      gameStatus.value = "playing"
      accumulator = 0
      lastTime = 0
      gameWinner = null
      draw()
      animFrameId = requestAnimationFrame(gameLoop)
    } else {
      gameStatus.value = "playing"
      gameWinner = null
      draw()
    }
    return
  }
  initGame()
  gameStatus.value = "playing"
  accumulator = 0
  lastTime = 0
  draw()
  animFrameId = requestAnimationFrame(gameLoop)
}

function handleKeydown(e) {
  if (gameStatus.value !== "playing") {
    if ((e.key === " " || e.key === "Enter") && gameStatus.value === "idle") {
      e.preventDefault()
      startGame()
    }
    return
  }

  e.preventDefault()

  let newDir = null
  switch (e.key) {
    case "ArrowUp":
    case "w":
    case "W":
      newDir = { x: 0, y: -1 }
      break
    case "ArrowDown":
    case "s":
    case "S":
      newDir = { x: 0, y: 1 }
      break
    case "ArrowLeft":
    case "a":
    case "A":
      newDir = { x: -1, y: 0 }
      break
    case "ArrowRight":
    case "d":
    case "D":
      newDir = { x: 1, y: 0 }
      break
  }

  if (!newDir) return

  if (isMultiplayer.value) {
    if (props.mode === 'guest') {
      multiplayer.send({ type: 'input', direction: newDir })
    } else {
      const lastDir = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : direction
      if (newDir.x !== -lastDir.x || newDir.y !== -lastDir.y) {
        if (inputQueue.length < 2) {
          inputQueue.push(newDir)
        }
      }
    }
    return
  }

  if (newDir) {
    const lastDir = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : direction
    if (newDir.x !== -lastDir.x || newDir.y !== -lastDir.y) {
      if (inputQueue.length < 2) {
        inputQueue.push(newDir)
      }
    }
  }
}

function pressReady() {
  myReady.value = true
  multiplayer.send({ type: 'ready' })
  checkBothReady()
}

function startCountdown(count) {
  gameStatus.value = 'countdown'
  countdownValue.value = count
  draw()
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    countdownValue.value--
    if (countdownValue.value <= 0) {
      clearInterval(countdownTimer)
      countdownTimer = null
      myReady.value = false
      opponentReady.value = false
      startGame()
    }
    draw()
  }, 1000)
}

function checkBothReady() {
  if (props.mode === 'host' && myReady.value && opponentReady.value) {
    multiplayer.send({ type: 'countdown_start', count: 5 })
    startCountdown(5)
  }
}

function setupMultiplayer() {
  initGame()
  draw()

  multiplayer.onData((data) => {
    if (data.type === 'obstacle_layout') {
      obstacles = data.obstacles.map(o => ({...o}))
      if (props.mode === 'guest') {
        if (data.boardSize) boardSize.value = data.boardSize
        if (data.difficulty) difficulty.value = data.difficulty
        if (data.enableObstacles !== undefined) enableObstacles.value = data.enableObstacles
        if (data.gameMode) gameMode.value = data.gameMode
        if (gameStatus.value !== 'ready') {
          gameStatus.value = 'ready'
        }
      }
      draw()
    } else if (data.type === 'request_state') {
      multiplayer.send({
        type: 'obstacle_layout',
        obstacles: obstacles.map(o => ({...o})),
        boardSize: boardSize.value,
        difficulty: difficulty.value,
        enableObstacles: enableObstacles.value,
        gameMode: gameMode.value,
        gridSize: GRID_SIZE.value,
      })
    } else if (data.type === 'game_state') {
      if (props.mode === 'guest') {
        snake = data.opponentSnake.map(s => ({...s}))
        direction = { ...data.opponentDirection }
        opponentSnake = data.snake.map(s => ({...s}))
        opponentDirection = { ...data.direction }
        foods = data.foods.map(f => ({...f}))
        obstacles = data.obstacles.map(o => ({...o}))
        score.value = data.guestScore
        opponentScore = data.hostScore
        draw()
      }
    } else if (data.type === 'input') {
      if (props.mode === 'host') {
        const lastDir = guestInputQueue.length > 0 ? guestInputQueue[guestInputQueue.length - 1] : opponentDirection
        if (data.direction.x !== -lastDir.x || data.direction.y !== -lastDir.y) {
          if (guestInputQueue.length < 2) {
            guestInputQueue.push(data.direction)
          }
        }
      }
    } else if (data.type === 'round_result') {
      matchScore.value = data.opponentMatchScore
      opponentMatchScore.value = data.matchScore
      currentRound.value = (data.round || 0) + 1
      if (matchScore.value >= WIN_SCORE || opponentMatchScore.value >= WIN_SCORE) {
        gameWinner = data.winner
        gameStatus.value = 'match_over'
        draw()
      } else {
        gameStatus.value = 'ready'
        myReady.value = false
        opponentReady.value = false
        resetMpRound()
      }
    } else if (data.type === 'ready') {
      opponentReady.value = true
      checkBothReady()
      draw()
    } else if (data.type === 'countdown_start') {
      startCountdown(data.count)
    } else if (data.type === 'rematch') {
      opponentRematch.value = true
      if (rematchRequested.value) {
        multiplayer.send({ type: 'rematch_accept' })
        startNewMatch()
      } else {
        draw()
      }
    } else if (data.type === 'rematch_accept') {
      startNewMatch()
    }
  })

  multiplayer.onDisconnect(() => {
    if (gameStatus.value === 'playing' || gameStatus.value === 'ready' || gameStatus.value === 'countdown' || gameStatus.value === 'match_over') {
      gameWinner = 1 - playerIndex.value
      gameStatus.value = 'gameover'
      if (countdownTimer) clearInterval(countdownTimer)
      if (animFrameId) cancelAnimationFrame(animFrameId)
      animFrameId = null
      accumulator = 0
      lastTime = 0
      draw()
    }
  })

  if (props.mode === 'host') {
    gameStatus.value = 'waiting'
    draw()
    multiplayer.onConnection(() => {
      multiplayer.send({
        type: 'obstacle_layout',
        obstacles: obstacles.map(o => ({...o})),
        boardSize: boardSize.value,
        difficulty: difficulty.value,
        enableObstacles: enableObstacles.value,
        gameMode: gameMode.value,
        gridSize: GRID_SIZE.value,
      })
      gameStatus.value = 'ready'
      draw()
    })
  } else {
    gameStatus.value = 'ready'
    draw()
    multiplayer.send({ type: 'request_state' })
  }
}

onMounted(() => {
  if (isMultiplayer.value) {
    loadQTable()
    loadLeaderboard()
    window.addEventListener("keydown", handleKeydown)
    window.addEventListener("beforeunload", multiplayer.disconnect)
    if (props.mode === 'host') {
      peerId.value = multiplayer.myPeerId()
    }
    setupMultiplayer()
    return
  }
  loadQTable()
  loadLeaderboard()
  initGame()
  draw()
  window.addEventListener("keydown", handleKeydown)
  if (gameMode.value === "auto") startGame()
})

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown)
  window.removeEventListener("beforeunload", multiplayer.disconnect)
  if (animFrameId) cancelAnimationFrame(animFrameId)
  if (countdownTimer) clearInterval(countdownTimer)
  if (isMultiplayer.value) {
    multiplayer.disconnect()
  }
})
</script>

<template>
  <div class="snake-game">
    <button @click="$emit('back')" class="btn btn-back">← Back</button>
    <h1 class="title">{{ isMultiplayer ? 'Snake Battle' : 'Snake Game' }}</h1>

    <div class="top-bar">
      <div v-if="isMultiplayer" class="multiplayer-info">
        <div class="mp-player-badge p1-badge">P{{ playerIndex + 1 }} (You)</div>
        <div class="score-board mp-score">
          <div class="score-item">
            <span class="label">You</span>
            <span class="value p1-color">{{ score }}</span>
          </div>
          <div class="score-item">
            <span class="label">Opponent</span>
            <span class="value p2-color">{{ opponentScore }}</span>
          </div>
        </div>
        <div class="mp-player-badge p2-badge">Opponent</div>
      </div>
      <div v-else class="score-board">
        <div class="score-item">
          <span class="label">Score</span>
          <span class="value">{{ score }}</span>
        </div>
      </div>
    </div>

    <div class="game-layout">
      <div v-if="!isMultiplayer" class="leaderboard-panel">
        <h3>Leaderboard</h3>
        <div class="lb-tabs">
          <button
            v-for="gm in gameModeOptions"
            v-show="gm.value !== 'auto'"
            :key="gm.value"
            :class="['btn', 'btn-tiny', { active: activeModeTab === gm.label }]"
            @click="activeModeTab = gm.label"
          >{{ gm.label }}</button>
        </div>
        <div v-if="leaderboard.length === 0" class="empty-leaderboard">No scores yet!</div>
        <div v-else class="lb-grid">
          <div class="lb-grid-corner"></div>
          <div class="lb-grid-hdr" v-for="bs in boardSizeOptions" :key="bs.value">{{ bs.label }}</div>
          <template v-for="diff in difficultyOptions" :key="diff.value">
            <div class="lb-grid-row">{{ diff.label }}</div>
            <div
              class="lb-grid-cell"
              :class="{ active: isActiveCell(diff.label, bs.label) }"
              v-for="bs in boardSizeOptions"
              :key="bs.value"
            >
              <div
                v-for="entry in leaderboardGrid[activeModeTab][diff.label][bs.label]"
                :key="entry.date + entry.score"
                class="lb-cell-item"
              >
                <span class="lb-cell-score">{{ entry.score }}</span>
                <span v-if="entry.obstacles" class="lb-tag lb-obs">Obs</span>
              </div>
              <div
                v-if="leaderboardGrid[activeModeTab][diff.label][bs.label].length === 0"
                class="lb-cell-empty"
              >—</div>
            </div>
          </template>
        </div>
        <button @click="leaderboard = []; saveLeaderboard()" class="btn btn-small btn-danger">Clear</button>
      </div>

      <div class="game-center">
        <div class="canvas-wrapper" :class="{ 'canvas-wide': isMultiplayer }">
          <canvas ref="canvas" :width="isMultiplayer ? CANVAS_SIZE * 2 + 10 : CANVAS_SIZE" :height="CANVAS_SIZE"></canvas>
          <div v-if="gameStatus === 'idle' && !isMultiplayer" class="overlay">
            <p class="overlay-text">Press Space or Click Start</p>
          </div>
          <div v-if="gameStatus === 'waiting'" class="overlay">
            <div class="waiting-content">
              <p class="waiting-text">Waiting for opponent...</p>
              <p class="waiting-label">Room ID</p>
              <p class="waiting-id">{{ peerId }}</p>
              <p class="waiting-hint">Share this ID with your opponent</p>
              <button @click="$emit('back')" class="btn btn-danger waiting-cancel">Cancel</button>
            </div>
          </div>
          <div v-if="gameStatus === 'ready'" class="overlay">
            <div class="ready-content">
              <p class="ready-title">{{ currentRound === 1 ? 'Opponent Connected!' : 'Round ' + currentRound }}</p>
              <div class="match-scores-bar">
                <span class="msb-item p1-color">{{ matchScore }}</span>
                <span class="msb-divider">:</span>
                <span class="msb-item p2-color">{{ opponentMatchScore }}</span>
              </div>
              <div class="ready-players">
                <div class="ready-player" :class="{ 'ready-done': myReady }">
                  <span class="ready-icon">{{ myReady ? '✓' : '⋯' }}</span>
                  <span>You</span>
                </div>
                <span class="ready-vs">VS</span>
                <div class="ready-player" :class="{ 'ready-done': opponentReady }">
                  <span class="ready-icon">{{ opponentReady ? '✓' : '⋯' }}</span>
                  <span>Opponent</span>
                </div>
              </div>
              <button v-if="!myReady" @click="pressReady" class="btn btn-primary ready-btn">Ready</button>
              <p v-else class="ready-waiting">Waiting for opponent...</p>
            </div>
          </div>
          <div v-if="gameStatus === 'countdown'" class="overlay">
            <div class="countdown-content">
              <p class="countdown-number">{{ countdownValue }}</p>
              <p class="countdown-label">Get Ready!</p>
            </div>
          </div>
          <div v-if="gameStatus === 'match_over'" class="overlay">
            <div class="match-over-content">
              <p class="match-over-title">{{ gameWinner === playerIndex.value ? 'YOU WIN!' : 'YOU LOSE' }}</p>
              <p class="match-over-subtitle">First to {{ WIN_SCORE }} wins</p>
              <div class="match-scores">
                <div class="match-score-item">
                  <span class="match-score-label">You</span>
                  <span class="match-score-value p1-color">{{ matchScore }}</span>
                </div>
                <span class="match-score-divider">-</span>
                <div class="match-score-item">
                  <span class="match-score-label">Opponent</span>
                  <span class="match-score-value p2-color">{{ opponentMatchScore }}</span>
                </div>
              </div>
              <div class="match-rematch">
                <button v-if="!rematchRequested && !opponentRematch" @click="requestRematch" class="btn btn-primary match-rematch-btn">Rematch</button>
                <div v-else-if="rematchRequested && !opponentRematch" class="rematch-status">
                  <p>Waiting for opponent...</p>
                  <button @click="$emit('back')" class="btn btn-danger">Quit</button>
                </div>
                <div v-else-if="opponentRematch && !rematchRequested" class="rematch-status">
                  <p>Opponent wants a rematch!</p>
                  <div class="rematch-actions">
                    <button @click="acceptRematch" class="btn btn-primary">Accept</button>
                    <button @click="$emit('back')" class="btn btn-danger">Quit</button>
                  </div>
                </div>
                <div v-else class="rematch-status">
                  <p>Starting rematch...</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="isMultiplayer" class="controls">
          <button @click="$emit('back')" class="btn btn-danger">Disconnect</button>
        </div>
        <div v-else class="controls">
          <button @click="startGame" class="btn btn-primary">
            {{ gameStatus === 'gameover' || gameStatus === 'win' ? 'Play Again' : 'Start Game' }}
          </button>
        </div>

        <div class="instructions">
          <p v-if="isMultiplayer">Use <kbd>Arrow Keys</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move your snake</p>
          <p v-else>Use <kbd>Arrow Keys</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move</p>
        </div>
      </div>

      <div v-if="!isMultiplayer || (props.mode === 'host' && gameStatus === 'waiting') || gameStatus === 'ready'" class="settings-panel">
        <h3>Settings</h3>
        <div class="setting-group">
          <label>Board Size</label>
          <div class="difficulty-buttons">
            <button
              v-for="opt in boardSizeOptions"
              :key="opt.value"
              :disabled="props.mode === 'guest'"
              @click="boardSize = opt.value"
              :class="['btn', 'btn-small', { active: boardSize === opt.value }]"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="setting-group">
          <label>Game Mode</label>
          <div class="difficulty-buttons">
            <button
              v-for="opt in gameModeOptions"
              :key="opt.value"
              :disabled="props.mode === 'guest'"
              @click="gameMode = opt.value"
              v-show="opt.value !== 'auto'"
              :class="['btn', 'btn-small', { active: gameMode === opt.value }]"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="setting-group">
          <label>Difficulty</label>
          <div class="difficulty-buttons">
            <button
              v-for="opt in difficultyOptions"
              :key="opt.value"
              :disabled="props.mode === 'guest'"
              @click="difficulty = opt.value"
              :class="['btn', 'btn-small', { active: difficulty === opt.value }]"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="setting-group">
          <label class="checkbox-label">
            <input type="checkbox" v-model="enableObstacles" :disabled="props.mode === 'guest'" />
            Enable Obstacles
          </label>
        </div>
        <p class="current-mode">{{ gameMode === "greedy" ? "Greedy" : currentSpeedLabel }}{{ enableObstacles ? " + Obstacles" : "" }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.snake-game {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
  padding: 20px;
  background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
  min-height: 100vh;
  color: #ffffff;
  position: relative;
}

.btn-back {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 10;
  padding: 8px 16px;
  font-size: 0.9rem;
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-back:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.title {
  font-size: 2.5rem;
  margin: 0;
  background: linear-gradient(135deg, #4ecdc4, #44a8a0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.top-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  gap: 15px;
}

.score-board {
  display: flex;
  gap: 20px;
  background: rgba(255, 255, 255, 0.1);
  padding: 10px 20px;
  border-radius: 10px;
}

.multiplayer-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mp-score {
  background: rgba(255, 255, 255, 0.12);
  gap: 28px;
}

.mp-player-badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 6px;
  letter-spacing: 0.5px;
}

.p1-badge {
  background: rgba(78, 205, 196, 0.2);
  color: #4ecdc4;
  border: 1px solid rgba(78, 205, 196, 0.3);
}

.p2-badge {
  background: rgba(255, 107, 179, 0.2);
  color: #ff6bb3;
  border: 1px solid rgba(255, 107, 179, 0.3);
}

.p1-color {
  color: #4ecdc4 !important;
}

.p2-color {
  color: #ff6bb3 !important;
}

.score-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.label {
  font-size: 0.75rem;
  color: #a0a0a0;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.value {
  font-size: 1.5rem;
  font-weight: bold;
  color: #4ecdc4;
}

.settings-panel {
  width: 280px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
  backdrop-filter: blur(10px);
  align-self: flex-start;
}

.leaderboard-panel {
  width: 320px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 15px;
  backdrop-filter: blur(10px);
  align-self: flex-start;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.15) transparent;
}

.leaderboard-panel::-webkit-scrollbar {
  width: 4px;
}

.leaderboard-panel::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.15);
  border-radius: 2px;
}

.game-layout {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: center;
  gap: 20px;
  width: 100%;
  max-width: 1200px;
}

.game-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
}

.settings-panel h3,
.leaderboard-panel h3 {
  margin: 0 0 15px 0;
  font-size: 1.2rem;
  color: #4ecdc4;
}

.setting-group {
  margin-bottom: 15px;
}

.setting-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.9rem;
  color: #a0a0a0;
}

.difficulty-buttons {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 10px 24px;
  font-size: 1rem;
  font-weight: bold;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon {
  padding: 8px 16px;
  font-size: 0.85rem;
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.2);
}

.btn-small {
  padding: 6px 14px;
  font-size: 0.85rem;
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.btn-small:hover {
  background: rgba(255, 255, 255, 0.2);
}

.btn-small.active {
  background: #4ecdc4;
  color: #1a1a2e;
}

.btn-small:disabled {
  opacity: 0.7;
  cursor: default;
}

.btn-small:disabled:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn-small.active:disabled {
  background: #4ecdc4;
  opacity: 0.7;
}

.btn-danger {
  background: #ff6b6b;
  color: #ffffff;
}

.btn-danger:hover {
  background: #ff5252;
}

.btn-primary {
  background: linear-gradient(135deg, #4ecdc4, #44a8a0);
  color: #1a1a2e;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(78, 205, 196, 0.4);
}

.slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  outline: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  background: #4ecdc4;
  border-radius: 50%;
  cursor: pointer;
}

.speed-hint {
  font-size: 0.75rem;
  color: #666;
  display: block;
  margin-top: 4px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label input {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.current-mode {
  font-size: 0.85rem;
  color: #ffd700;
  margin: 10px 0 0 0;
}

.lb-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.btn-tiny {
  flex: 1;
  padding: 6px 10px;
  font-size: 0.78rem;
  font-weight: 700;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.25s ease;
  background: rgba(255, 255, 255, 0.04);
  color: #777;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.btn-tiny.active {
  background: linear-gradient(135deg, #4ecdc4, #44b3ab);
  color: #1a1a2e;
  border-color: #4ecdc4;
  box-shadow: 0 0 16px rgba(78, 205, 196, 0.35);
}

.btn-tiny:hover:not(.active) {
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
}

.lb-grid {
  display: grid;
  grid-template-columns: 60px repeat(3, 1fr);
  gap: 4px;
  margin-bottom: 14px;
}

.lb-grid-corner {
  border-radius: 6px 0 0 0;
}

.lb-grid-corner,
.lb-grid-hdr {
  text-align: center;
  color: #888;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  padding: 6px 2px 4px;
  font-weight: 700;
}

.lb-grid-hdr {
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 5px;
}

.lb-grid-row {
  color: #ffd700;
  font-size: 0.7rem;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  font-weight: 600;
  text-shadow: 0 0 8px rgba(255, 215, 0, 0.15);
}

.lb-grid-cell {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  padding: 5px 6px;
  min-height: 38px;
  border: 1px solid transparent;
  transition: all 0.25s ease;
}

.lb-grid-cell:hover {
  background: rgba(255, 255, 255, 0.06);
}

.lb-grid-cell.active {
  background: linear-gradient(135deg, rgba(78, 205, 196, 0.12), rgba(78, 205, 196, 0.05));
  border-color: rgba(78, 205, 196, 0.45);
  box-shadow: 0 0 14px rgba(78, 205, 196, 0.12), inset 0 0 20px rgba(78, 205, 196, 0.04);
}

.lb-cell-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
}

.lb-cell-score {
  font-weight: 800;
  color: #4ecdc4;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.lb-tag {
  font-size: 0.5rem;
  padding: 1px 4px;
  border-radius: 4px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.lb-obs {
  background: rgba(255, 107, 107, 0.2);
  color: #ff6b6b;
  border: 1px solid rgba(255, 107, 107, 0.15);
}

.lb-cell-empty {
  color: #3a3a3a;
  text-align: center;
  font-size: 0.7rem;
  padding: 4px 0;
}

.empty-leaderboard {
  text-align: center;
  color: #a0a0a0;
  padding: 20px;
}



.empty-difficulty {
  font-size: 0.8rem;
  color: #555;
  padding: 6px 10px;
}





.canvas-wrapper {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 0 30px rgba(78, 205, 196, 0.3);
}

canvas {
  display: block;
}

.overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.waiting-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
}

.waiting-text {
  font-size: 1.3rem;
  color: #ffd700;
  font-weight: 700;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.waiting-label {
  font-size: 0.75rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 8px;
}

.waiting-id {
  font-size: 1.4rem;
  font-weight: 800;
  color: #4ecdc4;
  letter-spacing: 2px;
  background: rgba(78, 205, 196, 0.1);
  padding: 8px 20px;
  border-radius: 8px;
  border: 1px solid rgba(78, 205, 196, 0.3);
}

.waiting-hint {
  font-size: 0.8rem;
  color: #666;
}

.waiting-cancel {
  margin-top: 12px;
}

.ready-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px;
}

.match-scores-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.8rem;
  font-weight: 900;
}

.msb-item {
  font-size: 2rem;
}

.msb-divider {
  color: #555;
  font-size: 1.5rem;
}

.match-over-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 30px;
}

.match-over-title {
  font-size: 2.5rem;
  font-weight: 900;
  color: #ffd700;
  text-shadow: 0 0 30px rgba(255, 215, 0, 0.4);
}

.match-over-subtitle {
  font-size: 0.85rem;
  color: #888;
}

.match-scores {
  display: flex;
  align-items: center;
  gap: 20px;
  background: rgba(255, 255, 255, 0.06);
  padding: 16px 30px;
  border-radius: 12px;
}

.match-score-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.match-score-label {
  font-size: 0.75rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.match-score-value {
  font-size: 2.5rem;
  font-weight: 900;
}

.match-score-divider {
  color: #444;
  font-size: 2rem;
  font-weight: 300;
}

.match-rematch {
  margin-top: 8px;
}

.match-rematch-btn {
  padding: 14px 50px;
  font-size: 1.1rem;
}

.rematch-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.rematch-status p {
  color: #aaa;
  font-size: 0.95rem;
}

.rematch-actions {
  display: flex;
  gap: 10px;
}

.ready-title {
  font-size: 1.3rem;
  font-weight: 700;
  color: #4ecdc4;
}

.ready-players {
  display: flex;
  align-items: center;
  gap: 24px;
}

.ready-player {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 20px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 2px solid rgba(255, 255, 255, 0.1);
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.3s;
}

.ready-player.ready-done {
  border-color: #4ecdc4;
  background: rgba(78, 205, 196, 0.1);
  box-shadow: 0 0 20px rgba(78, 205, 196, 0.2);
}

.ready-icon {
  font-size: 1.5rem;
  color: #666;
}

.ready-done .ready-icon {
  color: #4ecdc4;
}

.ready-vs {
  color: #666;
  font-weight: 700;
  font-size: 1.1rem;
}

.ready-btn {
  padding: 14px 60px;
  font-size: 1.2rem;
  animation: readyPulse 1.5s ease-in-out infinite;
}

@keyframes readyPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(78, 205, 196, 0.4); }
  50% { box-shadow: 0 0 0 12px rgba(78, 205, 196, 0); }
}

.ready-waiting {
  color: #888;
  font-size: 0.95rem;
}

.countdown-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.countdown-number {
  font-size: 6rem;
  font-weight: 900;
  color: #ffd700;
  text-shadow: 0 0 40px rgba(255, 215, 0, 0.4);
  animation: countPop 0.5s ease-out;
  margin: 0;
}

@keyframes countPop {
  0% { transform: scale(1.5); opacity: 0.5; }
  100% { transform: scale(1); opacity: 1; }
}

.countdown-label {
  font-size: 1.2rem;
  color: #4ecdc4;
  font-weight: 600;
}

.overlay-text {
  font-size: 1.25rem;
  color: #ffffff;
  background: rgba(78, 205, 196, 0.8);
  padding: 12px 24px;
  border-radius: 8px;
}

.controls {
  margin-top: 10px;
}

.instructions {
  color: #a0a0a0;
  font-size: 0.875rem;
}

kbd {
  background: rgba(255, 255, 255, 0.1);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-family: monospace;
  margin: 0 2px;
}

@media (max-width: 1200px) {
  .game-layout {
    flex-direction: column;
    align-items: center;
  }
  .settings-panel,
  .leaderboard-panel {
    width: 400px;
    max-width: 90vw;
  }
}
</style>
