<script setup>
import { ref } from 'vue'
import MainMenu from './components/MainMenu.vue'
import SnakeGame from './components/SnakeGame.vue'

const screen = ref('menu')

function startSingle() {
  screen.value = 'single'
}

function startMultiplayerHost() {
  screen.value = 'host'
}

function startMultiplayerGuest() {
  screen.value = 'guest'
}

function goBack() {
  screen.value = 'menu'
}
</script>

<template>
  <MainMenu
    v-if="screen === 'menu'"
    @startSingle="startSingle"
    @startMultiplayerHost="startMultiplayerHost"
    @startMultiplayerGuest="startMultiplayerGuest"
  />
  <SnakeGame
    v-else
    :mode="screen"
    @back="goBack"
  />
</template>
