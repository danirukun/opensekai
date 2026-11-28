import Config

config :relay, Relay.Endpoint, server: false

config :relay, :room_idle_timeout_ms, 200

config :logger, level: :warning
