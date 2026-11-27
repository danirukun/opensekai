defmodule Relay.Transport.WebSocket do
  @moduledoc """
  Fans pose frames out over the room channel sockets.

  The state holds an ETS table owned by the room process, because `close/2` returns
  only `:ok` and still has to remove the slot. Integer keys are peer slots; atom keys
  are counters.
  """

  @behaviour Relay.Transport

  @max_frame_bytes 1200

  @impl true
  def open_session(%{room_id: room_id, transport_state: state, peer_pid: pid}, slot) do
    state = state || new_state(room_id)
    true = :ets.insert(state.table, {slot, pid})
    {:ok, state, %{kind: "websocket", slot: slot}}
  end

  @impl true
  def negotiate(state, _slot, _signal), do: {:ok, state, []}

  @impl true
  def forward(_state, _from_slot, ciphertext) when byte_size(ciphertext) > @max_frame_bytes,
    do: {:error, :oversize}

  def forward(state, from_slot, ciphertext) do
    frame = <<from_slot::8, ciphertext::binary>>
    receivers = for {slot, pid} <- peers(state), slot != from_slot, do: pid

    Enum.each(receivers, &send(&1, {:ws_pose, frame}))
    :ets.update_counter(state.table, :frames_in, 1, {:frames_in, 0})
    :ets.update_counter(state.table, :frames_out, length(receivers), {:frames_out, 0})
    {:ok, state}
  end

  @impl true
  def stats(state) do
    %{
      kind: "websocket",
      slots: state |> peers() |> Enum.map(&elem(&1, 0)) |> Enum.sort(),
      frames_in: counter(state, :frames_in),
      frames_out: counter(state, :frames_out)
    }
  end

  @impl true
  def close(state, :all) do
    :ets.select_delete(state.table, [{{:"$1", :_}, [{:is_integer, :"$1"}], [true]}])
    :ok
  end

  def close(state, slot) when slot in 0..3 do
    :ets.delete(state.table, slot)
    :ok
  end

  defp new_state(room_id), do: %{room_id: room_id, table: :ets.new(:ws_peers, [:set, :public])}

  defp peers(state), do: :ets.select(state.table, [{{:"$1", :"$2"}, [{:is_integer, :"$1"}], [{{:"$1", :"$2"}}]}])

  defp counter(state, key) do
    case :ets.lookup(state.table, key) do
      [{^key, value}] -> value
      [] -> 0
    end
  end
end
