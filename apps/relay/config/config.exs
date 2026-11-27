import Config

config :relay, Relay.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  pubsub_server: Relay.PubSub,
  check_origin: false,
  server: true

config :relay, :transports, %{
  "websocket" => Relay.Transport.WebSocket
}

config :relay, :room_idle_timeout_ms, 30_000

config :phoenix, :json_library, Jason

config :logger, :default_formatter, format: "$time $metadata[$level] $message\n"

import_config "#{config_env()}.exs"
