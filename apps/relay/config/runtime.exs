import Config

env_int = fn name, default ->
  case System.get_env(name) do
    nil -> default
    "" -> default
    value -> String.to_integer(value)
  end
end

env_string = fn name, default ->
  case System.get_env(name) do
    nil -> default
    "" -> default
    value -> value
  end
end

secret_key_base =
  env_string.("SECRET_KEY_BASE", Base.encode64(:crypto.strong_rand_bytes(48)))

default_http_ip = if config_env() == :prod, do: "::", else: "127.0.0.1"

{:ok, bind_ip} =
  env_string.("RELAY_HTTP_IP", default_http_ip) |> String.to_charlist() |> :inet.parse_address()

public_host =
  env_string.(
    "RELAY_HOST",
    case System.get_env("FLY_APP_NAME") do
      nil -> "localhost"
      "" -> "localhost"
      app -> "#{app}.fly.dev"
    end
  )

config :relay, Relay.Endpoint,
  url: [host: public_host],
  http: [ip: bind_ip, port: env_int.("PORT", 4000)],
  secret_key_base: secret_key_base

if System.get_env("PHX_SERVER") in ["true", "1"] do
  config :relay, Relay.Endpoint, server: true
end

{ice_port_min, ice_port_max} = if config_env() == :test, do: {40_000, 40_500}, else: {50_000, 50_999}

config :relay,
  udp_bind_ip: env_string.("RELAY_UDP_BIND_IP", "127.0.0.1"),
  public_ipv4: env_string.("RELAY_PUBLIC_IPV4", nil),
  ice_port_min: env_int.("RELAY_ICE_PORT_MIN", ice_port_min),
  ice_port_max: env_int.("RELAY_ICE_PORT_MAX", ice_port_max),
  livekit: [
    url: env_string.("LIVEKIT_URL", "ws://127.0.0.1:7880"),
    http_url: env_string.("LIVEKIT_HTTP_URL", "http://127.0.0.1:7880"),
    api_key: env_string.("LIVEKIT_API_KEY", "devkey"),
    api_secret: env_string.("LIVEKIT_API_SECRET", "secret")
  ]
