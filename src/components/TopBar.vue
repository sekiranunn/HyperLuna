<script setup>
const props = defineProps({
  store: {type: Object, required: true},
  tabs: {type: Array, default: () => []}
});

const langs = [
  {code: 'ZH', label: '中'},
  {code: 'EN', label: 'EN'},
  {code: 'JPN', label: 'JP'}
];

function firmwareStamp() {
  const f = props.store.state.features;
  if (!props.store.state.connected) return 'LUNA33';
  if (f.implementationRevision) return `R${f.implementationRevision}`;
  return f.name || 'LUNA33';
}
</script>

<template>
  <header class="masthead">
    <div class="mast-left">
      <span class="mast-title brand">HYPERLUNA</span>
      <span class="mast-rev tabular">{{ firmwareStamp() }}</span>
    </div>

    <div class="mast-right">
      <nav
        v-if="store.state.connected && tabs.length"
        class="tab-strip"
        role="tablist"
        :aria-label="store.t('功能分区')"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="store.state.tab === tab.id"
          :disabled="store.state.busy"
          :class="['tab-btn', {active: store.state.tab === tab.id}]"
          @click="store.state.tab = tab.id"
        >
          <span class="tab-num tabular">{{ tab.num }}</span>
          <span>{{ store.t(tab.label) }}</span>
        </button>
      </nav>
      <div v-else class="mast-spacer"></div>

      <div class="mast-tools">
        <template v-if="store.state.connected">
          <div class="slot-strip tabular" role="group" :aria-label="store.t('鼠标配置')">
            <span class="slot-lbl">PROFILE</span>
            <button
              v-for="n in 4"
              :key="n"
              type="button"
              :disabled="store.state.busy"
              :title="store.t('配置 ' + n) + (store.state.base.active === n ? ' · ' + store.t('当前') : '')"
              :class="['slot-btn', {active: store.state.slot === n, hw: store.state.base.active === n}]"
              @click="store.changeSlot(n)"
            >0{{ n }}</button>
          </div>

          <div class="tool-icons">
            <button
              class="sbtn sbtn-icon"
              type="button"
              :disabled="store.state.busy"
              :title="store.t('重新读取')"
              :aria-label="store.t('重新读取')"
              @click="store.readConfig"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            </button>

            <button
              class="sbtn sbtn-icon"
              type="button"
              :disabled="store.state.busy"
              :title="store.t('断开连接')"
              :aria-label="store.t('断开连接')"
              @click="store.disconnect"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
                <path d="M9 21H4V3h5" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>

          <span class="v-rule" aria-hidden="true"></span>
        </template>

        <div class="lang-strip" role="group" :aria-label="store.t('切换语言')">
          <button
            v-for="item in langs"
            :key="item.code"
            type="button"
            :class="['lang-btn', {active: store.state.language === item.code}]"
            @click="store.languageChanged(item.code)"
          >{{ item.label }}</button>
        </div>

        <button
          class="theme-btn"
          type="button"
          :title="store.t(store.state.theme === 'dark' ? '切换浅色主题' : '切换深色主题')"
          :aria-label="store.t(store.state.theme === 'dark' ? '切换浅色主题' : '切换深色主题')"
          @click="store.toggleTheme"
        >{{ store.state.theme === 'dark' ? 'PAPER' : 'DARK' }}</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.masthead {
  position: sticky;
  top: 0;
  z-index: 40;
  height: 52px;
  display: grid;
  grid-template-columns: 348px minmax(0, 1fr);
  background: var(--paper);
  border-bottom: 2px solid var(--rule-anchor);
}

.mast-left {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 28px;
  border-right: 1px solid var(--rule);
  min-width: 0;
}

.mast-title {
  font-size: 14px;
  letter-spacing: 0.16em;
  color: var(--ink);
  white-space: nowrap;
}

.mast-rev {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ink-3);
  white-space: nowrap;
}

.mast-right {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 28px;
  min-width: 0;
}

.mast-spacer {
  flex: 1;
}

.tab-strip {
  display: flex;
  align-items: stretch;
  gap: 28px;
  height: 100%;
  flex-shrink: 0;
}

.tab-btn {
  position: relative;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-3);
  white-space: nowrap;
  transition: color 0.12s ease;
}

.tab-btn:hover:not(:disabled) {
  color: var(--ink);
}

.tab-btn.active {
  color: var(--ink);
  font-weight: 700;
}

.tab-btn.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 3px;
  background: var(--cobalt);
}

.tab-num {
  font-size: 10px;
  font-weight: 700;
  color: var(--ink-4);
}

.tab-btn.active .tab-num {
  color: var(--cobalt);
}

.mast-tools {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.slot-strip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.slot-lbl {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  margin-right: 6px;
}

.slot-btn {
  position: relative;
  width: 26px;
  height: 24px;
  border: 0;
  background: transparent;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-3);
  transition: background-color 0.12s ease, color 0.12s ease;
}

.slot-btn:hover:not(:disabled) {
  background: var(--paper-tint);
  color: var(--ink);
}

.slot-btn.active {
  background: var(--cobalt);
  color: #ffffff;
}

.slot-btn.hw:not(.active)::after {
  content: "";
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 1px;
  height: 2px;
  background: var(--cobalt);
}

.tool-icons {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.v-rule {
  width: 1px;
  height: 16px;
  background: var(--rule);
}

.lang-strip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.lang-btn {
  border: 0;
  background: transparent;
  padding: 2px 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
}

.lang-btn:hover {
  color: var(--ink);
}

.lang-btn.active {
  color: var(--ink);
  border-bottom: 1.5px solid var(--cobalt);
}

.theme-btn {
  height: 24px;
  padding: 0 7px;
  border: 0;
  border-bottom: 1.5px solid var(--rule-anchor);
  background: transparent;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ink);
  white-space: nowrap;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.theme-btn:hover {
  background: var(--inv-bg);
  color: var(--inv-ink);
}

@media (max-width: 1120px) {
  .masthead {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .mast-left {
    padding: 0 18px;
  }
  .mast-right {
    padding: 0 18px;
  }
  .slot-lbl {
    display: none;
  }
}

@media (max-width: 860px) {
  .masthead {
    height: auto;
    grid-template-columns: 1fr;
  }
  .mast-left {
    height: 44px;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
  .mast-right {
    flex-wrap: wrap;
    padding: 8px 18px;
    gap: 10px;
  }
  .tab-strip {
    height: 36px;
    gap: 18px;
  }
}
</style>
