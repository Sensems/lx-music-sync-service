import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import 'virtual:uno.css'
import './styles/base.css'
import App from './App.vue'
import router from './router'

createApp(App).use(router).use(Antd).mount('#app')
