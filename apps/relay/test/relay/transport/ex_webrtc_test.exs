defmodule Relay.Transport.ExWebRTCTest do
  use Relay.ChannelCase, async: false

  alias ExWebRTC.{ICECandidate, PeerConnection, SessionDescription}
  alias Relay.Transport.ExWebRTC, as: Transport

  @pose_bytes 368

  # ex_ice never gathers on a loopback interface, so the relay and both clients bind the first LAN address.
  setup_all do
    case lan_ip() do
      nil ->
        {:ok, skip: true}

      ip ->
        previous = Application.get_all_env(:relay)
        Application.put_env(:relay, :udp_bind_ip, ip |> :inet.ntoa() |> to_string())
        Application.put_env(:relay, :ice_port_min, 40_000)
        Application.put_env(:relay, :ice_port_max, 40_500)
        Application.put_env(:relay, :public_ipv4, nil)
        on_exit(fn -> Application.put_all_env(relay: previous) end)
        {:ok, ip: ip}
    end
  end

  setup context do
    if context[:skip], do: raise("no non-loopback IPv4 interface for ICE")
    :ok
  end

  test "fans a pose frame out to the other peer and stops after close", %{ip: ip} do
    room_id = unique_room_id()
    {state, clients} = connect_clients(room_id, ip, [0, 1])
    [c0, c1] = clients

    payload = :crypto.strong_rand_bytes(@pose_bytes)
    PeerConnection.send_data(c0.pc, c0.dc, payload, :binary)

    assert_receive {:ex_webrtc, pc1, {:data, ref1, <<0, ^payload::binary-size(@pose_bytes)>>}}, 2_000
    assert {pc1, ref1} == {c1.pc, c1.dc}
    refute_receive {:ex_webrtc, _, {:data, _, _}}, 200

    assert %{frames_in: 1, frames_out: 1, bytes_in: @pose_bytes, dropped_oversize: 0} = Transport.stats(state)

    assert :ok = Transport.close(state, 1)
    PeerConnection.send_data(c0.pc, c0.dc, payload, :binary)
    refute_receive {:ex_webrtc, _, {:data, _, _}}, 500
    assert Transport.stats(state).slots == [0]

    Transport.close(state, :all)
    assert Transport.stats(state).slots == []
  end

  test "drops an oversize frame", %{ip: ip} do
    room_id = unique_room_id()
    {state, [c0, _c1]} = connect_clients(room_id, ip, [0, 1])

    PeerConnection.send_data(c0.pc, c0.dc, :crypto.strong_rand_bytes(1201), :binary)
    refute_receive {:ex_webrtc, _, {:data, _, _}}, 500
    assert %{dropped_oversize: 1, frames_out: 0} = Transport.stats(state)
    Transport.close(state, :all)
  end

  test "open_session returns ex_webrtc credentials" do
    ctx = %{room_id: unique_room_id(), transport_state: nil, peer_pid: self()}
    assert {:ok, state, %{kind: "ex_webrtc", slot: 2, ice_servers: []}} = Transport.open_session(ctx, 2)
    Transport.close(state, :all)
  end

  test "a negotiated room works through RoomServer", %{ip: ip} do
    room_id = unique_room_id()
    host = start_peer(:host)
    on_exit(fn -> stop_room(room_id) end)

    assert {:ok, %{slot: 0, creds: %{kind: "ex_webrtc", ice_servers: []}}} =
             Relay.RoomServer.create_or_reclaim(room_id, "secret", "ex_webrtc", 60, host)

    {:ok, pc} = PeerConnection.start_link(ice_ip_filter: &(&1 == ip))
    {:ok, _dc} = PeerConnection.create_data_channel(pc, "pose", ordered: false, max_retransmits: 0)
    {:ok, offer} = PeerConnection.create_offer(pc)
    :ok = PeerConnection.set_local_description(pc, offer)

    assert :ok = Relay.RoomServer.signal(room_id, host, %{"type" => "offer", "sdp" => offer.sdp})
    assert_receive {:peer, :host, {:relay_signal, %{"type" => "answer", "sdp" => "v=0" <> _}}}
  end

  defp lan_ip do
    {:ok, ifaddrs} = :inet.getifaddrs()

    Enum.find_value(ifaddrs, fn {_name, opts} ->
      flags = Keyword.get(opts, :flags, [])

      if :up in flags and :loopback not in flags do
        opts |> Keyword.get_values(:addr) |> Enum.find(&match?({_, _, _, _}, &1))
      end
    end)
  end

  defp connect_clients(room_id, ip, slots) do
    test_pid = self()

    {state, clients} =
      Enum.reduce(slots, {nil, []}, fn slot, {state, acc} ->
        forwarder = spawn_link(fn -> forward_signals(test_pid, slot) end)
        ctx = %{room_id: room_id, transport_state: state, peer_pid: forwarder}
        {:ok, state, %{kind: "ex_webrtc"}} = Transport.open_session(ctx, slot)

        {:ok, pc} = PeerConnection.start_link(ice_ip_filter: &(&1 == ip))
        {:ok, dc} = PeerConnection.create_data_channel(pc, "pose", ordered: false, max_retransmits: 0)
        {:ok, offer} = PeerConnection.create_offer(pc)
        :ok = PeerConnection.set_local_description(pc, offer)

        {:ok, state, [%{"type" => "answer", "sdp" => answer_sdp}]} =
          Transport.negotiate(state, slot, %{"type" => "offer", "sdp" => offer.sdp})

        :ok =
          PeerConnection.set_remote_description(
            pc,
            SessionDescription.from_json(%{"type" => "answer", "sdp" => answer_sdp})
          )

        {state, [%{slot: slot, pc: pc, dc: dc.ref, open?: false} | acc]}
      end)

    clients = pump(state, Enum.reverse(clients))
    {state, clients}
  end

  defp forward_signals(test_pid, slot) do
    receive do
      {:relay_signal, signal} -> send(test_pid, {:relay_signal, slot, signal})
    end

    forward_signals(test_pid, slot)
  end

  defp pump(state, clients, deadline \\ System.monotonic_time(:millisecond) + 8_000) do
    cond do
      Enum.all?(clients, & &1.open?) ->
        clients

      System.monotonic_time(:millisecond) > deadline ->
        flunk("data channels did not open: #{inspect(clients)}")

      true ->
        receive do
          {:ex_webrtc, pc, {:ice_candidate, candidate}} ->
            client = Enum.find(clients, &(&1.pc == pc))

            {:ok, _, _} =
              Transport.negotiate(state, client.slot, Map.put(ICECandidate.to_json(candidate), "type", "candidate"))

            pump(state, clients, deadline)

          {:relay_signal, slot, %{"type" => "candidate"} = signal} ->
            client = Enum.find(clients, &(&1.slot == slot))
            PeerConnection.add_ice_candidate(client.pc, ICECandidate.from_json(signal))
            pump(state, clients, deadline)

          {:ex_webrtc, pc, {:data_channel_state_change, ref, :open}} ->
            pump(
              state,
              Enum.map(clients, &if(&1.pc == pc and &1.dc == ref, do: %{&1 | open?: true}, else: &1)),
              deadline
            )

          {:ex_webrtc, _pc, _other} ->
            pump(state, clients, deadline)
        after
          100 -> pump(state, clients, deadline)
        end
    end
  end
end
