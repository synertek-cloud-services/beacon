import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import LoginPage from './pages/LoginPage.vue';
import SsoCallbackPage from './pages/SsoCallbackPage.vue';
import OverviewPage from './pages/OverviewPage.vue';
import DevicesPage from './pages/DevicesPage.vue';
import DeviceDetailPage from './pages/DeviceDetailPage.vue';
import DeviceChangeLogPage from './pages/DeviceChangeLogPage.vue';
import TenantsPage from './pages/TenantsPage.vue';
import JobsPage from './pages/JobsPage.vue';
import JobFormPage from './pages/JobFormPage.vue';
import JobDetailPage from './pages/JobDetailPage.vue';
import ComponentsPage from './pages/ComponentsPage.vue';
import ComponentFormPage from './pages/ComponentFormPage.vue';
import GlobalAlertsPage from './pages/GlobalAlertsPage.vue';
import AlertDetailPage from './pages/AlertDetailPage.vue';
import GlobalPoliciesPage from './pages/GlobalPoliciesPage.vue';
import PolicyFormPage from './pages/PolicyFormPage.vue';
import UsersPage from './pages/UsersPage.vue';
import UserFormPage from './pages/UserFormPage.vue';
import SsoSettingsPage from './pages/SsoSettingsPage.vue';
import CustomFieldsSettingsPage from './pages/CustomFieldsSettingsPage.vue';
import GroupsPage from './pages/GroupsPage.vue';
import GroupFormPage from './pages/GroupFormPage.vue';
import { api } from './api';
import { authState, hasRole, loadCurrentUser } from './auth';
import type { Role } from './api';
import './style.css';

declare module 'vue-router' {
  interface RouteMeta {
    minRole?: Role;
  }
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: OverviewPage },
    { path: '/login', component: LoginPage },
    { path: '/sso-callback', component: SsoCallbackPage },
    { path: '/devices', component: DevicesPage },
    { path: '/devices/:id', component: DeviceDetailPage },
    { path: '/devices/:id/change-log', component: DeviceChangeLogPage },
    { path: '/groups', component: GroupsPage },
    { path: '/groups/new', component: GroupFormPage },
    { path: '/groups/:id', component: GroupFormPage },
    { path: '/tenants', component: TenantsPage },
    { path: '/jobs', component: JobsPage },
    { path: '/jobs/new', component: JobFormPage },
    { path: '/jobs/:id', component: JobDetailPage },
    { path: '/components', component: ComponentsPage },
    { path: '/components/new', component: ComponentFormPage },
    { path: '/components/:id', component: ComponentFormPage },
    { path: '/global/alerts', component: GlobalAlertsPage },
    { path: '/global/alerts/:id', component: AlertDetailPage },
    { path: '/global/policies', component: GlobalPoliciesPage },
    { path: '/global/policies/new', component: PolicyFormPage },
    { path: '/global/policies/:id', component: PolicyFormPage },
    { path: '/settings/users', component: UsersPage, meta: { minRole: 'admin' } },
    { path: '/settings/users/new', component: UserFormPage, meta: { minRole: 'admin' } },
    { path: '/settings/users/:id', component: UserFormPage, meta: { minRole: 'admin' } },
    { path: '/settings/sso', component: SsoSettingsPage, meta: { minRole: 'admin' } },
    { path: '/settings/custom-fields', component: CustomFieldsSettingsPage, meta: { minRole: 'admin' } },
  ],
});

router.beforeEach(async (to) => {
  const publicPaths = ['/login', '/sso-callback'];
  if (publicPaths.includes(to.path)) return;
  if (!api.hasToken()) return '/login';

  if (to.meta.minRole) {
    if (!authState.user) await loadCurrentUser().catch(() => {});
    if (!hasRole(to.meta.minRole)) return '/';
  }
});

createApp(App).use(router).mount('#app');
