defmodule Relay.Transport.ExWebRTC do
  @moduledoc """
  Fans pose frames out over `ex_webrtc` DataChannels, with a WebSocket fallback per receiver.

  The state holds an ETS table owned by the room process:

    * `{{:member, slot}, signal_pid}` for every slot in the room, from `open_session/2` to `close/2`.
    * `{slot, peer_process, peer_connection, pose_channel_ref | nil}` while the slot has a peer
      connection. `ExWebRTCPeer` writes it.
    * atom keys are counters.

  A receiver gets a frame over its open pose DataChannel, or as `{:ws_pose, frame}` to its
  channel process when it has none. Each offer starts a fresh peer connection for the slot,
  so a client can retry after a failure. Peer processes read the table to fan frames out
  without going through the room process.
  """

  @behaviour Relay.Transport

  alias ExWebRTC.{ICECandidate, PeerConnection, SessionDescription}
  alias Relay.Transport.ExWebRTCPeer

  @max_frame_bytes 1200
  @counters [:frames_in, :frames_out, :bytes_in, :bytes_out, :dropped_oversize]
  @key_cert_term {__MODULE__, :key_cert}

  @impl true
  def open_session(%{room_id: room_id, transport_state: state, peer_pid: signal_pid}, slot) do
    state = state || new_state(room_id)
    stop_peer(state, slot)
    true = :ets.insert(state.table, {{:member, slot}, signal_pid})
    {:ok, state, %{kind: "ex_webrtc", slot: slot, ice_servers: []}}
  end

  @impl true
  def negotiate(state, slot, signal) do
    do_negotiate(state, slot, signal)
  catch
    :exit, reason -> {:error, {:peer_connection, reason}}
  end

  defp do_negotiate(state, slot, %{"type" => "offer", "sdp" => sdp}) when is_binary(sdp) do
    with {:ok, signal_pid} <- fetch_member(state, slot),
         {:ok, pc} <- restart_peer(state, slot, signal_pid),
         :ok <-
           PeerConnection.set_remote_description(pc, SessionDescription.from_json(%{"type" => "offer", "sdp" => sdp})),
         {:ok, answer} <- PeerConnection.create_answer(pc),
         :ok <- PeerConnection.set_local_description(pc, answer) do
      {:ok, state, [%{"type" => "answer", "sdp" => answer.sdp}]}
    end
  end

  defp do_negotiate(state, slot, %{"type" => "candidate", "candidate" => candidate} = signal)
       when is_binary(candidate) do
    candidate = %ICECandidate{
      candidate: candidate,
      sdp_mid: signal["sdpMid"],
      sdp_m_line_index: signal["sdpMLineIndex"],
      username_fragment: signal["usernameFragment"]
    }

    with {:ok, pc} <- fetch_pc(state, slot),
         :ok <- PeerConnection.add_ice_candidate(pc, candidate) do
      {:ok, state, []}
    end
  end

  defp do_negotiate(_state, _slot, _signal), do: {:error, :invalid_signal}

  @impl true
  def forward(_state, _from_slot, ciphertext) when byte_size(ciphertext) > @max_frame_bytes,
    do: {:error, :oversize}

  def forward(state, from_slot, ciphertext) do
    fan_out(state.table, from_slot, ciphertext)
    {:ok, state}
  end

  @doc """
  Sends `<<from_slot, ciphertext>>` to every other member: over its open pose channel, or over
  its WebSocket when it has none. Drops oversize input.
  """
  def fan_out(table, from_slot, ciphertext) when byte_size(ciphertext) > @max_frame_bytes do
    _ = from_slot
    bump(table, :dropped_oversize, 1)
  end

  def fan_out(table, from_slot, ciphertext) do
    frame = <<from_slot::8, ciphertext::binary>>
    receivers = for {slot, signal_pid} <- members(table), slot != from_slot, do: route(table, slot, signal_pid)

    Enum.each(receivers, fn
      {:data_channel, pc, ref} -> PeerConnection.send_data(pc, ref, frame, :binary)
      {:websocket, pid} -> send(pid, {:ws_pose, frame})
    end)

    bump(table, :frames_in, 1)
    bump(table, :bytes_in, byte_size(ciphertext))
    bump(table, :frames_out, length(receivers))
    bump(table, :bytes_out, length(receivers) * byte_size(frame))
  end

  @impl true
  def stats(state) do
    counters = Map.new(@counters, &{&1, counter(state.table, &1)})

    Map.merge(counters, %{
      kind: "ex_webrtc",
      slots: state.table |> members() |> Enum.map(&elem(&1, 0)) |> Enum.sort(),
      data_channel_slots: for({slot, _, _, ref} <- peers(state.table), ref != nil, do: slot) |> Enum.sort()
    })
  end

  @impl true
  def close(state, :all) do
    state.table |> members() |> Enum.each(fn {slot, _} -> close(state, slot) end)
    state.table |> peers() |> Enum.each(fn {slot, _, _, _} -> stop_peer(state, slot) end)
    :ok
  end

  def close(state, slot) when slot in 0..3 do
    :ets.delete(state.table, {:member, slot})
    stop_peer(state, slot)
    :ok
  end

  @doc false
  def ec_key_cert do
    case :persistent_term.get(@key_cert_term, nil) do
      nil ->
        key_cert = generate_ec_key_cert()
        :persistent_term.put(@key_cert_term, key_cert)
        key_cert

      key_cert ->
        key_cert
    end
  end

  # str0m (dimpl) accepts only ECDSA DTLS certificates, and ex_dtls generates RSA by default.
  defp generate_ec_key_cert do
    %{cert: cert, key: key} =
      :public_key.pkix_test_root_cert(~c"relay", [{:key, {:namedCurve, :secp256r1}}, {:digest, :sha256}])

    {:public_key.der_encode(:ECPrivateKey, key), cert}
  end

  defp new_state(room_id), do: %{room_id: room_id, table: :ets.new(:ex_webrtc_peers, [:set, :public])}

  defp route(table, slot, signal_pid) do
    case :ets.lookup(table, slot) do
      [{^slot, _peer, pc, ref}] when ref != nil -> {:data_channel, pc, ref}
      _ -> {:websocket, signal_pid}
    end
  end

  defp restart_peer(state, slot, signal_pid) do
    stop_peer(state, slot)

    spec =
      {ExWebRTCPeer, slot: slot, table: state.table, owner: self(), signal_pid: signal_pid, pc_opts: pc_opts()}

    case DynamicSupervisor.start_child(Relay.PeerSupervisor, spec) do
      {:ok, _pid} -> fetch_pc(state, slot)
      {:error, reason} -> {:error, reason}
    end
  end

  defp stop_peer(state, slot) do
    case :ets.lookup(state.table, slot) do
      [{^slot, peer, _pc, _ref}] ->
        :ets.delete(state.table, slot)
        ExWebRTCPeer.stop(peer)

      [] ->
        :ok
    end
  end

  defp fetch_member(state, slot) do
    case :ets.lookup(state.table, {:member, slot}) do
      [{{:member, ^slot}, signal_pid}] -> {:ok, signal_pid}
      [] -> {:error, :not_in_room}
    end
  end

  defp fetch_pc(state, slot) do
    case :ets.lookup(state.table, slot) do
      [{^slot, _peer, pc, _ref}] -> {:ok, pc}
      [] -> {:error, :not_in_room}
    end
  end

  defp members(table), do: :ets.select(table, [{{{:member, :"$1"}, :"$2"}, [], [{{:"$1", :"$2"}}]}])

  defp peers(table),
    do: :ets.select(table, [{{:"$1", :"$2", :"$3", :"$4"}, [{:is_integer, :"$1"}], [{{:"$1", :"$2", :"$3", :"$4"}}]}])

  defp bump(table, key, by), do: :ets.update_counter(table, key, by, {key, 0})

  defp counter(table, key) do
    case :ets.lookup(table, key) do
      [{^key, value}] -> value
      [] -> 0
    end
  end

  defp pc_opts do
    bind_ip = parse_bind_ip(Application.fetch_env!(:relay, :udp_bind_ip))

    [
      ice_ip_filter: ip_filter(bind_ip),
      ice_port_range: Application.fetch_env!(:relay, :ice_port_min)..Application.fetch_env!(:relay, :ice_port_max),
      ice_aggressive_nomination: true,
      key_cert: ec_key_cert()
    ]
    |> put_srflx_mapper(Application.get_env(:relay, :public_ipv4))
  end

  defp ip_filter({0, 0, 0, 0}), do: fn _ip -> true end
  defp ip_filter(bind_ip), do: fn ip -> ip == bind_ip end

  defp parse_bind_ip("fly-global-services") do
    {:ok, ip} = :inet.getaddr(~c"fly-global-services", :inet)
    ip
  end

  defp parse_bind_ip(value) do
    {:ok, ip} = value |> String.to_charlist() |> :inet.parse_address()
    ip
  end

  defp put_srflx_mapper(opts, value) when value in [nil, ""], do: opts

  defp put_srflx_mapper(opts, value) do
    {:ok, public_ip} = value |> String.to_charlist() |> :inet.parse_address()
    Keyword.put(opts, :host_to_srflx_ip_mapper, fn _ip -> public_ip end)
  end
end
