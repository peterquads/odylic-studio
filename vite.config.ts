import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { createReadStream, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Server-side image proxy — bypasses all CORS restrictions
function imageProxyPlugin(): Plugin {
  return {
    name: 'image-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy-image', async (req, res) => {
        const url = new URL(req.url || '', 'http://localhost').searchParams.get('url')
        if (!url) {
          res.statusCode = 400
          res.end('Missing url parameter')
          return
        }

        try {
          // Normalize URL — convert exotic formats to JPEG for broader compatibility
          let fetchUrl = url
          if (fetchUrl.includes('fm=avif')) {
            fetchUrl = fetchUrl.replace(/fm=avif/g, 'fm=jpg')
          }
          // Shopify CDN: strip format=pjpg&v= artifacts; ensure we get a standard format
          if (fetchUrl.includes('cdn.shopify.com') && !fetchUrl.includes('format=')) {
            fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'format=jpg'
          }

          const response = await fetch(fetchUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': '*/*',
            },
            redirect: 'follow',
          })

          if (!response.ok) {
            res.statusCode = response.status
            res.end(`Upstream ${response.status}`)
            return
          }

          const contentType = response.headers.get('content-type') || 'image/png'
          const buffer = Buffer.from(await response.arrayBuffer())

          res.setHeader('Content-Type', contentType)
          res.setHeader('Content-Length', buffer.length)
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.end(buffer)
        } catch (e: any) {
          res.statusCode = 502
          res.end(e.message || 'Proxy fetch failed')
        }
      })
    },
  }
}

// Serve template images from external data directory (~/.odylic-studio/templates/)
// This keeps the 2+ GB of template images out of the project directory
function externalTemplatesPlugin(): Plugin {
  const TEMPLATES_DIR = join(homedir(), '.odylic-studio', 'templates')
  return {
    name: 'external-templates',
    configureServer(server) {
      server.middlewares.use('/templates', (req, res, next) => {
        const filename = decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0])
        if (!filename) return next()

        const filePath = join(TEMPLATES_DIR, filename)
        try {
          const stat = statSync(filePath)
          const ext = filename.split('.').pop()?.toLowerCase()
          const mimeTypes: Record<string, string> = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg',
            png: 'image/png', webp: 'image/webp',
          }
          res.setHeader('Content-Type', mimeTypes[ext || ''] || 'application/octet-stream')
          res.setHeader('Content-Length', stat.size)
          res.setHeader('Cache-Control', 'public, max-age=86400')
          createReadStream(filePath).pipe(res)
        } catch {
          // File not in external dir — fall through to public/ (backwards compatible)
          next()
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), imageProxyPlugin(), externalTemplatesPlugin()],
  server: { port: 3000 },
})
