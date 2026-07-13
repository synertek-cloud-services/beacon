<template>
  <div v-if="isLogin" class="login-wrap">
    <RouterView />
  </div>
  <div v-else class="shell">
    <nav class="sidebar" :class="{ 'no-transition': isResizing }" :style="sidebarStyle">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M20.49 3.51a12 12 0 0 1 0 16.97M3.51 20.49a12 12 0 0 1 0-16.97"/>
          </svg>
        </div>
        <span class="sidebar-brand-name">Beacon</span>
      </div>

      <div class="sidebar-nav">

        <!-- DASHBOARDS -->
        <div class="sec-head" @click="toggleSection('dashboards')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sec-icon">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          <span class="sec-label">Dashboards</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sec-chevron" :class="{ open: openSections.dashboards }">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div v-show="openSections.dashboards" class="sec-body">
          <RouterLink to="/" class="sbi" :class="{ active: route.path === '/' }">Default Dashboard</RouterLink>
        </div>

        <!-- COMPANIES -->
        <div class="sec-head" @click="toggleSection('sites')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sec-icon">
            <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
            <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
            <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
            <path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>
          </svg>
          <span class="sec-label">Companies</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sec-chevron" :class="{ open: openSections.sites }">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div v-show="openSections.sites" class="sec-body">
          <RouterLink to="/tenants" class="sbi" :class="{ active: route.path.startsWith('/tenants') }">All Companies</RouterLink>
          <template v-if="activeClientId">
            <div class="client-row">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="client-icon">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span class="client-name">{{ activeClientName }}</span>
              <button class="client-clear" @click="clearActiveClient" title="Clear">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="sbi sbi-leaf"
                 :class="{ active: route.path.startsWith('/devices') && route.query.company === activeClientId }"
                 @click="router.push({ path: '/devices', query: { company: activeClientId } })">
              Devices
            </div>
          </template>
        </div>

        <!-- DEVICES -->
        <div class="sec-head" @click="toggleSection('devices')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sec-icon">
            <rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/>
          </svg>
          <span class="sec-label">Devices</span>
          <span v-if="pendingCount > 0" class="sec-badge">{{ pendingCount }}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sec-chevron" :class="{ open: openSections.devices }">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div v-show="openSections.devices" class="sec-body">
          <RouterLink
            :to="{ path: '/devices', query: { status: 'pending' } }"
            class="sbi"
            :class="{ active: route.path.startsWith('/devices') && route.query.status === 'pending' }"
          >
            Device Approvals
            <span v-if="pendingCount > 0" class="sbi-badge">{{ pendingCount }}</span>
          </RouterLink>
          <RouterLink
            to="/devices"
            class="sbi"
            :class="{ active: route.path.startsWith('/devices') && !route.query.company && route.query.status !== 'pending' }"
          >All</RouterLink>
        </div>

        <!-- GLOBAL -->
        <div class="sec-head" @click="toggleSection('global')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sec-icon">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span class="sec-label">Global</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sec-chevron" :class="{ open: openSections.global }">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div v-show="openSections.global" class="sec-body">
          <RouterLink to="/global/alerts" class="sbi" :class="{ active: route.path === '/global/alerts' }">Alerts</RouterLink>
          <RouterLink to="/global/policies" class="sbi" :class="{ active: route.path === '/global/policies' }">Policies</RouterLink>
        </div>

        <!-- AUTOMATION -->
        <div class="sec-head" @click="toggleSection('automation')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sec-icon">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          <span class="sec-label">Automation</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sec-chevron" :class="{ open: openSections.automation }">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div v-show="openSections.automation" class="sec-body">
          <RouterLink to="/jobs" class="sbi" :class="{ active: route.path.startsWith('/jobs') }">Jobs</RouterLink>
          <RouterLink to="/components" class="sbi" :class="{ active: route.path.startsWith('/components') }">Components</RouterLink>
        </div>

        <!-- SETTINGS (admin only) -->
        <template v-if="hasRole('admin')">
          <div class="sec-head" @click="toggleSection('settings')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sec-icon">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span class="sec-label">Settings</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sec-chevron" :class="{ open: openSections.settings }">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <div v-show="openSections.settings" class="sec-body">
            <RouterLink to="/settings/users" class="sbi" :class="{ active: route.path.startsWith('/settings/users') }">Users</RouterLink>
            <RouterLink to="/settings/sso" class="sbi" :class="{ active: route.path === '/settings/sso' }">Single Sign-On</RouterLink>
          </div>
        </template>

      </div>

      <div class="sidebar-footer">
        <div v-if="authState.user" class="sidebar-user">
          <span class="sidebar-user-name">{{ authState.user.displayName || authState.user.email }}</span>
          <span class="sidebar-user-role">{{ authState.user.role }}</span>
        </div>
        <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:center" @click="logout">Sign out</button>
      </div>

      <div class="sidebar-resizer" @mousedown.prevent="startResize"></div>
    </nav>

    <!-- Main -->
    <div class="main-wrap">
      <div class="topbar">
        <button class="topbar-toggle" @click="toggleSidebar" :title="sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <span class="topbar-title">{{ pageTitle }}</span>
        <div class="topbar-search">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchQuery"
            type="search"
            class="topbar-search-input"
            placeholder="Search devices…"
            @keydown.enter="doSearch"
            @input="scheduleSearch"
          />
        </div>
        <div class="topbar-actions">
          <span class="text-xs text-muted mono">{{ workerUrl }}</span>
        </div>
      </div>
      <main class="page">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Tenant } from './api';
import { authState, hasRole, loadCurrentUser } from './auth';

const route = useRoute();
const router = useRouter();

const isLogin   = computed(() => route.path === '/login' || route.path === '/sso-callback');
const workerUrl = import.meta.env.VITE_API_URL || 'localhost:8787';

const companies      = ref<Tenant[]>([]);
const activeClientId = ref<string | null>(null);

// ── Sidebar resize / collapse ─────────────────────────────────────────────────

const sidebarWidth     = ref(parseInt(localStorage.getItem('beacon-sidebar-w') ?? '220'));
const sidebarCollapsed = ref(localStorage.getItem('beacon-sidebar-collapsed') === 'true');
const isResizing       = ref(false);

const sidebarStyle = computed(() =>
  sidebarCollapsed.value
    ? { width: '0px', minWidth: '0px' }
    : { width: sidebarWidth.value + 'px', minWidth: sidebarWidth.value + 'px' }
);

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem('beacon-sidebar-collapsed', String(sidebarCollapsed.value));
}

let _resizeStartX = 0;
let _resizeStartW = 0;

function startResize(e: MouseEvent) {
  _resizeStartX  = e.clientX;
  _resizeStartW  = sidebarWidth.value;
  isResizing.value = true;
  document.body.classList.add('sidebar-resizing');
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
}

function onResize(e: MouseEvent) {
  sidebarWidth.value = Math.min(400, Math.max(160, _resizeStartW + e.clientX - _resizeStartX));
}

function stopResize() {
  isResizing.value = false;
  document.body.classList.remove('sidebar-resizing');
  localStorage.setItem('beacon-sidebar-w', String(sidebarWidth.value));
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
}
const activeCompany  = computed(() => route.query.company as string | undefined);
const pendingCount   = ref(0);

const activeClientName = computed(() =>
  companies.value.find(c => c.id === activeClientId.value)?.name ?? ''
);

const openSections = ref({ dashboards: true, sites: true, devices: true, global: true, automation: false, settings: false });

const searchQuery = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
  if (api.hasToken()) {
    try {
      const [tenantList, summary] = await Promise.all([api.tenants.list(), api.summary.get()]);
      companies.value = tenantList;
      pendingCount.value = summary.pending;
    } catch {}
    if (!authState.user) await loadCurrentUser().catch(() => {});
  }
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
});

watch(activeCompany, (id) => {
  if (id) activeClientId.value = id;
}, { immediate: true });

watch(() => route.query.search, (s) => {
  searchQuery.value = (s as string) ?? '';
}, { immediate: true });

function clearActiveClient() {
  activeClientId.value = null;
  if (route.query.company) router.push({ path: '/devices' });
}

function toggleSection(key: keyof typeof openSections.value) {
  openSections.value = { ...openSections.value, [key]: !openSections.value[key] };
}

function doSearch() {
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
  const q: Record<string, string> = {};
  if (activeCompany.value) q.company = activeCompany.value;
  if (searchQuery.value.trim()) q.search = searchQuery.value.trim();
  router.push({ path: '/devices', query: q });
}

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 350);
}

const pageTitle = computed(() => {
  if (route.path === '/') return 'Dashboard';
  if (route.path.startsWith('/devices')) return 'Devices';
  if (route.path.startsWith('/tenants')) return 'Companies';
  if (route.path.startsWith('/components')) return 'Component Library';
  if (route.path.startsWith('/jobs')) return 'Jobs';
  if (route.path === '/global/alerts') return 'Global Alerts';
  if (route.path === '/global/policies') return 'Global Policies';
  if (route.path.startsWith('/settings/users')) return 'Users';
  if (route.path === '/settings/sso') return 'Single Sign-On';
  return 'Beacon';
});

async function logout() {
  await api.auth.logout().catch(() => {});
  api.clearToken();
  authState.user = null;
  router.push('/login');
}
</script>

<style scoped>
/* ── Scrollable nav container ── */
.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* ── Section headers ── */
.sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  transition: background .1s;
  flex-shrink: 0;
}
.sec-head:hover { background: var(--surface-2); }
.sec-icon { color: var(--muted); flex-shrink: 0; opacity: .8; }
.sec-label {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--muted);
}
.sec-chevron {
  color: var(--muted);
  flex-shrink: 0;
  transform: rotate(-90deg);
  transition: transform .18s;
}
.sec-chevron.open { transform: rotate(0deg); }
.sec-badge {
  font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 10px;
  background: rgba(240,168,64,.18); color: var(--amber); flex-shrink: 0;
}

/* ── Section body ── */
.sec-body { padding-bottom: 4px; }

/* ── Sidebar items ── */
.sbi {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px 5px 32px;
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
  cursor: pointer;
  border-radius: 5px;
  margin: 1px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-decoration: none;
  transition: background .12s, color .12s;
}
.sbi:hover { background: var(--surface-2); color: var(--text); text-decoration: none; }
.sbi.active { background: rgba(78,126,247,.1); color: var(--accent); font-weight: 500; }

/* ── Active client row ── */
.client-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px 5px 32px; margin: 2px 8px 0;
  border-radius: 5px;
  background: rgba(78,126,247,.08);
  border-left: 2px solid var(--accent);
}
.client-icon { color: var(--accent); flex-shrink: 0; }
.client-name {
  flex: 1; font-size: 12px; font-weight: 600; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.client-clear {
  background: none; border: none; color: var(--muted); cursor: pointer;
  padding: 2px; display: flex; align-items: center; border-radius: 3px; flex-shrink: 0;
  transition: color .1s;
}
.client-clear:hover { color: var(--text); }

/* leaf item under active client */
.sbi-leaf { padding-left: 48px; }

/* pending badge inside an sbi */
.sbi-badge {
  margin-left: auto;
  font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 10px;
  background: rgba(240,168,64,.18); color: var(--amber); flex-shrink: 0;
}

/* ── Sidebar user block ── */
.sidebar-user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px 8px;
  font-size: 12px;
}
.sidebar-user-name {
  color: var(--text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-user-role {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--muted-2);
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: 8px;
}

/* ── Topbar toggle ── */
.topbar-toggle {
  background: none; border: none; cursor: pointer; color: var(--muted);
  padding: 6px; border-radius: 5px; display: flex; align-items: center;
  transition: background .1s, color .1s; flex-shrink: 0; margin-right: 8px;
}
.topbar-toggle:hover { background: var(--surface-2); color: var(--text); }

/* ── Topbar search ── */
.topbar-search {
  flex: 1; max-width: 320px; position: relative; display: flex; align-items: center;
  margin: 0 16px;
}
.search-icon { position: absolute; left: 10px; color: var(--muted); pointer-events: none; }
.topbar-search-input {
  width: 100%; padding: 5px 10px 5px 32px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface-2); color: var(--text); font-size: 12px; font-family: var(--font);
  outline: none; transition: border-color .12s;
}
.topbar-search-input:focus { border-color: var(--accent); background: var(--surface); }
.topbar-search-input::placeholder { color: var(--muted); }
.topbar-search-input::-webkit-search-cancel-button { cursor: pointer; }
</style>
