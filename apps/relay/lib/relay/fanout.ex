defmodule Relay.Fanout do
  @moduledoc false

  @room_cap 4

  def room_cap, do: @room_cap

  def fanout(participants, from_id, bytes) when is_binary(bytes) do
    participants
    |> Enum.filter(fn {id, participant} ->
      id != from_id and participant.status == :approved
    end)
    |> Enum.map(fn {id, _} -> {id, bytes} end)
  end

  def credential(%{status: :approved, secret: secret}) when is_binary(secret), do: {:ok, secret}
  def credential(_), do: :error
end
