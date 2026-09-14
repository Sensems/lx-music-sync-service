import musicSearch from './musicSearch.js'
import songList from './songList.js'
import lyric from './lyric.js'

export default {
  musicSearch,
  songList,
  getLyric(songInfo) {
    return lyric.getLyric(songInfo)
  },
  async getPic(songInfo) {
    const albumId = songInfo.albumId || songInfo.albumMid
    if (!albumId || albumId === '空') {
      return ''
    }
    return `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`
  },
  getMusicUrl() {
    throw new Error('use userApi')
  },
}