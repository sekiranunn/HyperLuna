<script setup>
defineProps({
  store: {type: Object, required: true}
});
</script>

<template>
  <div
    v-if="store.state.reviewVisible"
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="store.t(store.state.reviewTitle)"
  >
    <div class="modal-card">
      <div class="modal-head">
        <span class="idx-label"><em>CONFIRM</em>PAW3950 WRITE</span>
        <h3 class="modal-title">{{ store.t(store.state.reviewTitle) }}</h3>
        <p class="modal-desc">{{ store.t(store.state.reviewDescription) }}</p>
      </div>

      <table class="modal-table">
        <thead>
          <tr>
            <th>{{ store.t('项目') }}</th>
            <th>{{ store.t('当前值') }}</th>
            <th>{{ store.t('写入值') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in store.state.reviewRows" :key="i">
            <td class="mono">{{ store.t(row.name) }}</td>
            <td class="mono muted">{{ store.t(row.before) }}</td>
            <td class="mono accent">{{ store.t(row.after) }}</td>
          </tr>
        </tbody>
      </table>

      <div class="modal-actions">
        <button class="sbtn-rule" type="button" :disabled="store.state.busy" @click="store.cancelReview">
          {{ store.t('取消') }}
        </button>
        <button class="sbtn sbtn-cobalt" type="button" :disabled="store.state.busy" @click="store.confirmReview">
          {{ store.t('确认写入') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: var(--paper-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-card {
  width: 100%;
  max-width: 460px;
  padding: 24px 28px;
  background: var(--paper-elev);
  border: 1px solid var(--rule-strong);
  border-top: 3px solid var(--cobalt);
}

.modal-head {
  margin-bottom: 18px;
}

.modal-title {
  margin: 8px 0 4px;
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
}

.modal-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-2);
}

.modal-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  margin-bottom: 22px;
  border-top: 1.5px solid var(--rule-strong);
  border-bottom: 1px solid var(--rule);
}

.modal-table th {
  text-align: left;
  padding: 8px 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  border-bottom: 1px solid var(--rule);
}

.modal-table td {
  padding: 10px 0;
  color: var(--ink);
  font-weight: 600;
}

.muted {
  color: var(--ink-3);
}

.accent {
  color: var(--cobalt);
  font-weight: 700;
}

.modal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}
</style>
