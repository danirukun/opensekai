defmodule Relay.Transport.ExWebRTCPeer do
  @moduledoc """
  One relay-side `ExWebRTC.PeerConnection` for one slot.

  The process owns the peer connection and its events. It registers `{slot, self(), pc, dc_ref}`
  in the room table, where `dc_ref` is `nil` until the `"pose"` DataChannel is open. The process
  stops when the room process that owns the table goes down.
  """

  use GenServer, restart: :temporary

  alias ExWebRTC.{ICECandidate, PeerConnection}
  alias Relay.Transport.ExWebRTC, as: Transport

  @pose_label "pose"

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts)

  def stop(pid) do
    GenServer.stop(pid, :normal)
  catch
    :exit, _ -> :ok
  end

  @impl true
  def init(opts) do
    {:ok, pc} = PeerConnection.start_link(Keyword.fetch!(opts, :pc_opts))
    table = Keyword.fetch!(opts, :table)
    slot = Keyword.fetch!(opts, :slot)
    owner_ref = Process.monitor(Keyword.fetch!(opts, :owner))
    true = :ets.insert(table, {slot, self(), pc, nil})

    {:ok,
     %{
       table: table,
       slot: slot,
       pc: pc,
       signal_pid: Keyword.fetch!(opts, :signal_pid),
       owner_ref: owner_ref,
       pose_ref: nil
     }}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:ice_candidate, candidate}}, %{pc: pc} = state) do
    signal = candidate |> ICECandidate.to_json() |> Map.take(["candidate", "sdpMid", "sdpMLineIndex"])
    send(state.signal_pid, {:relay_signal, Map.put(signal, "type", "candidate")})
    {:noreply, state}
  end

  def handle_info({:ex_webrtc, pc, {:data_channel, %{label: @pose_label, ref: ref}}}, %{pc: pc} = state),
    do: {:noreply, %{state | pose_ref: ref}}

  def handle_info({:ex_webrtc, pc, {:data_channel_state_change, ref, :open}}, %{pc: pc, pose_ref: ref} = state) do
    :ets.update_element(state.table, state.slot, {4, ref})
    {:noreply, state}
  end

  def handle_info({:ex_webrtc, pc, {:data_channel_state_change, ref, :closed}}, %{pc: pc, pose_ref: ref} = state) do
    :ets.update_element(state.table, state.slot, {4, nil})
    {:noreply, state}
  end

  def handle_info({:ex_webrtc, pc, {:data, ref, data}}, %{pc: pc, pose_ref: ref} = state) do
    Transport.fan_out(state.table, state.slot, data)
    {:noreply, state}
  end

  def handle_info({:ex_webrtc, pc, {:connection_state_change, :failed}}, %{pc: pc} = state),
    do: {:stop, :normal, state}

  def handle_info({:ex_webrtc, _pc, _event}, state), do: {:noreply, state}

  def handle_info({:DOWN, ref, :process, _pid, _reason}, %{owner_ref: ref} = state),
    do: {:stop, :normal, state}

  @impl true
  def terminate(_reason, state) do
    :ets.match_delete(state.table, {state.slot, self(), :_, :_})
    PeerConnection.stop(state.pc)
  rescue
    ArgumentError -> PeerConnection.stop(state.pc)
  catch
    :exit, _ -> :ok
  end
end
