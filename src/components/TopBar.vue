<script setup>
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';

const props = defineProps({
  store: {type: Object, required: true},
  tabs: {type: Array, default: () => []}
});

const langs = [
  {code: 'ZH', label: '中'},
  {code: 'EN', label: 'EN'},
  {code: 'JPN', label: 'JP'}
];

const menuOpen = ref(false);
const menuHost = ref(null);
const profileFileInput = ref(null);

const otherSlots = computed(() => [1, 2, 3, 4].filter(n => n !== props.store.state.slot));

function firmwareStamp() {
  const f = props.store.state.features;
  if (!props.store.state.connected) return 'LUNA33';
  if (f.implementationRevision) return `R${f.implementationRevision}`;
  return f.name || 'LUNA33';
}

function closeMenu() {
  menuOpen.value = false;
}

function toggleMenu() {
  if (props.store.state.busy) return;
  menuOpen.value = !menuOpen.value;
}

function onDocClick(event) {
  if (menuOpen.value && menuHost.value && !menuHost.value.contains(event.target)) {
    menuOpen.value = false;
  }
}

function onKeyDown(event) {
  if (event.key === 'Escape' && menuOpen.value) menuOpen.value = false;
}

function copyTo(targets) {
  closeMenu();
  props.store.prepareCopySlot(targets);
}

function exportProfiles() {
  closeMenu();
  props.store.exportAllProfiles();
}

function triggerProfileImport() {
  closeMenu();
  profileFileInput.value?.click();
}

function onProfileFileChange(event) {
  props.store.prepareImportProfiles(event);
}

watch(() => props.store.state.connected, conn => {
  if (!conn) menuOpen.value = false;
});

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeyDown);
});
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
          <div ref="menuHost" class="profile-wrap">
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
              <button
                type="button"
                :class="['slot-btn', 'slot-mgr-btn', {open: menuOpen}]"
                :disabled="store.state.busy"
                :aria-expanded="menuOpen"
                :title="store.t('配置槽复制与备份')"
                :aria-label="store.t('配置槽复制与备份')"
                @click.stop="toggleMenu"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </button>
            </div>

            <div v-if="menuOpen" class="profile-pop" role="menu" :aria-label="store.t('配置槽复制与备份')">
              <div class="pop-sec">
                <div class="pop-kicker tabular">{{ store.t('复制配置 {slot} 到', {slot: store.state.slot}) }}</div>
                <div class="pop-copy-row tabular">
                  <button
                    v-for="n in otherSlots"
                    :key="n"
                    type="button"
                    class="pop-slot-btn"
                    :disabled="store.state.busy || store.dirty.value"
                    @click="copyTo([n])"
                  >0{{ n }}</button>
                  <button
                    type="button"
                    class="pop-slot-btn pop-all"
                    :disabled="store.state.busy || store.dirty.value"
                    @click="copyTo(otherSlots)"
                  >{{ store.t('其余全部') }}</button>
                </div>
              </div>

              <div class="pop-sec pop-io">
                <div class="pop-kicker tabular">1–4 SLOTS JSON</div>
                <div class="pop-io-row">
                  <button
                    type="button"
                    class="pop-act-btn"
                    :disabled="store.state.busy || store.dirty.value"
                    @click="exportProfiles"
                  >{{ store.t('导出全部 4 槽') }}</button>
                  <button
                    type="button"
                    class="pop-act-btn"
                    :disabled="store.state.busy || store.dirty.value"
                    @click="triggerProfileImport"
                  >{{ store.t('导入配置备份') }}</button>
                </div>
              </div>

              <div v-if="store.dirty.value" class="pop-hint">
                {{ store.t('请先应用或放弃当前未保存更改') }}
              </div>
            </div>

            <input ref="profileFileInput" type="file" accept=".json" hidden @change="onProfileFileChange" />
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

.profile-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.slot-strip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.slot-mgr-btn {
  margin-left: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--rule);
  padding-left: 4px;
  width: 28px;
}

.slot-mgr-btn.open {
  background: var(--inv-bg);
  color: var(--inv-ink);
}

.profile-pop {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 60;
  width: 248px;
  background: var(--paper-elev);
  border: 1px solid var(--rule-strong);
  border-top: 2px solid var(--cobalt);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pop-sec {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.pop-io {
  padding-top: 10px;
  border-top: 1px solid var(--rule);
}

.pop-kicker {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}

.pop-copy-row {
  display: grid;
  grid-template-columns: repeat(3, 34px) 1fr;
  gap: 4px;
}

.pop-slot-btn {
  height: 26px;
  border: 1px solid var(--rule-strong);
  background: transparent;
  font-size: 11px;
  font-weight: 700;
  color: var(--ink);
  transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
}

.pop-slot-btn:hover:not(:disabled) {
  border-color: var(--cobalt);
  background: var(--cobalt);
  color: #ffffff;
}

.pop-slot-btn.pop-all {
  font-size: 10.5px;
}

.pop-io-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.pop-act-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--rule-strong);
  background: transparent;
  text-align: left;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink);
  transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
}

.pop-act-btn:hover:not(:disabled) {
  border-color: var(--cobalt);
  background: var(--cobalt-soft);
  color: var(--cobalt);
}

.pop-hint {
  font-size: 10.5px;
  color: var(--danger);
  padding-top: 6px;
  border-top: 1px solid var(--rule);
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
