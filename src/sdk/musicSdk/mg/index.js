import musicSearch from './musicSearch.js'
import songList from './songList.js'

export default {
  musicSearch,
  songList,
  getMusicUrl() {
    throw new Error('use userApi')
  },
}
