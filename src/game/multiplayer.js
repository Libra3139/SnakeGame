import Peer from 'peerjs'

let peer = null
let conn = null
let _isHost = false
let _myPeerId = null
let _onDataCb = null
let _onDisconnectCb = null
let _onConnCb = null
let _pendingData = []
let _pendingConn = false

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

const PLAYER_PRESENCE_KEY = 'snake-player-presence'
const PRESENCE_TTL = 15000

function getLocalRoomsRaw() {
  try {
    const data = localStorage.getItem(LOCAL_ROOMS_KEY)
    return data ? new Map(JSON.parse(data)) : new Map()
  } catch { return new Map() }
}

function saveLocalRooms(map) {
  localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(Array.from(map.entries())))
}

export function registerLocalRoom(hostPeerId) {
  const rooms = getLocalRoomsRaw()
  rooms.set(hostPeerId, {
    peerId: hostPeerId,
    playerName: _playerName,
    playerUUID: _playerUUID,
    timestamp: Date.now()
  })
  saveLocalRooms(rooms)
}

export function unregisterLocalRoom(peerId) {
  const rooms = getLocalRoomsRaw()
  rooms.delete(peerId)
  saveLocalRooms(rooms)
}

export function updateLocalRoomPing(peerId) {
  const rooms = getLocalRoomsRaw()
  const room = rooms.get(peerId)
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

export function fetchRooms() {
  return Promise.resolve(fetchLocalRooms())
}

export function onRoomList() {}

export function startLobby() {
  return Promise.resolve()
}

export function stopLobby() {}

export function registerWithLobby() {
  return Promise.resolve()
}

export function unregisterFromLobby() {}

export function createRoom() {
  return new Promise((resolve, reject) => {
    peer = new Peer()
    peer.on('open', (id) => {
      _isHost = true
      _myPeerId = id
      registerLocalRoom(id)
      resolve(id)
      peer.on('connection', (connection) => {
        conn = connection
        conn.on('data', (data) => {
          if (_onDataCb) _onDataCb(data)
          else _pendingData.push(data)
        })
        conn.on('close', () => {
          if (_onDisconnectCb) _onDisconnectCb()
        })
        if (_onConnCb) _onConnCb()
        else _pendingConn = true
      })
    })
    peer.on('error', (err) => reject(err))
  })
}

export function joinRoom(hostId) {
  return new Promise((resolve, reject) => {
    peer = new Peer()
    peer.on('open', () => {
      conn = peer.connect(hostId, { reliable: true })
      let resolved = false
      conn.on('open', () => {
        _isHost = false
        _myPeerId = peer.id
        conn.on('data', (data) => {
          if (_onDataCb) _onDataCb(data)
          else _pendingData.push(data)
        })
        conn.on('close', () => {
          if (_onDisconnectCb) _onDisconnectCb()
        })
        if (!resolved) { resolved = true; resolve() }
      })
      conn.on('error', (err) => { if (!resolved) { resolved = true; reject(err) } })
      setTimeout(() => { if (!resolved) { resolved = true; reject(new Error('Connection timeout')) } }, 15000)
    })
    peer.on('error', (err) => reject(err))
  })
}

export function send(data) {
  if (conn && conn.open) {
    conn.send(data)
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
  if (_myPeerId) unregisterLocalRoom(_myPeerId)
  if (conn) { conn.close(); conn = null }
  if (peer) { peer.destroy(); peer = null }
  _isHost = false
  _myPeerId = null
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
  return _myPeerId
}
