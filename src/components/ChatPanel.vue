<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import * as multiplayer from '../game/multiplayer.js'

const props = defineProps({
  collapsed: { type: Boolean, default: false }
})

const emit = defineEmits(['toggle'])

const chatMessages = ref([])
const chatInput = ref('')
const chatBoxRef = ref(null)
let _timer = null

onMounted(() => {
  chatMessages.value = multiplayer.getChatMessages()
  _timer = setInterval(() => {
    const msgs = multiplayer.getChatMessages()
    if (JSON.stringify(msgs) !== JSON.stringify(chatMessages.value)) {
      chatMessages.value = msgs
      nextTick(() => {
        const el = chatBoxRef.value
        if (el) el.scrollTop = el.scrollHeight
      })
    }
  }, 500)
})

onUnmounted(() => {
  clearInterval(_timer)
})

function send() {
  const text = chatInput.value.trim()
  if (!text) return
  const name = multiplayer.getPlayerName()
  multiplayer.sendChatMessage(name, text)
  multiplayer.sendChatRelayMessage(name, text)
  chatInput.value = ''
  chatMessages.value = multiplayer.getChatMessages()
  nextTick(() => {
    const el = chatBoxRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}
</script>

<template>
  <div class="chat-panel-wrapper" :class="{ collapsed }">
    <button class="chat-toggle-btn" @click="$emit('toggle')">
      {{ collapsed ? '◀' : '▶' }}
      <span v-if="collapsed" class="chat-toggle-label">Chat</span>
    </button>
    <div v-show="!collapsed" class="chat-panel">
      <h3>Chat</h3>
      <div class="chat-messages" ref="chatBoxRef">
        <div v-for="(msg, i) in chatMessages" :key="msg.id || i" class="chat-msg">
          <span class="chat-sender">{{ msg.sender }}</span>
          <span class="chat-text">{{ msg.text }}</span>
        </div>
        <div v-if="chatMessages.length === 0" class="chat-empty">No messages yet</div>
      </div>
      <div class="chat-input-row">
        <input
          v-model="chatInput"
          class="chat-input"
          placeholder="Type a message..."
          @keyup.enter="send"
        />
        <button @click="send" class="chat-send-btn">Send</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-panel-wrapper {
  position: fixed;
  right: 0;
  bottom: 12px;
  width: clamp(320px, 30vw, 480px);
  background: rgba(15, 15, 35, 0.95);
  border: 1px solid rgba(78, 205, 196, 0.2);
  border-right: none;
  border-bottom: none;
  border-radius: 0 12px 0 0;
  backdrop-filter: blur(12px);
  padding: clamp(14px, 2vw, 20px);
  transition: width 0.3s ease, padding 0.3s ease, bottom 0.3s ease;
  max-height: 50vh;
  overflow-y: auto;
  z-index: 200;
}
.chat-panel-wrapper.collapsed {
  overflow: hidden;
  width: auto;
  height: auto;
  padding: 6px 10px;
  border-radius: 12px 0 0 12px;
  bottom: 80px;
  background: rgba(15, 15, 35, 0.95);
  border: 1px solid rgba(78, 205, 196, 0.3);
  border-right: none;
  cursor: pointer;
}
.chat-panel-wrapper.collapsed:hover {
  background: rgba(25, 25, 50, 0.98);
  border-color: rgba(78, 205, 196, 0.6);
}
.chat-panel-wrapper.collapsed .chat-toggle-btn {
  position: static;
  background: transparent;
  padding: 8px 6px;
  flex-direction: row;
  gap: 6px;
}
.chat-panel-wrapper.collapsed .chat-toggle-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #4ecdc4;
  writing-mode: horizontal-tb;
}
.chat-toggle-btn {
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
  display: flex;
  align-items: center;
  gap: 4px;
}
.chat-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.chat-toggle-label {
  font-size: 0.6rem;
  font-weight: 700;
  writing-mode: vertical-rl;
  text-orientation: mixed;
}
.chat-panel h3 {
  margin: 0 0 12px 0;
  font-size: 1rem;
  color: #4ecdc4;
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
  .chat-panel-wrapper {
    width: clamp(200px, 50vw, 280px);
    max-height: 300px;
  }
  .chat-messages {
    max-height: 180px;
  }
}
</style>
