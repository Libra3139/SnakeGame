import Pusher from 'pusher-js'

let pusher = null
let roomChannel = null
let _isHost = false
let _myRoomId = null
let _onDataCb = null
let _onDisconnectCb = null
let _onConnCb = null
let _pendingData = []
let _pendingConn = false

const PUSHER_KEY = import.meta.env.VITE_PUSHER_KEY || ''
const PUSHER_CLUSTER = import.meta.env.VITE_PUSHER_CLUSTER || 'us2'

function checkPusherConfig() {
  if (!PUSHER_KEY) {
    throw new Error('VITE_PUSHER_KEY is not set. Create a .env file with your Pusher credentials. See .env.example')
  }
}

// 確定性亂數產生器（LCG），用於食物種子同步確保雙方地圖公平
export class SeededRandom {
  constructor(seed) {
    this.state = seed | 0
    this.seed = seed
  }
  next() {
    this.state = (this.state * 1664525 + 1013904223) | 0
    return (this.state >>> 0) / 4294967296
  }
  getSeed() {
    return this.seed
  }
}

let _playerUUID = ''
let _playerName = ''

export function generateIdentity() {
  if (_playerUUID && _playerName) return { uuid: _playerUUID, name: _playerName }
  _playerUUID = (crypto.randomUUID && crypto.randomUUID()) || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
  const random6 = Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
  _playerName = `player${random6}`
  return { uuid: _playerUUID, name: _playerName }
}

export function getPlayerName() { return _playerName }
export function getPlayerUUID() { return _playerUUID }

const LOCAL_ROOMS_KEY = 'snake-local-rooms'
const ROOM_TTL = 30000

function getLocalRoomsRaw() {
  try {
    const data = localStorage.getItem(LOCAL_ROOMS_KEY)
    return data ? new Map(JSON.parse(data)) : new Map()
  } catch { return new Map() }
}

function saveLocalRooms(map) {
  localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(Array.from(map.entries())))
}

export function registerLocalRoom(hostRoomId) {
  const rooms = getLocalRoomsRaw()
  rooms.set(hostRoomId, {
    peerId: hostRoomId,
    playerName: _playerName,
    playerUUID: _playerUUID,
    timestamp: Date.now()
  })
  saveLocalRooms(rooms)
}

export function unregisterLocalRoom(roomId) {
  const rooms = getLocalRoomsRaw()
  rooms.delete(roomId)
  saveLocalRooms(rooms)
}

export function updateLocalRoomPing(roomId) {
  const rooms = getLocalRoomsRaw()
  const room = rooms.get(roomId)
  if (room) {
    room.timestamp = Date.now()
    saveLocalRooms(rooms)
  }
}

export function fetchLocalRooms() {
  const rooms = getLocalRoomsRaw()
  const now = Date.now()
  const valid = []
  for (const [, room] of rooms) {
    if (now - room.timestamp < ROOM_TTL) {
      valid.push({ ...room })
    }
  }
  return valid
}

export function fetchRooms() {
  return Promise.resolve(fetchLocalRooms())
}

export function onRoomList() {}

export function startLobby() { return Promise.resolve() }
export function stopLobby() {}

const PLAYER_PRESENCE_KEY = 'snake-player-presence'
const PRESENCE_TTL = 5000

function getPlayerPresenceRaw() {
  try {
    const data = localStorage.getItem(PLAYER_PRESENCE_KEY)
    return data ? new Map(JSON.parse(data)) : new Map()
  } catch { return new Map() }
}

function savePlayerPresence(map) {
  localStorage.setItem(PLAYER_PRESENCE_KEY, JSON.stringify(Array.from(map.entries())))
}

export function registerPlayerPresence() {
  const presences = getPlayerPresenceRaw()
  presences.set(_playerUUID, {
    playerUUID: _playerUUID,
    playerName: _playerName,
    timestamp: Date.now()
  })
  savePlayerPresence(presences)
}

export function unregisterPlayerPresence() {
  const presences = getPlayerPresenceRaw()
  presences.delete(_playerUUID)
  savePlayerPresence(presences)
}

export function updatePlayerPresencePing() {
  const presences = getPlayerPresenceRaw()
  const entry = presences.get(_playerUUID)
  if (entry) {
    entry.timestamp = Date.now()
    savePlayerPresence(presences)
  }
}

export function fetchActivePlayers() {
  const presences = getPlayerPresenceRaw()
  const now = Date.now()
  const valid = []
  for (const [, p] of presences) {
    if (now - p.timestamp < PRESENCE_TTL) {
      valid.push({ ...p })
    }
  }
  return valid
}

function getPusher() {
  if (!pusher) {
    pusher = new Pusher(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      authorizer: (channel) => ({
        authorize: (socketId, callback) => {
          fetch('/api/pusher/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              socket_id: socketId,
              channel_name: channel.name,
              user_id: _playerUUID,
              user_info: { name: _playerName }
            })
          })
          .then(r => r.json())
          .then(data => callback(false, data))
          .catch(err => callback(true, err))
        }
      })
    })
  }
  return pusher
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10)
}

export function createRoom() {
  return new Promise((resolve, reject) => {
    try {
      checkPusherConfig()
    } catch (e) {
      reject(e); return
    }
    const roomId = generateRoomId()
    _isHost = true
    _myRoomId = roomId
    registerLocalRoom(roomId)

    const timeout = setTimeout(() => {
      reject(new Error('Connection timed out. Is the Pusher server reachable?'))
    }, 10000)

    try {
      const p = getPusher()
      roomChannel = p.subscribe(`presence-room-${roomId}`)
      roomChannel.bind('pusher:subscription_succeeded', () => {
        clearTimeout(timeout)
        resolve(roomId)
      })
      roomChannel.bind('client-player_input', (data) => {
        if (_onDataCb) _onDataCb(data)
        else _pendingData.push(data)
      })
      roomChannel.bind('pusher:member_added', () => {
        if (_onConnCb) _onConnCb()
        else _pendingConn = true
      })
      roomChannel.bind('pusher:member_removed', () => {
        if (_onDisconnectCb) _onDisconnectCb()
      })
      roomChannel.bind('pusher:subscription_error', (err) => {
        clearTimeout(timeout)
        reject(new Error('Failed to subscribe to room channel'))
      })
    } catch (e) {
      clearTimeout(timeout)
      reject(e)
    }
  })
}

export function joinRoom(roomId) {
  return new Promise((resolve, reject) => {
    try {
      checkPusherConfig()
    } catch (e) {
      reject(e); return
    }
    _isHost = false
    _myRoomId = roomId

    const timeout = setTimeout(() => {
      reject(new Error('Connection timed out. Is the Pusher server reachable?'))
    }, 10000)

    try {
      const p = getPusher()
      roomChannel = p.subscribe(`presence-room-${roomId}`)
      roomChannel.bind('pusher:subscription_succeeded', () => {
        clearTimeout(timeout)
        resolve()
      })
      roomChannel.bind('client-game_state', (data) => {
        if (_onDataCb) _onDataCb(data)
        else _pendingData.push(data)
      })
      roomChannel.bind('pusher:member_removed', () => {
        if (_onDisconnectCb) _onDisconnectCb()
      })
      roomChannel.bind('pusher:subscription_error', () => {
        clearTimeout(timeout)
        reject(new Error('Failed to subscribe to room channel'))
      })
    } catch (e) {
      clearTimeout(timeout)
      reject(e)
    }
  })
}

export function send(data) {
  if (roomChannel && _myRoomId) {
    const eventName = _isHost ? 'client-game_state' : 'client-player_input'
    roomChannel.trigger(eventName, data)
  }
}

export function onData(cb) {
  _onDataCb = cb
  for (const data of _pendingData) {
    _onDataCb(data)
  }
  _pendingData = []
}

export function onDisconnect(cb) {
  _onDisconnectCb = cb
}

export function onConnection(cb) {
  _onConnCb = cb
  if (_pendingConn) {
    _pendingConn = false
    cb()
  }
}

export function disconnect() {
  if (_myRoomId) unregisterLocalRoom(_myRoomId)
  if (roomChannel && pusher) {
    pusher.unsubscribe(roomChannel.name)
    roomChannel = null
  }
  _isHost = false
  _myRoomId = null
  _onDataCb = null
  _onDisconnectCb = null
  _onConnCb = null
  _pendingData = []
  _pendingConn = false
}

export function isHost() {
  return _isHost
}

export function myPeerId() {
  return _myRoomId || ''
}

let _currentSeed = 0

export function generateSeed() {
  _currentSeed = (Math.random() * 2147483647) | 0
  return _currentSeed
}

export function getCurrentSeed() {
  return _currentSeed
}
