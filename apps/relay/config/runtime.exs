import Config

if config_env() == :prod do
  secret =
    System.get_env("SECRET_KEY_BASE") ||
      raise "SECRET_KEY_BASE is missing"

  port = String.to_integer(System.get_env("PORT", "4000"))

  config :relay, RelayWeb.Endpoint,
    http: [ip: {0, 0, 0, 0}, port: port],
    secret_key_base: secret,
    server: true
end
