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
          if (now - (room.lastPing || room.joinedAt) > 15000) {
            rooms.delete(key)
            changed = true
          }
        }
        if (changed) broadcastRooms()
      }, 10000)
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
              lastPing: Date.now()
            })
            c.send({ type: 'registered', ok: true })
            broadcastRooms()
            break
          case 'unregister':
            rooms.delete(c.peer)
            broadcastRooms()
            break
          case 'list':
            c.send({
              type: 'room_list',
              rooms: Array.from(rooms.values()).filter(r => Date.now() - (r.lastPing || r.joinedAt) <= 15000)
            })
            break
          case 'ping':
            const room = rooms.get(c.peer)
            if (room) room.lastPing = Date.now()
            c.send({ type: 'pong' })
            break
        }
      })
      c.on('close', () => {
        if (rooms.delete(c.peer)) broadcastRooms()
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
        c.send({ type: 'register', peerId: hostPeerId, name: 'Snake Game' })
        _lobbyConn = { conn: c, peer: p }
        _lobbyHeartbeat = setInterval(() => {
          try { c.send({ type: 'ping' }) } catch {}
        }, 5000)
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
        if (_onConnCb) { _onConnCb() }
        else { _pendingConn = true }
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
  return _myPeerId
}
