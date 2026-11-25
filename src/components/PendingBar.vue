<script setup>
import {computed} from 'vue';

const props = defineProps({
  store: {type: Object, required: true}
});

const needsRetrySave = computed(() => (
  props.store.state.runtime?.save === 3 && props.store.state.runtime.attempts >= 3
));

const visible = computed(() => (
  props.store.state.connected && (props.store.dirty.value || needsRetrySave.value)
));
</script>

<template>
  <transition name="slide-up">
    <div v-if="visible" class="pending-dock" role="region" :aria-label="store.t('待应用更改')">
      <div class="pending-shell">
        <div v-if="store.state.diffExpanded && store.pendingChanges.value.rows.length" class="diff-drawer">
          <div class="diff-head">
            <span>{{ store.t('待写入变更明细') }}</span>
            <span class="tabular muted">{{ store.t('配置 ' + store.state.slot) }}</span>
          </div>
          <div class="diff-list">
            <div v-for="(row, i) in store.pendingChanges.value.rows" :key="i" class="diff-row">
              <span class="diff-name">{{ store.t(row.name) }}</span>
              <span class="diff-vals tabular">
                <span class="diff-before">{{ store.t(row.before) }}</span>
                <span class="diff-arrow">→</span>
                <span class="diff-after">{{ store.t(row.after) }}</span>
              </span>
            </div>
          </div>
        </div>

        <div class="pending-bar">
          <div class="pending-status">
            <span :class="['sq-mark', store.pendingChanges.value.error || needsRetrySave ? 'danger' : 'cobalt']"></span>
            <span v-if="store.pendingChanges.value.error" class="pending-error">
              {{ store.t(store.pendingChanges.value.error) }}
            </span>
            <span v-else-if="needsRetrySave && !store.pendingChanges.value.rows.length" class="pending-error">
              {{ store.t('保存失败，当前参数尚未写入存储；请重试保存') }}
            </span>
            <span v-else class="pending-text">
              {{ store.t('有 {count} 项未应用的更改', {count: store.pendingChanges.value.rows.length}) }}
            </span>

            <button
              v-if="store.pendingChanges.value.rows.length"
              class="sbtn-rule diff-toggle"
              type="button"
              @click="store.state.diffExpanded = !store.state.diffExpanded"
            >
              {{ store.t(store.state.diffExpanded ? '收起明细' : '核对明细') }}
            </button>
          </div>

          <div class="pending-actions">
            <button
              v-if="needsRetrySave"
              class="sbtn sbtn-sm sbtn-danger"
              type="button"
              :disabled="store.state.busy"
              @click="store.retrySave"
            >{{ store.t('重试保存') }}</button>

            <button
              v-if="store.dirty.value"
              class="sbtn-rule discard-btn"
              type="button"
              :disabled="store.state.busy"
              @click="store.discardChanges"
            >{{ store.t('放弃更改') }}</button>

            <button
              v-if="store.pendingChanges.value.rows.length"
              class="sbtn sbtn-sm sbtn-cobalt"
              type="button"
              :disabled="store.state.busy || Boolean(store.pendingChanges.value.error)"
              @click="store.applyPendingChanges"
            >
              {{ store.state.saving ? store.t('正在保存…') : store.t('应用并保存') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.pending-dock {
  width: 100%;
  pointer-events: none;
}

.pending-shell {
  pointer-events: auto;
  background: var(--paper-elev);
  border-top: 2px solid var(--cobalt);
}

.diff-drawer {
  max-height: 220px;
  overflow-y: auto;
  padding: 14px 28px;
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
}

.diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  margin-bottom: 10px;
}

.muted {
  color: var(--ink-3);
}

.diff-list {
  display: flex;
  flex-direction: column;
}

.diff-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  border-top: 1px solid var(--rule);
  font-size: 12.5px;
}

.diff-name {
  color: var(--ink);
  font-weight: 600;
}

.diff-vals {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.diff-before,
.diff-arrow {
  color: var(--ink-3);
}

.diff-after {
  color: var(--cobalt);
  font-weight: 700;
}

.pending-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 28px;
  flex-wrap: wrap;
}

.pending-status {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.pending-text {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
}

.pending-error {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--danger);
}

.pending-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: opacity 0.14s ease, transform 0.16s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
