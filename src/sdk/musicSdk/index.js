import kw from './kw/index.js'
import kg from './kg/index.js'
import tx from './tx/index.js'
import wy from './wy/index.js'
import mg from './mg/index.js'
import { supportQuality } from './api-source.js'

const sources = {
  sources: [
    { name: '酷我音乐', id: 'kw' },
    { name: '酷狗音乐', id: 'kg' },
    { name: 'QQ音乐', id: 'tx' },
    { name: '网易音乐', id: 'wy' },
    { name: '咪咕音乐', id: 'mg' },
  ],
  kw,
  kg,
  tx,
  wy,
  mg,
}

export default {
  ...sources,
  supportQuality,
  init() {
    return Promise.resolve()
  },
}
