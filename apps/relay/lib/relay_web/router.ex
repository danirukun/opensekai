defmodule RelayWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", RelayWeb do
    pipe_through :api

    post "/rooms", RoomController, :create
    post "/rooms/:id/knock", RoomController, :knock
    post "/rooms/:id/approve", RoomController, :approve
    post "/rooms/:id/signal", RoomController, :signal
    post "/rooms/:id/livekit", RoomController, :livekit
    post "/rooms/:id/fanout", RoomController, :fanout
    get "/runtime", RoomController, :runtime
  end
end
