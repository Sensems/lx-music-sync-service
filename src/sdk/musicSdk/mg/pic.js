import { getMusicInfo } from './musicInfo.js'

export default {
  async getPic(songInfo) {
    // Search results often already carry img; detail API needs copyrightId.
    if (songInfo.img) return songInfo.img
    const id = songInfo.copyrightId || songInfo.songmid
    if (!id) return null
    const info = await getMusicInfo(id)
    return info?.img || null
  },
}
