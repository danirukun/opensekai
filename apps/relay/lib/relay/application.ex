defmodule Relay.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {Phoenix.PubSub, name: Relay.PubSub},
      {Registry, keys: :unique, name: Relay.Registry},
      {DynamicSupervisor, name: Relay.RoomSupervisor, strategy: :one_for_one},
      RelayWeb.Endpoint
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: Relay.Supervisor)
  end
end
