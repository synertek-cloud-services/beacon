import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import LoginPage from './pages/LoginPage.vue';
import OverviewPage from './pages/OverviewPage.vue';
import DevicesPage from './pages/DevicesPage.vue';
import TenantsPage from './pages/TenantsPage.vue';
import JobsPage from './pages/JobsPage.vue';
import ComponentsPage from './pages/ComponentsPage.vue';
import GlobalAlertsPage from './pages/GlobalAlertsPage.vue';
import GlobalPoliciesPage from './pages/GlobalPoliciesPage.vue';
import PolicyFormPage from './pages/PolicyFormPage.vue';
import './style.css';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: OverviewPage },
    { path: '/login', component: LoginPage },
    { path: '/devices', component: DevicesPage },
    { path: '/tenants', component: TenantsPage },
    { path: '/jobs', component: JobsPage },
    { path: '/components', component: ComponentsPage },
    { path: '/global/alerts', component: GlobalAlertsPage },
    { path: '/global/policies', component: GlobalPoliciesPage },
    { path: '/global/policies/new', component: PolicyFormPage },
    { path: '/global/policies/:id', component: PolicyFormPage },
  ],
});

router.beforeEach((to) => {
  const hasSecret = !!localStorage.getItem('beacon_secret');
  if (to.path !== '/login' && !hasSecret) return '/login';
});

createApp(App).use(router).mount('#app');
