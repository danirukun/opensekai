defmodule Relay.Endpoint do
  use Phoenix.Endpoint, otp_app: :relay

  socket "/socket", Relay.UserSocket, websocket: true, longpoll: false

  plug Plug.RequestId
  plug Relay.Router
end
