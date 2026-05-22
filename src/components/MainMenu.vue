<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as multiplayer from '../game/multiplayer.js'
import ChatPanel from './ChatPanel.vue'

const emit = defineEmits(['startSingle', 'startMultiplayerHost', 'startMultiplayerGuest', 'back'])

const showMultiplayer = ref(false)
const roomId = ref('')
const myPeerId = ref('')
const playerName = ref('')
const connecting = ref(false)
const error = ref('')
const lobbyMode = ref('')
const roomList = ref([])
const activePlayers = ref([])
const fetchingRooms = ref(false)
const playerListCollapsed = ref(false)
const chatPanelCollapsed = ref(true)
const lobbyStarted = ref(false)
const lobbyOnline = ref(false)

let _roomListTimer = null
let _roomPingTimer = null
let _presenceTimer = null

watch(showMultiplayer, (val) => {
  clearInterval(_roomListTimer)
  clearInterval(_roomPingTimer)
  if (val) {
    multiplayer.autoHostLobby()
    refreshRoomList()
    _roomListTimer = setInterval(refreshRoomList, 5000)
    _roomPingTimer = setInterval(() => {
      if (myPeerId.value) multiplayer.updateLocalRoomPing(myPeerId.value)
    }, 10000)
  }
})

onMounted(() => {
  const identity = multiplayer.generateIdentity()
  playerName.value = identity.name
  multiplayer.registerPlayerPresence()
  multiplayer.initChatRelay().then(() => {
    multiplayer.onChatRelayMessage((data) => {
      multiplayer.sendChatMessage(data.sender, data.text)
    })
    multiplayer.startPlayerPresenceRelay()
  }).catch(() => {})
  refreshActivePlayers()
  _presenceTimer = setInterval(() => {
    multiplayer.updatePlayerPresencePing()
    refreshActivePlayers()
  }, 5000)
})

onUnmounted(() => {
  clearInterval(_roomListTimer)
  clearInterval(_roomPingTimer)
  clearInterval(_presenceTimer)
})

async function refreshRoomList() {
  fetchingRooms.value = true
  try {
    const rooms = await multiplayer.fetchRooms()
    roomList.value = rooms
    lobbyOnline.value = true
  } catch {
    roomList.value = []
    lobbyOnline.value = false
  }
  fetchingRooms.value = false
}

function refreshActivePlayers() {
  activePlayers.value = multiplayer.fetchActivePlayers()
}

async function toggleLobby() {
  if (lobbyStarted.value) {
    multiplayer.stopLobby()
    lobbyStarted.value = false
    return
  }
  try {
    await multiplayer.startLobby()
    multiplayer.onRoomList((rooms) => {
      roomList.value = rooms
    })
    lobbyStarted.value = true
    lobbyOnline.value = true
    roomList.value = []
  } catch {
    error.value = 'Failed to start lobby'
  }
}

async function createRoom() {
  connecting.value = true
  error.value = ''
  lobbyMode.value = 'host'
  try {
    const id = await multiplayer.createRoom()
    myPeerId.value = id
    try {
      await multiplayer.registerWithLobby(id)
    } catch {}
    emit('startMultiplayerHost')
  } catch (e) {
    error.value = 'Failed to create room: ' + e.message
    lobbyMode.value = ''
  }
  connecting.value = false
}

async function joinPeerRoom(peerId) {
  roomId.value = peerId
  await joinRoom()
}

async function joinRoom() {
  if (!roomId.value.trim()) return
  connecting.value = true
  error.value = ''
  lobbyMode.value = 'guest'
  try {
    await multiplayer.joinRoom(roomId.value.trim())
    roomId.value = ''
    emit('startMultiplayerGuest')
  } catch (e) {
    error.value = 'Failed to join room: ' + e.message
    lobbyMode.value = ''
  }
  connecting.value = false
}

function stopLobby() {
  multiplayer.disconnect()
  lobbyMode.value = ''
  connecting.value = false
  error.value = ''
  myPeerId.value = ''
}
</script>

<template>
  <div class="menu">
    <div class="player-badge">{{ playerName }}</div>
    <h1 class="menu-title">Snake Game</h1>
    <p class="menu-sub">Classic arcade snake with modern twists</p>

    <div class="menu-buttons">
      <button class="btn menu-btn menu-btn-primary" @click="$emit('startSingle')">
        <span class="btn-icon-symbol">&#x1F40D;</span>
        Single Player
      </button>
      <button class="btn menu-btn menu-btn-secondary" @click="showMultiplayer = !showMultiplayer">
        <span class="btn-icon-symbol">&#x1F517;</span>
        Online Multiplayer
      </button>
    </div>

    <div v-if="showMultiplayer" class="multiplayer-panel">
      <div class="mp-row">
        <button
          class="btn mp-btn"
          :disabled="connecting"
          @click="createRoom"
        >Create Room</button>
        <div class="mp-divider">or</div>
        <div class="mp-join">
          <input
            v-model="roomId"
            class="mp-input"
            placeholder="Enter Room ID"
            :disabled="connecting"
            @keyup.enter="joinRoom"
          />
          <button
            class="btn mp-btn"
            :disabled="connecting || !roomId.trim()"
            @click="joinRoom"
          >Join</button>
        </div>
      </div>

      <div class="mp-divider mp-section-divider">Available Rooms</div>

      <div class="mp-room-list">
        <div v-if="fetchingRooms" class="mp-status">Searching for rooms...</div>
        <div v-else-if="!lobbyOnline" class="mp-lobby-offline">
          <p>No rooms available</p>
          <p class="mp-hint">Start the lobby to allow room discovery, or share your Room ID directly</p>
          <button
            v-if="!lobbyStarted"
            @click="toggleLobby"
            class="btn mp-btn mp-btn-small"
          >Start Lobby Server</button>
          <button
            v-else
            @click="toggleLobby"
            class="btn mp-btn mp-btn-small mp-btn-danger"
          >Stop Lobby Server</button>
        </div>
        <div v-else-if="roomList.length === 0" class="mp-no-rooms">
          <p>No rooms available</p>
          <p class="mp-hint">Create a room to appear here</p>
        </div>
        <div v-else class="mp-rooms">
          <div
            v-for="room in roomList"
            :key="room.peerId"
            class="mp-room-item"
            @click="joinPeerRoom(room.peerId)"
          >
            <span class="mp-room-name">{{ room.playerName || room.name }}</span>
            <span class="mp-room-members">{{ room.memberCount || '?' }} in room</span>
            <span class="mp-room-id-text">{{ room.peerId.slice(0, 12) }}...</span>
            <span class="mp-room-join-hint">Join →</span>
          </div>
        </div>
        <button
          v-if="lobbyOnline"
          @click="refreshRoomList"
          class="btn mp-btn mp-btn-small mp-btn-refresh"
          :disabled="fetchingRooms"
        >Refresh</button>
      </div>

      <div v-if="lobbyStarted" class="mp-lobby-badge">
        Lobby Server Running
      </div>

      <div v-if="connecting" class="mp-status">Connecting...</div>

      <div v-if="lobbyMode === 'host' && myPeerId" class="mp-room-id">
        <p>Room ID: <strong>{{ myPeerId }}</strong></p>
        <p class="mp-hint">Share this Room ID with your opponent</p>
      </div>

      <div v-if="error" class="mp-error">{{ error }}</div>
    </div>

    <ChatPanel
      :collapsed="chatPanelCollapsed"
      @toggle="chatPanelCollapsed = !chatPanelCollapsed"
    />

    <div class="mm-player-list-panel" :class="{ collapsed: playerListCollapsed }">
      <button class="mm-pl-toggle" @click="playerListCollapsed = !playerListCollapsed">
        {{ playerListCollapsed ? '◀' : '▶' }}
      </button>
      <div v-show="!playerListCollapsed" class="mm-pl-content">
        <h3>Players</h3>
        <div class="mm-pl-item mm-pl-you">
          <span class="mm-pl-dot"></span>
          <span class="mm-pl-name">{{ playerName }}</span>
          <span class="mm-pl-tag">You</span>
        </div>
        <template v-for="p in activePlayers" :key="p.playerUUID">
          <div v-if="p.playerName !== playerName" class="mm-pl-item mm-pl-other">
            <span class="mm-pl-dot"></span>
            <span class="mm-pl-name">{{ p.playerName }}</span>
          </div>
        </template>
        <div v-if="activePlayers.length <= 1" class="mm-pl-item mm-pl-empty">
          <span class="mm-pl-name">No other players</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
  color: #ffffff;
  gap: 10px;
  padding: 0;
  position: relative;
}

.player-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(78, 205, 196, 0.15);
  border: 1px solid rgba(78, 205, 196, 0.3);
  color: #4ecdc4;
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.menu-title {
  font-size: clamp(2rem, 8vw, 4rem);
  margin: 0;
  background: linear-gradient(135deg, #4ecdc4, #44a8a0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  text-shadow: 0 0 40px rgba(78, 205, 196, 0.3);
}

.menu-sub {
  color: #888;
  font-size: 1.1rem;
  margin: 0 0 40px 0;
}

.menu-buttons {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(320px, 85vw);
}

.menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 32px;
  font-size: 1.2rem;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.25s ease;
  font-weight: 700;
}

.menu-btn-primary {
  background: linear-gradient(135deg, #4ecdc4, #44a8a0);
  color: #1a1a2e;
}

.menu-btn-primary:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 30px rgba(78, 205, 196, 0.4);
}

.menu-btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.menu-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: translateY(-3px);
}

.btn-icon-symbol {
  font-size: 1.4rem;
}

.multiplayer-panel {
  margin-top: 30px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 24px;
  width: 420px;
  max-width: 90vw;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.mp-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.mp-btn {
  padding: 12px 24px;
  background: #4ecdc4;
  color: #1a1a2e;
  font-weight: 700;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s;
}

.mp-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(78, 205, 196, 0.35);
}

.mp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mp-divider {
  color: #666;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.mp-join {
  display: flex;
  gap: 8px;
  width: 100%;
}

.mp-input {
  flex: 1;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: #ffffff;
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

.mp-input:focus {
  border-color: #4ecdc4;
}

.mp-input::placeholder {
  color: #666;
}

.mp-status {
  text-align: center;
  color: #ffd700;
  margin-top: 12px;
  font-size: 0.95rem;
}

.mp-room-id {
  margin-top: 16px;
  text-align: center;
  background: rgba(78, 205, 196, 0.1);
  border: 1px solid rgba(78, 205, 196, 0.3);
  border-radius: 10px;
  padding: 14px;
}

.mp-room-id p {
  margin: 4px 0;
  font-size: 0.95rem;
}

.mp-room-id strong {
  color: #4ecdc4;
  font-size: 1.1rem;
  letter-spacing: 1px;
}

.mp-hint {
  color: #888;
  font-size: 0.8rem !important;
}

.mp-error {
  color: #ff6b6b;
  margin-top: 12px;
  text-align: center;
  font-size: 0.9rem;
}

.mp-section-divider {
  margin: 20px 0 12px;
  font-size: 0.75rem;
}

.mp-room-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.mp-lobby-offline,
.mp-no-rooms {
  text-align: center;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.08);
}

.mp-lobby-offline p,
.mp-no-rooms p {
  margin: 4px 0;
  color: #888;
  font-size: 0.9rem;
}

.mp-lobby-offline .mp-btn {
  margin-top: 10px;
}

.mp-btn-small {
  padding: 8px 16px;
  font-size: 0.85rem;
}

.mp-btn-danger {
  background: #ff6b6b;
  color: #fff;
}

.mp-btn-danger:hover {
  background: #ff5252;
}

.mp-btn-refresh {
  background: rgba(255, 255, 255, 0.08);
  color: #ccc;
  border: 1px solid rgba(255, 255, 255, 0.1);
  align-self: center;
  margin-top: 4px;
}

.mp-btn-refresh:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.mp-rooms {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.mp-room-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: all 0.2s;
}

.mp-room-item:hover {
  background: rgba(78, 205, 196, 0.1);
  border-color: rgba(78, 205, 196, 0.3);
}

.mp-room-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: #4ecdc4;
}

.mp-room-members {
  font-size: 0.7rem;
  color: #888;
  margin-left: 4px;
}

.mp-room-id-text {
  color: #666;
  font-size: 0.75rem;
  font-family: monospace;
}

.mp-room-join-hint {
  margin-left: auto;
  color: #555;
  font-size: 0.8rem;
  font-weight: 600;
}

.mp-room-item:hover .mp-room-join-hint {
  color: #4ecdc4;
}

.mp-lobby-badge {
  text-align: center;
  font-size: 0.7rem;
  color: #4ecdc4;
  background: rgba(78, 205, 196, 0.1);
  padding: 4px 12px;
  border-radius: 20px;
  display: inline-block;
  margin: 8px auto 0;
}

.mm-player-list-panel {
  position: fixed;
  right: 0;
  top: 80px;
  width: clamp(180px, 20vw, 220px);
  background: rgba(15, 15, 35, 0.92);
  border: 1px solid rgba(78, 205, 196, 0.2);
  border-right: none;
  border-radius: 12px 0 0 12px;
  backdrop-filter: blur(12px);
  padding: clamp(12px, 2vw, 16px);
  transition: width 0.3s ease, padding 0.3s ease;
  overflow: hidden;
  z-index: 100;
}
.mm-player-list-panel.collapsed {
  width: 40px;
  padding: 16px 8px;
}
.mm-pl-toggle {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #aaa;
  font-size: 0.9rem;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  line-height: 1;
  z-index: 2;
}
.mm-player-list-panel.collapsed .mm-pl-toggle {
  left: 6px;
}
.mm-pl-toggle:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.mm-pl-content h3 {
  margin: 0 0 12px 0;
  font-size: 1rem;
  color: #4ecdc4;
}
.mm-pl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 6px;
}
.mm-pl-you {
  background: rgba(78, 205, 196, 0.1);
  border: 1px solid rgba(78, 205, 196, 0.25);
}
.mm-pl-other {
  background: rgba(255, 107, 179, 0.1);
  border: 1px solid rgba(255, 107, 179, 0.25);
}
.mm-pl-empty {
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.1);
}
.mm-pl-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ecdc4;
  flex-shrink: 0;
}
.mm-pl-other .mm-pl-dot {
  background: #ff6bb3;
}
.mm-pl-empty .mm-pl-dot {
  background: #555;
}
.mm-pl-name {
  font-size: 0.85rem;
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-pl-tag {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #4ecdc4;
  background: rgba(78, 205, 196, 0.15);
  padding: 2px 6px;
  border-radius: 4px;
}

.mm-chat-panel {
  position: fixed;
  right: 0;
  bottom: 0;
  width: clamp(280px, 26vw, 380px);
  background: rgba(15, 15, 35, 0.95);
  border: 1px solid rgba(78, 205, 196, 0.2);
  border-right: none;
  border-bottom: none;
  border-radius: 0 12px 0 0;
  backdrop-filter: blur(12px);
  padding: clamp(14px, 2vw, 20px);
  transition: width 0.3s ease, padding 0.3s ease;
  overflow: hidden;
  z-index: 100;
  max-height: 400px;
}
.mm-chat-panel.collapsed {
  width: 40px;
  height: 40px;
  padding: 12px 8px;
  border-radius: 0;
}
.chat-messages {
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 30px 0 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.15) transparent;
}
.mm-chat-panel .mm-pl-toggle {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #aaa;
  font-size: 0.9rem;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  line-height: 1;
  z-index: 2;
}
.mm-chat-panel.collapsed .mm-pl-toggle {
  left: 6px;
}
.mm-chat-panel .mm-pl-toggle:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.chat-msg {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 6px;
  background: rgba(255,255,255,0.04);
  border-radius: 4px;
}
.chat-sender {
  font-size: 0.65rem;
  font-weight: 700;
  color: #4ecdc4;
}
.chat-text {
  font-size: 0.8rem;
  color: #ddd;
  word-break: break-word;
}
.chat-empty {
  font-size: 0.75rem;
  color: #666;
  text-align: center;
  padding: 30px 0;
}
.chat-input-row {
  display: flex;
  gap: 4px;
}
.chat-input {
  flex: 1;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-size: 0.8rem;
  outline: none;
  min-width: 0;
}
.chat-input:focus {
  border-color: #4ecdc4;
}
.chat-input::placeholder {
  color: #666;
}
.chat-send-btn {
  padding: 6px 10px;
  background: #4ecdc4;
  color: #1a1a2e;
  font-weight: 700;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  white-space: nowrap;
}
.chat-send-btn:hover {
  background: #3dbdb5;
}

@media (max-width: 600px) {
  .multiplayer-panel {
    padding: 16px;
  }
  .mp-rooms {
    max-height: 150px;
  }
  .mm-player-list-panel {
    width: clamp(140px, 40vw, 180px);
  }
  .mm-player-list-panel.collapsed {
    width: 36px;
    padding: 12px 4px;
  }
}
</style>
