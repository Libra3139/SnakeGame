import Peer from 'peerjs'

let peer = null
let conn = null
let _isHost = false
let _myPeerId = null
let _onDataCb = null
let _onDisconnectCb = null
let _onConnCb = null
let _pendingData = []

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
        if (_onConnCb) _onConnCb()
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
}

export function isHost() {
  return _isHost
}

export function myPeerId() {
  return _myPeerId
}
