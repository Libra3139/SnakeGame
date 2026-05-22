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
const ROOM_TTL = 120000

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
    timestamp: Date.now(),
    memberCount: 1,
  })
  saveLocalRooms(rooms)
}

export function incrementRoomMembers(roomId) {
  const rooms = getLocalRoomsRaw()
  const room = rooms.get(roomId)
  if (room) {
    room.memberCount = (room.memberCount || 1) + 1
    room.timestamp = Date.now()
    saveLocalRooms(rooms)
  }
}

export function decrementRoomMembers(roomId) {
  const rooms = getLocalRoomsRaw()
  const room = rooms.get(roomId)
  if (room) {
    room.memberCount = (room.memberCount || 1) - 1
    room.timestamp = Date.now()
    if (room.memberCount <= 0) {
      rooms.delete(roomId)
    }
    saveLocalRooms(rooms)
  }
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

const LOBBY_ID = 'snake-lobby'
let _lobbyPeer = null
let _lobbyConn = null
let _onRoomListCb = null
let _lobbyCleanupTimer = null
let _lobbyHeartbeat = null

export function startLobby() {
  return new Promise((resolve, reject) => {
    _lobbyPeer = new Peer(LOBBY_ID)
    _lobbyPeer.on('open', () => {
      _lobbyCleanupTimer = setInterval(() => {
        const now = Date.now()
        let changed = false
        for (const [key, room] of rooms) {
          if (now - (room.lastPing || room.joinedAt) > 8000) {
            rooms.delete(key)
            changed = true
          }
        }
        if (changed) broadcastRooms()
      }, 5000)
      resolve()
    })
    _lobbyPeer.on('error', (err) => {
      _lobbyPeer = null
      reject(err)
    })
    _lobbyPeer.on('connection', (c) => {
      c.on('data', (data) => {
        switch (data.type) {
          case 'register':
            rooms.set(data.peerId || c.peer, {
              peerId: data.peerId || c.peer,
              name: data.name || 'Snake Game',
              joinedAt: Date.now(),
              lastPing: Date.now(),
              connPeer: c.peer,
              memberCount: data.memberCount || 1,
            })
            c.send({ type: 'registered', ok: true })
            broadcastRooms()
            break
          case 'unregister':
            for (const [key, room] of rooms) {
              if (room.connPeer === c.peer) { rooms.delete(key); broadcastRooms(); break }
            }
            break
          case 'list':
            c.send({
              type: 'room_list',
              rooms: Array.from(rooms.values()).filter(r => Date.now() - (r.lastPing || r.joinedAt) <= 8000)
            })
            break
          case 'ping':
            for (const room of rooms.values()) {
              if (room.connPeer === c.peer) { room.lastPing = Date.now(); break }
            }
            c.send({ type: 'pong' })
            break
        }
      })
      c.on('close', () => {
        for (const [key, room] of rooms) {
          if (room.connPeer === c.peer) { rooms.delete(key); broadcastRooms(); break }
        }
      })
    })
  })
}

export function stopLobby() {
  if (_lobbyCleanupTimer) { clearInterval(_lobbyCleanupTimer); _lobbyCleanupTimer = null }
  if (_lobbyPeer) { _lobbyPeer.destroy(); _lobbyPeer = null }
  rooms.clear()
}

const rooms = new Map()

function broadcastRooms() {
  const list = Array.from(rooms.values())
  if (_onRoomListCb) _onRoomListCb(list)
}

export function registerWithLobby(hostPeerId) {
  return new Promise((resolve, reject) => {
    if (_lobbyConn) reject(new Error('Already registered'))
    const p = new Peer()
    p.on('open', () => {
      const c = p.connect(LOBBY_ID, { reliable: true })
      c.on('open', () => {
        c.send({ type: 'register', peerId: hostPeerId, name: 'Snake Game', memberCount: 1 })
        _lobbyConn = { conn: c, peer: p }
        _lobbyHeartbeat = setInterval(() => {
          try { c.send({ type: 'ping' }) } catch {}
        }, 3000)
        resolve()
      })
      c.on('error', () => { p.destroy(); reject(new Error('Lobby unavailable')) })
      setTimeout(() => { if (!_lobbyConn) { p.destroy(); reject(new Error('Lobby timeout')) } }, 5000)
    })
    p.on('error', () => reject(new Error('Failed to connect')))
  })
}

export function unregisterFromLobby() {
  if (_lobbyHeartbeat) { clearInterval(_lobbyHeartbeat); _lobbyHeartbeat = null }
  if (_lobbyConn) {
    try { _lobbyConn.conn.send({ type: 'unregister' }) } catch {}
    _lobbyConn.conn.close()
    _lobbyConn.peer.destroy()
    _lobbyConn = null
  }
}

export function fetchRooms() {
  const local = fetchLocalRooms()
  if (local.length > 0) return Promise.resolve(local)
  return new Promise((resolve, reject) => {
    const p = new Peer()
    p.on('open', () => {
      const c = p.connect(LOBBY_ID, { reliable: true })
      c.on('open', () => {
        c.send({ type: 'list' })
        c.on('data', (data) => {
          if (data.type === 'room_list') {
            c.close()
            p.destroy()
            resolve(data.rooms)
          }
        })
      })
      c.on('error', () => { p.destroy(); reject(new Error('Lobby unavailable')) })
      setTimeout(() => { p.destroy(); reject(new Error('Lobby timeout')) }, 5000)
    })
    p.on('error', () => reject(new Error('Failed to connect')))
  })
}

export function onRoomList(cb) {
  _onRoomListCb = cb
}

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
        incrementRoomMembers(id)
        conn.on('data', (data) => {
          if (_onDataCb) _onDataCb(data)
          else _pendingData.push(data)
        })
        conn.on('close', () => {
          decrementRoomMembers(_myPeerId)
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
  if (conn) { conn.close(); conn = null }
  if (peer) { peer.destroy(); peer = null }
  if (_myPeerId) decrementRoomMembers(_myPeerId)
  _isHost = false
  _myPeerId = null
  _onDataCb = null
  _onDisconnectCb = null
  _onConnCb = null
  _pendingData = []
  _pendingConn = false
  try { unregisterFromLobby() } catch {}
}

export function isHost() {
  return _isHost
}

export function myPeerId() {
  return _myPeerId || ''
}

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

let _currentSeed = 0

export function generateSeed() {
  _currentSeed = (Math.random() * 2147483647) | 0
  return _currentSeed
}

export function getCurrentSeed() {
  return _currentSeed
}
