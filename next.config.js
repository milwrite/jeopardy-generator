/** @type {import('next').NextConfig} */

// GitHub Pages serves this repo as a project page under /jeopardy-generator,
// so the Pages build (GITHUB_PAGES=true, set in .github/workflows/deploy.yml)
// needs the base path; every other build stays rooted at /.
const githubPages = process.env.GITHUB_PAGES === 'true'

const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  ...(githubPages
    ? {
        basePath: '/jeopardy-generator',
        assetPrefix: '/jeopardy-generator/',
      }
    : {}),
}

module.exports = nextConfig
