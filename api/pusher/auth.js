import Pusher from 'pusher'

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER || 'us2',
  useTLS: true,
})

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { socket_id, channel_name, user_id, user_info } = req.body

  if (!socket_id || !channel_name) {
    return res.status(400).json({ error: 'Missing socket_id or channel_name' })
  }

  const channelData = JSON.stringify({
    user_id: user_id || `anon_${Date.now()}`,
    user_info: user_info || {},
  })

  const auth = pusher.authorizeChannel(socket_id, channel_name, channelData)
  res.json({ ...auth, channel_data: channelData })
}
