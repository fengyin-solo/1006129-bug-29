<template>
  <div v-if="open" class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <header class="modal-head">
        <strong>{{ title }}</strong>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>
      <div class="modal-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="modal-foot">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ open: boolean; title: string }>()
defineEmits<{ (event: 'close'): void }>()
</script>
