<script setup>
import {ref} from 'vue';

defineProps({
  store: {type: Object, required: true}
});

const fileInput = ref(null);
function triggerImport() {
  fileInput.value?.click();
}
</script>

<template>
  <section class="swiss-reg">
    <div class="reg-head">
      <div class="reg-title-col">
        <span class="idx-label"><em>05</em>PAW3950</span>
        <div class="reg-title-row">
          <h2 class="reg-heading">{{ store.t('PAW3950 寄存器') }}</h2>
          <span class="reg-count tabular">{{ store.t('{count} 项寄存器', {count: store.state.registerRows.length}) }}</span>
        </div>
      </div>

      <div class="reg-actions">
        <button class="sbtn sbtn-cobalt sbtn-sm" type="button" :disabled="store.state.busy" @click="store.readRegisters">
          {{ store.t('读取观察列表') }}
        </button>
        <button
          class="sbtn sbtn-sm"
          type="button"
          :disabled="store.state.busy || !store.state.registerRows.some(r => r.value !== null)"
          @click="store.setBaseline"
        >
          {{ store.t('设为对比基线') }}
        </button>
        <button class="sbtn-rule" type="button" @click="store.exportSnapshot">
          {{ store.t('导出快照') }}
        </button>
        <button class="sbtn-rule" type="button" @click="triggerImport">
          {{ store.t('导入对比') }}
        </button>
        <input ref="fileInput" type="file" accept=".json" hidden @change="store.importSnapshot" />
      </div>
    </div>

    <div class="addr-strip">
      <label class="addr-field">
        <span class="idx-label">{{ store.t('页 HEX') }}</span>
        <input v-model="store.state.pageHex" class="sinput mono hex-box" maxlength="4" :disabled="store.state.busy" />
      </label>
      <label class="addr-field">
        <span class="idx-label">{{ store.t('地址 HEX') }}</span>
        <input v-model="store.state.addressHex" class="sinput mono hex-box" maxlength="4" :disabled="store.state.busy" />
      </label>
      <button class="sbtn sbtn-sm" type="button" :disabled="store.state.busy" @click="store.readOne">
        {{ store.t('读取地址') }}
      </button>
    </div>

    <div class="table-wrap">
      <table class="reg-table">
        <thead>
          <tr>
            <th>{{ store.t('页 : 地址') }}</th>
            <th>{{ store.t('用途') }}</th>
            <th>{{ store.t('基线') }}</th>
            <th>{{ store.t('当前回读') }}</th>
            <th>{{ store.t('写入值 HEX') }}</th>
            <th class="col-act">{{ store.t('操作') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in store.state.registerRows"
            :key="row.key"
            :class="{changed: row.value !== null && row.baseline !== null && row.value !== row.baseline}"
          >
            <td class="mono key-cell">{{ row.key }}</td>
            <td class="purpose-cell">{{ store.t(row.label) }}</td>
            <td class="mono muted">{{ row.baseline === null ? '—' : store.byte(row.baseline) }}</td>
            <td class="mono val-cell">{{ row.value === null ? '—' : store.byte(row.value) }}</td>
            <td>
              <input
                v-model="row.input"
                class="sinput mono row-hex"
                maxlength="4"
                :disabled="store.state.busy"
                :aria-label="`${row.key} HEX`"
              />
            </td>
            <td class="col-act">
              <button
                class="act-link"
                type="button"
                :disabled="store.state.busy"
                @click="store.reviewRegister(row, false)"
              >{{ store.t('写入') }}</button>
              <button
                class="act-undo"
                type="button"
                :disabled="store.state.busy || row.undo === null"
                @click="store.reviewRegister(row, true)"
              >{{ store.t('撤回') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.swiss-reg {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-bottom: 72px;
}

.reg-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--rule);
}

.reg-title-row {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-top: 6px;
}

.reg-heading {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--ink);
}

.reg-count {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-3);
}

.reg-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.addr-strip {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  padding: 12px 28px;
  border-bottom: 1px solid var(--rule);
  background: var(--paper-tint);
}

.addr-field {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.hex-box {
  width: 60px;
  height: 28px;
  text-transform: uppercase;
}

.table-wrap {
  overflow-x: auto;
}

.reg-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.reg-table th {
  text-align: left;
  padding: 10px 28px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  border-bottom: 1.5px solid var(--rule-strong);
  white-space: nowrap;
}

.reg-table td {
  padding: 8px 28px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink);
  vertical-align: middle;
}

.reg-table tbody tr:hover td {
  background: var(--paper-tint);
}

.reg-table tbody tr.changed td {
  background: var(--cobalt-soft);
}

.key-cell,
.val-cell {
  font-weight: 700;
}

.purpose-cell {
  color: var(--ink-2);
}

.muted {
  color: var(--ink-3);
}

.row-hex {
  width: 64px;
  height: 26px;
  font-size: 12px;
  text-transform: uppercase;
}

.reg-table th.col-act,
.col-act {
  white-space: nowrap;
  text-align: right;
}

.act-link,
.act-undo {
  border: 0;
  background: transparent;
  padding: 2px 6px;
  font-size: 12px;
  font-weight: 600;
}

.act-link {
  color: var(--cobalt);
  border-bottom: 1.5px solid var(--cobalt);
  margin-right: 10px;
}

.act-link:hover:not(:disabled) {
  background: var(--cobalt);
  color: #ffffff;
}

.act-undo {
  color: var(--ink-3);
}

.act-undo:hover:not(:disabled) {
  color: var(--ink);
  background: var(--paper-tint);
}
</style>
