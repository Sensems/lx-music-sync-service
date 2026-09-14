import musicSearch from './musicSearch.js'
import songList from './songList.js'
import lyric from './lyric.js'
import pic from './pic.js'

export default {
  musicSearch,
  songList,
  getLyric(songInfo) {
    return lyric.getLyric(songInfo)
  },
  getPic(songInfo) {
    return pic.getPic(songInfo)
  },
  getMusicUrl() {
    throw new Error('use userApi')
  },
}