defmodule RelayWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :relay

  plug Plug.Parsers,
    parsers: [:json],
    pass: ["*/*"],
    json_decoder: Jason

  plug RelayWeb.Router
end
