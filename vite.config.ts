import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig({
  server: {
    port: 7727,
    strictPort: true,
    // '.mini.jkrumm.com' (leading dot = that domain and all subdomains) is the
    // Caddy-fronted tailnet door on the Mac mini — see dotfiles
    // scripts/caddy-tailnet.sh. Without it Vite 403s every request whose Host
    // isn't localhost, and the door looks broken at the proxy rather than here.
    allowedHosts: ['modelpick.test', '.mini.jkrumm.com'],
  },
  resolve: {
    alias: {
      '~': '/src',
    },
  },
  plugins: [
    tanstackStart({
      srcDirectory: 'src',
    }),
    viteReact(),
    nitro(),
  ],
})
