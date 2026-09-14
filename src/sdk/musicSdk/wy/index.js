import musicSearch from './musicSearch.js'
import songList from './songList.js'
import getLyric from './lyric.js'
import getMusicInfo from './musicInfo.js'

export default {
  musicSearch,
  songList,
  getLyric(songInfo) {
    return getLyric(songInfo.songmid)
  },
  getPic(songInfo) {
    const requestObj = getMusicInfo(songInfo.songmid)
    return requestObj.promise.then(info => info.al.picUrl)
  },
  getMusicUrl() {
    throw new Error('use userApi')
  },
}