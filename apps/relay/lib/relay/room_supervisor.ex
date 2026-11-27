defmodule Relay.RoomSupervisor do
  @moduledoc "Supervises one `Relay.RoomServer` per active room."

  def child_spec(_opts) do
    DynamicSupervisor.child_spec(strategy: :one_for_one, name: __MODULE__)
  end
end
