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
let _lobbyChatConns = new Map()
let _lobbyChatPeer = null
let _lobbyChatConn = null

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
      _lobbyChatConns.set(c.peer, c)
      c.on('close', () => {
        _lobbyChatConns.delete(c.peer)
        for (const [key, room] of rooms) {
          if (room.connPeer === c.peer) { rooms.delete(key); broadcastRooms(); break }
        }
      })
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
          case 'chat':
            for (const [peerId, conn] of _lobbyChatConns) {
              if (peerId !== c.peer && conn.open) {
                try { conn.send({ type: 'chat', sender: data.sender, text: data.text }) } catch {}
              }
            }
            break
        }
      })
    })
  })
}

export function stopLobby() {
  if (_lobbyCleanupTimer) { clearInterval(_lobbyCleanupTimer); _lobbyCleanupTimer = null }
  if (_lobbyPeer) { _lobbyPeer.destroy(); _lobbyPeer = null }
  rooms.clear()
  _lobbyChatConns.clear()
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

const CHAT_RELAY_ID = 'snake-chat-relay'
let _chatRelayPeer = null
let _chatRelayConns = new Set()
let _chatRelayConn = null
let _chatRelayCb = null
let _remotePlayers = new Map()
let _presenceRelayTimer = null

function _cleanupRemotePlayers() {
  const now = Date.now()
  for (const [uuid, p] of _remotePlayers) {
    if (now - p.timestamp > PRESENCE_TTL * 2) _remotePlayers.delete(uuid)
  }
}

export function initChatRelay() {
  if (_chatRelayConn || _chatRelayPeer) return Promise.resolve()
  _tryConnectToLobbyChat()
  return _tryConnectRelay().catch(() => _becomeChatRelay().catch(() => {
    _tryConnectRelay()
  }))
}

function _tryConnectToLobbyChat() {
  if (_lobbyChatConn) return
  const p = new Peer()
  p.on('open', () => {
    const c = p.connect(LOBBY_ID, { reliable: true })
    c.on('open', () => {
      _lobbyChatConn = c
      _lobbyChatPeer = p
      c.on('close', () => { _lobbyChatConn = null; _lobbyChatPeer = null })
      c.on('data', (data) => {
        if (data.type === 'chat' && _chatRelayCb) _chatRelayCb(data)
        if (data.type === 'player_presence' && data.playerUUID !== _playerUUID) {
          _remotePlayers.set(data.playerUUID, {
            playerUUID: data.playerUUID,
            playerName: data.playerName,
            timestamp: Date.now()
          })
        }
      })
    })
    c.on('error', () => { p.destroy() })
  })
  p.on('error', () => {})
}

function _tryConnectRelay() {
  return new Promise((resolve, reject) => {
    const p = new Peer()
    p.on('open', () => {
      const c = p.connect(CHAT_RELAY_ID, { reliable: true })
      c.on('open', () => {
        _chatRelayConn = c
        _chatRelayConn.peerObj = p
        c.on('data', (data) => {
          if (data.type === 'chat' && _chatRelayCb) _chatRelayCb(data)
          if (data.type === 'player_presence' && data.playerUUID !== _playerUUID) {
            _remotePlayers.set(data.playerUUID, {
              playerUUID: data.playerUUID,
              playerName: data.playerName,
              timestamp: Date.now()
            })
          }
        })
        c.on('close', () => { _chatRelayConn = null })
        resolve()
      })
      c.on('error', () => { p.destroy(); reject() })
      setTimeout(() => { if (!_chatRelayConn) { p.destroy(); reject() } }, 5000)
    })
    p.on('error', () => reject())
  })
}

function _becomeChatRelay() {
  return new Promise((resolve, reject) => {
    _chatRelayPeer = new Peer(CHAT_RELAY_ID)
    _chatRelayPeer.on('open', () => {
      resolve()
    })
    _chatRelayPeer.on('connection', (c) => {
      _chatRelayConns.add(c)
      c.on('data', (data) => {
        if (data.type === 'chat') {
          for (const conn of _chatRelayConns) {
            if (conn !== c && conn.open) {
              try { conn.send({ type: 'chat', sender: data.sender, text: data.text }) } catch {}
            }
          }
          if (_chatRelayCb) _chatRelayCb(data)
        }
        if (data.type === 'player_presence') {
          for (const conn of _chatRelayConns) {
            if (conn !== c && conn.open) {
              try { conn.send({ type: 'player_presence', playerUUID: data.playerUUID, playerName: data.playerName }) } catch {}
            }
          }
          if (data.playerUUID !== _playerUUID) {
            _remotePlayers.set(data.playerUUID, {
              playerUUID: data.playerUUID,
              playerName: data.playerName,
              timestamp: Date.now()
            })
          }
        }
      })
      c.on('close', () => _chatRelayConns.delete(c))
    })
    _chatRelayPeer.on('error', () => reject())
  })
}

export function destroyChatRelay() {
  stopPlayerPresenceRelay()
  if (_chatRelayConn) {
    _chatRelayConn.close()
    if (_chatRelayConn.peerObj) _chatRelayConn.peerObj.destroy()
    _chatRelayConn = null
  }
  if (_chatRelayPeer) {
    _chatRelayPeer.destroy()
    _chatRelayPeer = null
  }
  if (_lobbyChatConn) {
    _lobbyChatConn.close()
    _lobbyChatConn = null
  }
  if (_lobbyChatPeer) {
    _lobbyChatPeer.destroy()
    _lobbyChatPeer = null
  }
  _chatRelayConns.clear()
  _remotePlayers.clear()
}

export function sendChatRelayMessage(sender, text) {
  if (_chatRelayConn && _chatRelayConn.open) {
    _chatRelayConn.send({ type: 'chat', sender, text })
  }
  if (_chatRelayPeer) {
    for (const conn of _chatRelayConns) {
      if (conn.open) {
        try { conn.send({ type: 'chat', sender, text }) } catch {}
      }
    }
  }
  if (_lobbyChatConn && _lobbyChatConn.open) {
    _lobbyChatConn.send({ type: 'chat', sender, text })
  }
}

export function onChatRelayMessage(cb) {
  _chatRelayCb = cb
}

export function startPlayerPresenceRelay() {
  stopPlayerPresenceRelay()
  const sendPresence = () => {
    const data = { type: 'player_presence', playerUUID: _playerUUID, playerName: _playerName }
    if (_chatRelayConn && _chatRelayConn.open) {
      _chatRelayConn.send(data)
    }
    if (_chatRelayPeer) {
      for (const conn of _chatRelayConns) {
        if (conn.open) {
          try { conn.send(data) } catch {}
        }
      }
    }
    _cleanupRemotePlayers()
  }
  sendPresence()
  _presenceRelayTimer = setInterval(sendPresence, 5000)
}

export function stopPlayerPresenceRelay() {
  if (_presenceRelayTimer) {
    clearInterval(_presenceRelayTimer)
    _presenceRelayTimer = null
  }
  _remotePlayers.clear()
}

export function autoHostLobby() {
  if (_lobbyPeer) return Promise.resolve()
  return startLobby().catch(() => {
    // Lobby already exists elsewhere, that's fine
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
    try { conn.send(data) } catch {}
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
  for (const [, p] of _remotePlayers) {
    if (now - p.timestamp < PRESENCE_TTL) {
      if (!valid.some(v => v.playerUUID === p.playerUUID)) {
        valid.push({ ...p })
      }
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

const CHAT_KEY = 'snake-chat-messages'

export function getChatMessages() {
  try {
    const data = localStorage.getItem(CHAT_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}

export function sendChatMessage(sender, text) {
  const msgs = getChatMessages()
  const msg = { sender, text, time: Date.now(), id: Date.now() + Math.random() }
  msgs.push(msg)
  if (msgs.length > 20) msgs.splice(0, msgs.length - 20)
  localStorage.setItem(CHAT_KEY, JSON.stringify(msgs))
  localStorage.setItem('snake-chat-ts', Date.now().toString())
  return msg
}

export function clearChatMessages() {
  localStorage.removeItem(CHAT_KEY)
  localStorage.removeItem('snake-chat-ts')
}
