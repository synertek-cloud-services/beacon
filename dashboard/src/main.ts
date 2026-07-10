import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import LoginPage from './pages/LoginPage.vue';
import OverviewPage from './pages/OverviewPage.vue';
import DevicesPage from './pages/DevicesPage.vue';
import './style.css';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: OverviewPage },
    { path: '/login', component: LoginPage },
    { path: '/devices', component: DevicesPage },
  ],
});

router.beforeEach((to) => {
  const hasSecret = !!localStorage.getItem('beacon_secret');
  if (to.path !== '/login' && !hasSecret) return '/login';
});

createApp(App).use(router).mount('#app');
