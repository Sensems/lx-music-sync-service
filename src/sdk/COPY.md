# musicSdk copy notes (Task 5)

Source: `D:\lbs\demo\lx-music-desktop\src\renderer\utils\musicSdk\`

Copied (search + songList detail deps):

- `options.js`, rewritten `utils.js`, stub `api-source.js`, slim `index.js`
- Per source `kw|kg|tx|wy|mg`: slim `index.js` (musicSearch + songList + getMusicUrl throw)
- `kw`: musicSearch, songList, util, album
- `kg`: musicSearch, songList, util, musicInfo, vendors/infSign.min.js
- `tx`: musicSearch, songList, utils/{index,crypto}
- `wy`: musicSearch, songList, musicDetail, musicInfo, utils/{index,crypto}
- `mg`: musicSearch, songList, musicInfo, utils/index

Not copied: leaderboard, lyric, comment, tipSearch, hotSearch, pic, bd/xm, UserApi window.

Import rewrites:

- `../../request` / `../../../request` → `src/sdk/request.ts`
- `../../index` / `@renderer/utils` helpers → `src/sdk/common.ts`
- `@renderer/utils/musicSdk/kg/vendors/infSign.min` → relative vendor path
