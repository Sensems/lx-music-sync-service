import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/shelf' },
    { path: '/shelf', name: 'shelf', component: () => import('./views/ShelfView.vue'), meta: { title: '歌单' } },
    { path: '/wall', name: 'wall', component: () => import('./views/WallView.vue'), meta: { title: '唱片墙' } },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue'), meta: { title: '搜索' } },
    { path: '/tape', name: 'tape', component: () => import('./views/TapeView.vue'), meta: { title: '任务' } },
    { path: '/cabinet', name: 'cabinet', component: () => import('./views/CabinetView.vue'), meta: { title: '设置' } },
  ],
})
