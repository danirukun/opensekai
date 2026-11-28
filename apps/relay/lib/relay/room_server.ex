defmodule Relay.RoomServer do
  @moduledoc """
  In-memory state of one room: host, approved peers, pending knocks, rate and transport.

  Callers identify themselves by channel pid. The pid of slot 0 is the host.
  """

  use GenServer, restart: :temporary

  @guest_slots 1..3
  @hz_values [60, 30]

  defstruct [
    :room_id,
    :host_secret,
    :transport_mod,
    :transport_state,
    :hz,
    :idle_token,
    peers: %{},
    pending_knocks: %{}
  ]

  def start_link(opts) do
    room_id = Keyword.fetch!(opts, :room_id)
    GenServer.start_link(__MODULE__, opts, name: via(room_id))
  end

  def lookup(room_id) do
    case Registry.lookup(Relay.RoomRegistry, room_id) do
      [{pid, _}] -> if Process.alive?(pid), do: pid
      [] -> nil
    end
  end

  def create_or_reclaim(room_id, host_secret, transport_kind, hz, host_pid) do
    with {:ok, transport_mod} <- fetch_transport(transport_kind),
         :ok <- check_hz(hz),
         :ok <- ensure_started(room_id, host_secret, transport_mod, hz) do
      call(room_id, {:attach_host, host_secret, host_pid})
    end
  end

  def knock(room_id, display_name, pid), do: call(room_id, {:knock, display_name, pid})
  def approve(room_id, knock_id, pid), do: call(room_id, {:approve, knock_id, pid})
  def reject(room_id, knock_id, pid), do: call(room_id, {:reject, knock_id, pid})
  def kick(room_id, slot, pid), do: call(room_id, {:kick, slot, pid})
  def leave(room_id, pid), do: call(room_id, {:leave, pid})
  def signal(room_id, pid, signal), do: call(room_id, {:signal, pid, signal})
  def forward_ws_pose(room_id, pid, ciphertext), do: call(room_id, {:forward, pid, ciphertext})
  def set_hz(room_id, hz, pid), do: call(room_id, {:set_hz, hz, pid})
  def stats(room_id), do: call(room_id, :stats)

  @impl true
  def init(opts) do
    {:ok,
     %__MODULE__{
       room_id: Keyword.fetch!(opts, :room_id),
       host_secret: Keyword.fetch!(opts, :host_secret),
       transport_mod: Keyword.fetch!(opts, :transport_mod),
       hz: Keyword.fetch!(opts, :hz)
     }}
  end

  @impl true
  def handle_call({:attach_host, secret, host_pid}, _from, state) do
    if Plug.Crypto.secure_compare(secret, state.host_secret) do
      state = state |> evict_host(host_pid) |> cancel_idle()

      case open_peer(state, 0, host_pid, "host") do
        {:ok, state, creds} -> {:reply, {:ok, %{slot: 0, hz: state.hz, creds: creds}}, state}
        {:error, reason} -> {:reply, {:error, reason}, state}
      end
    else
      {:reply, {:error, :invalid_host_secret}, state}
    end
  end

  def handle_call({:knock, display_name, pid}, _from, state) do
    cond do
      not Map.has_key?(state.peers, 0) -> {:reply, {:error, :host_absent}, state}
      known_pid?(state, pid) -> {:reply, {:error, :already_joined}, state}
      true -> register_knock(state, display_name, pid)
    end
  end

  def handle_call({:approve, knock_id, pid}, _from, state) do
    with :ok <- authorize_host(state, pid),
         {:ok, knock} <- fetch_knock(state, knock_id),
         {:ok, slot} <- free_slot(state),
         {:ok, state, creds} <- open_peer(state, slot, knock.pid, knock.display_name, knock.ref) do
      state = %{state | pending_knocks: Map.delete(state.pending_knocks, knock_id)}
      send(knock.pid, {:approved, slot, creds, state.hz})
      notify(state, [slot], {:peer_joined, slot, knock.display_name})
      {:reply, {:ok, %{slot: slot}}, state}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:reject, knock_id, pid}, _from, state) do
    with :ok <- authorize_host(state, pid),
         {:ok, knock} <- fetch_knock(state, knock_id) do
      Process.demonitor(knock.ref, [:flush])
      send(knock.pid, :rejected)
      {:reply, :ok, %{state | pending_knocks: Map.delete(state.pending_knocks, knock_id)}}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:kick, slot, pid}, _from, state) do
    with :ok <- authorize_host(state, pid),
         :ok <- check_guest_slot(state, slot) do
      target = state.peers[slot].pid
      state = drop_peer(state, slot, :kicked)
      send(target, :kicked)
      {:reply, :ok, state}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:leave, pid}, _from, state) do
    case departed(state, pid) do
      {:peer, slot} -> state |> drop_peer(slot, :left) |> wind_down(:reply, :ok)
      {:knock, knock_id} -> {:reply, :ok, drop_knock(state, knock_id)}
      :none -> {:reply, :ok, state}
    end
  end

  def handle_call({:signal, pid, signal}, _from, state) do
    with {:ok, slot} <- slot_of(state, pid),
         {:ok, transport_state, outbound} <-
           state.transport_mod.negotiate(state.transport_state, slot, signal) do
      Enum.each(outbound, &send(pid, {:relay_signal, &1}))
      {:reply, :ok, %{state | transport_state: transport_state}}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:forward, pid, ciphertext}, _from, state) do
    with {:ok, slot} <- slot_of(state, pid),
         {:ok, transport_state} <- state.transport_mod.forward(state.transport_state, slot, ciphertext) do
      {:reply, :ok, %{state | transport_state: transport_state}}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:set_hz, hz, pid}, _from, state) do
    with :ok <- authorize_host(state, pid),
         :ok <- check_hz(hz) do
      notify(state, [], {:hz_changed, hz})
      {:reply, {:ok, hz}, %{state | hz: hz}}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call(:stats, _from, state) do
    stats = %{
      peers: map_size(state.peers),
      pending: map_size(state.pending_knocks),
      hz: state.hz,
      transport: state.transport_state && state.transport_mod.stats(state.transport_state)
    }

    {:reply, {:ok, stats}, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, pid, _reason}, state) do
    case departed(state, pid, ref) do
      {:peer, slot} -> state |> drop_peer(slot, :left) |> wind_down(:noreply)
      {:knock, knock_id} -> {:noreply, drop_knock(state, knock_id)}
      :none -> {:noreply, state}
    end
  end

  def handle_info({:idle_timeout, token}, %{idle_token: token} = state) when token != nil,
    do: {:stop, :normal, state}

  def handle_info({:idle_timeout, _stale}, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, %{transport_state: nil}), do: :ok

  def terminate(_reason, state) do
    notify(state, [], :room_closed)
    Enum.each(state.pending_knocks, fn {_id, knock} -> send(knock.pid, :room_closed) end)
    state.transport_mod.close(state.transport_state, :all)
    :ok
  end

  defp via(room_id), do: {:via, Registry, {Relay.RoomRegistry, room_id}}

  defp call(room_id, message) do
    case lookup(room_id) do
      nil -> {:error, :room_not_found}
      pid -> safe_call(pid, message)
    end
  end

  defp safe_call(pid, message) do
    GenServer.call(pid, message)
  catch
    :exit, {reason, _} when reason in [:noproc, :normal, :shutdown] -> {:error, :room_not_found}
  end

  defp ensure_started(room_id, host_secret, transport_mod, hz) do
    spec = {__MODULE__, room_id: room_id, host_secret: host_secret, transport_mod: transport_mod, hz: hz}

    case DynamicSupervisor.start_child(Relay.RoomSupervisor, spec) do
      {:ok, _pid} -> :ok
      {:error, {:already_started, _pid}} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp fetch_transport(kind) do
    case Application.fetch_env!(:relay, :transports) do
      %{^kind => mod} -> {:ok, mod}
      _ -> {:error, :unknown_transport}
    end
  end

  defp check_hz(hz) when hz in @hz_values, do: :ok
  defp check_hz(_), do: {:error, :invalid_hz}

  defp authorize_host(%{peers: %{0 => %{pid: pid}}}, pid), do: :ok
  defp authorize_host(_state, _pid), do: {:error, :not_host}

  defp check_guest_slot(state, slot) when slot in @guest_slots do
    if Map.has_key?(state.peers, slot), do: :ok, else: {:error, :not_in_room}
  end

  defp check_guest_slot(_state, _slot), do: {:error, :invalid_slot}

  defp fetch_knock(state, knock_id) do
    case state.pending_knocks do
      %{^knock_id => knock} -> {:ok, knock}
      _ -> {:error, :unknown_knock}
    end
  end

  defp free_slot(state) do
    case Enum.find(@guest_slots, &(not Map.has_key?(state.peers, &1))) do
      nil -> {:error, :room_full}
      slot -> {:ok, slot}
    end
  end

  defp slot_of(state, pid) do
    case Enum.find(state.peers, fn {_slot, peer} -> peer.pid == pid end) do
      {slot, _peer} -> {:ok, slot}
      nil -> {:error, :not_in_room}
    end
  end

  defp known_pid?(state, pid) do
    Enum.any?(state.peers, fn {_slot, peer} -> peer.pid == pid end) or
      Enum.any?(state.pending_knocks, fn {_id, knock} -> knock.pid == pid end)
  end

  defp register_knock(state, display_name, pid) do
    knock_id = 9 |> :crypto.strong_rand_bytes() |> Base.url_encode64(padding: false)
    display_name = if is_binary(display_name), do: String.slice(display_name, 0, 64), else: ""
    knock = %{pid: pid, ref: Process.monitor(pid), display_name: display_name}
    state = %{state | pending_knocks: Map.put(state.pending_knocks, knock_id, knock)}
    notify_host(state, {:knock_received, %{knock_id: knock_id, display_name: display_name}})
    {:reply, {:ok, knock_id}, state}
  end

  defp open_peer(state, slot, pid, display_name, ref \\ nil) do
    ctx = %{
      room_id: state.room_id,
      transport_state: state.transport_state,
      peer_pid: pid,
      display_name: display_name,
      hz: state.hz
    }

    case state.transport_mod.open_session(ctx, slot) do
      {:ok, transport_state, creds} ->
        peer = %{pid: pid, ref: ref || Process.monitor(pid), display_name: display_name}
        {:ok, %{state | transport_state: transport_state, peers: Map.put(state.peers, slot, peer)}, creds}

      {:error, reason} ->
        ref && Process.demonitor(ref, [:flush])
        {:error, reason}
    end
  end

  defp evict_host(%{peers: %{0 => %{pid: pid}}} = state, pid), do: drop_peer(state, 0, :left, false)

  defp evict_host(%{peers: %{0 => %{pid: old}}} = state, _new) do
    send(old, :kicked)
    drop_peer(state, 0, :left, false)
  end

  defp evict_host(state, _new), do: state

  defp drop_peer(state, slot, reason, announce? \\ true) do
    %{ref: ref} = state.peers[slot]
    Process.demonitor(ref, [:flush])
    :ok = state.transport_mod.close(state.transport_state, slot)
    state = %{state | peers: Map.delete(state.peers, slot)}
    if announce?, do: notify(state, [], {:peer_left, slot, reason})
    state
  end

  defp drop_knock(state, knock_id) do
    {knock, pending} = Map.pop!(state.pending_knocks, knock_id)
    Process.demonitor(knock.ref, [:flush])
    %{state | pending_knocks: pending}
  end

  defp departed(state, pid, ref \\ nil) do
    matches? = fn entry -> entry.pid == pid and (ref == nil or entry.ref == ref) end

    with nil <- Enum.find_value(state.peers, fn {slot, peer} -> matches?.(peer) && {:peer, slot} end),
         nil <- Enum.find_value(state.pending_knocks, fn {id, knock} -> matches?.(knock) && {:knock, id} end) do
      :none
    end
  end

  defp wind_down(state, kind, reply \\ nil) do
    cond do
      Map.has_key?(state.peers, 0) -> respond(kind, reply, state)
      map_size(state.peers) == 0 -> respond_stop(kind, reply, state)
      true -> respond(kind, reply, schedule_idle(state))
    end
  end

  defp respond(:reply, reply, state), do: {:reply, reply, state}
  defp respond(:noreply, _reply, state), do: {:noreply, state}
  defp respond_stop(:reply, reply, state), do: {:stop, :normal, reply, state}
  defp respond_stop(:noreply, _reply, state), do: {:stop, :normal, state}

  defp schedule_idle(%{idle_token: nil} = state) do
    token = make_ref()
    Process.send_after(self(), {:idle_timeout, token}, Application.fetch_env!(:relay, :room_idle_timeout_ms))
    %{state | idle_token: token}
  end

  defp schedule_idle(state), do: state

  defp cancel_idle(state), do: %{state | idle_token: nil}

  defp notify(state, except_slots, message) do
    for {slot, peer} <- state.peers, slot not in except_slots, do: send(peer.pid, message)
    :ok
  end

  defp notify_host(%{peers: %{0 => %{pid: pid}}}, message), do: send(pid, message)
  defp notify_host(_state, _message), do: :ok
end
