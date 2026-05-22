<script setup>
import { ref } from 'vue'
import * as multiplayer from '../game/multiplayer.js'

const emit = defineEmits(['startSingle', 'startMultiplayerHost', 'startMultiplayerGuest', 'back'])

const showMultiplayer = ref(false)
const roomId = ref('')
const myPeerId = ref('')
const connecting = ref(false)
const error = ref('')
const lobbyMode = ref('') // 'host' | 'guest'

async function createRoom() {
  connecting.value = true
  error.value = ''
  lobbyMode.value = 'host'
  try {
    const id = await multiplayer.createRoom()
    myPeerId.value = id
    multiplayer.onConnection(() => {
      emit('startMultiplayerHost')
    })
    multiplayer.onData((data) => {
      if (data.type === 'start_game') {
        emit('startMultiplayerHost')
      }
    })
    multiplayer.onDisconnect(() => {
      error.value = 'Opponent disconnected'
      stopLobby()
    })
  } catch (e) {
    error.value = 'Failed to create room: ' + e.message
    lobbyMode.value = ''
  }
  connecting.value = false
}

async function joinRoom() {
  if (!roomId.value.trim()) return
  connecting.value = true
  error.value = ''
  lobbyMode.value = 'guest'
  try {
    await multiplayer.joinRoom(roomId.value.trim())
    multiplayer.send({ type: 'start_game' })
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

      <div v-if="connecting" class="mp-status">Connecting...</div>

      <div v-if="lobbyMode === 'host' && myPeerId" class="mp-room-id">
        <p>Room ID: <strong>{{ myPeerId }}</strong></p>
        <p class="mp-hint">Share this ID with your opponent</p>
      </div>

      <div v-if="error" class="mp-error">{{ error }}</div>
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
  padding: 20px;
}

.menu-title {
  font-size: 4rem;
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
  width: 320px;
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
</style>
