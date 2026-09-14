import { describe, expect, it } from 'vitest'
import { parseScriptInfo } from '../src/userApi/parseScript'

describe('parseScriptInfo', () => {
  it('reads @name and @version', () => {
    const info = parseScriptInfo('/*\n * @name demo\n * @version 1.0.0\n */\n')
    expect(info.name).toBe('demo')
    expect(info.version).toBe('1.0.0')
  })
  it('rejects missing header', () => {
    expect(() => parseScriptInfo('lx.send("inited")')).toThrow('无效的自定义源文件')
  })
})
