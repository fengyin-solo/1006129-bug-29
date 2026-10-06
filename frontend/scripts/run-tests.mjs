// 用 esbuild 把 TS 用例捆成单文件再跑：仓库没引测试框架，esbuild 是现成的。
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const outfile = fileURLToPath(new URL('../node_modules/.cache/settlement-tests.mjs', import.meta.url))

await build({
  entryPoints: [fileURLToPath(new URL('../tests/settlement.test.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  alias: { '@': `${root}/src` },
  logLevel: 'silent',
})

await import(pathToFileURL(outfile).href)
