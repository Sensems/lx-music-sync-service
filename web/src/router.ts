import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/shelf' },
    { path: '/shelf', name: 'shelf', component: () => import('./views/ShelfView.vue'), meta: { title: '歌单墙' } },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue'), meta: { title: '找歌' } },
    { path: '/tape', name: 'tape', component: () => import('./views/TapeView.vue'), meta: { title: '任务带' } },
    { path: '/cabinet', name: 'cabinet', component: () => import('./views/CabinetView.vue'), meta: { title: '柜门' } },
  ],
})
