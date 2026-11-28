import Config

config :relay, RelayWeb.Endpoint,
  url: [host: "127.0.0.1"],
  http: [ip: {127, 0, 0, 1}, port: 4000],
  secret_key_base: "spike-dev-secret-key-base-not-for-production-use-0123456789abcdef",
  server: true,
  pubsub_server: Relay.PubSub,
  render_errors: [formats: [json: RelayWeb.ErrorJSON]]

config :logger, level: :info

import_config "#{config_env()}.exs"
