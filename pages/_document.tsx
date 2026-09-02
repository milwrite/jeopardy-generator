import { Html, Head, Main, NextScript } from 'next/document'

// basePath applies only to Next's own assets, not hand-written head links, so
// the Pages build (GITHUB_PAGES=true, inlined at export time) prefixes here too.
const prefix = process.env.GITHUB_PAGES === 'true' ? '/jeopardy-generator' : ''

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <title>Jeopardy! Generator</title>
        <link rel="icon" href={`${prefix}/favicon.png`} type="image/png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}