import Config

config :relay, RelayWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  server: false
