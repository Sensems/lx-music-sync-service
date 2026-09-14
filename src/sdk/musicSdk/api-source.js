/** Stub: search/playlist do not use UserApi; getMusicUrl goes through userApi runtime. */
export const supportQuality = {}

export const apis = (_source) => {
  throw new Error('use userApi')
}
