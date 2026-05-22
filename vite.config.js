import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Pusher from 'pusher'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'pusher-auth',
      configureServer(server) {
        server.middlewares.use('/api/pusher/auth', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          const body = await new Promise((resolve) => {
            let data = ''
            req.on('data', chunk => data += chunk)
            req.on('end', () => resolve(JSON.parse(data)))
          })

          const { socket_id, channel_name, user_id, user_info } = body

          if (!socket_id || !channel_name) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Missing socket_id or channel_name' }))
            return
          }

          const pusher = new Pusher({
            appId: process.env.PUSHER_APP_ID,
            key: process.env.PUSHER_KEY,
            secret: process.env.PUSHER_SECRET,
            cluster: process.env.PUSHER_CLUSTER || 'us2',
            useTLS: true,
          })

          const channelData = JSON.stringify({
            user_id: user_id || `anon_${Date.now()}`,
            user_info: user_info || {},
          })

          const auth = pusher.authorizeChannel(socket_id, channel_name, channelData)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ...auth, channel_data: channelData }))
        })
      }
    }
  ],
  css: {
    postcss: {}
  }
})