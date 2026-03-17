import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { createReadStream, statSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'

// Block private/internal IPs to prevent SSRF attacks
function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr)
    const proto = parsed.protocol
    if (proto !== 'http:' && proto !== 'https:') return true // block file://, ftp://, etc.
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
    // Block private IP ranges
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fc00:|fe80:|fd)/.test(host)) return true
    // Block metadata endpoints (AWS, GCP, Azure)
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return true
    return false
  } catch { return true }
}

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

        // SSRF protection: reject private/internal URLs
        if (isPrivateUrl(url)) {
          res.statusCode = 403
          res.end('Blocked: private or internal URL')
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

          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 15000)
          const response = await fetch(fetchUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': '*/*',
            },
            redirect: 'follow',
            signal: controller.signal,
          })
          clearTimeout(timeout)

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
          res.end('Proxy fetch failed')
        }
      })
    },
  }
}

// Serve template images from external data directory (~/.odylic-studio/templates/)
// This keeps the 2+ GB of template images out of the project directory
function externalTemplatesPlugin(): Plugin {
  const TEMPLATES_DIR = resolve(join(homedir(), '.odylic-studio', 'templates'))
  return {
    name: 'external-templates',
    configureServer(server) {
      server.middlewares.use('/templates', (req, res, next) => {
        const filename = decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0])
        if (!filename) return next()

        // Path traversal protection: ensure resolved path stays within TEMPLATES_DIR
        const filePath = resolve(join(TEMPLATES_DIR, filename))
        if (!filePath.startsWith(TEMPLATES_DIR)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }

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
