import type { MusicInfo } from '../types.js'

export const toNewMusicInfo = (oldMusicInfo: any): MusicInfo => {
  const meta: Record<string, unknown> = {
    songId: oldMusicInfo.songmid,
    albumName: oldMusicInfo.albumName,
    picUrl: oldMusicInfo.img,
  }
  const newInfo: MusicInfo = {
    id: `${oldMusicInfo.source}_${oldMusicInfo.songmid}`,
    name: oldMusicInfo.name,
    singer: oldMusicInfo.singer,
    source: oldMusicInfo.source,
    interval: oldMusicInfo.interval,
    meta,
  }

  if (oldMusicInfo.source == 'local') {
    meta.filePath = oldMusicInfo.filePath ?? oldMusicInfo.songmid ?? ''
    meta.ext = oldMusicInfo.ext ?? /\.(\w+)$/.exec(String(meta.filePath))?.[1] ?? ''
  } else {
    meta.qualitys = oldMusicInfo.types
    meta._qualitys = oldMusicInfo._types
    meta.albumId = oldMusicInfo.albumId
    const _qualitys = meta._qualitys as Record<string, unknown>
    if (_qualitys.flac32bit && !_qualitys.flac24bit) {
      _qualitys.flac24bit = _qualitys.flac32bit
      delete _qualitys.flac32bit

      meta.qualitys = (meta.qualitys as { type: string }[]).map(quality => {
        if (quality.type == 'flac32bit') quality.type = 'flac24bit'
        return quality
      })
    }

    switch (oldMusicInfo.source) {
      case 'kg':
        meta.hash = oldMusicInfo.hash
        meta.albumAudioId = oldMusicInfo.albumAudioId
        newInfo.id = oldMusicInfo.songmid + '_' + oldMusicInfo.hash
        break
      case 'tx':
        meta.strMediaMid = oldMusicInfo.strMediaMid
        meta.id = oldMusicInfo.songId
        meta.albumMid = oldMusicInfo.albumMid
        break
      case 'mg':
        meta.copyrightId = oldMusicInfo.copyrightId
        meta.lrcUrl = oldMusicInfo.lrcUrl
        meta.mrcUrl = oldMusicInfo.mrcUrl
        meta.trcUrl = oldMusicInfo.trcUrl
        break
    }
  }

  return newInfo
}
