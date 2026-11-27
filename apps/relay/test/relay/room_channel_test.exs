defmodule Relay.RoomChannelTest do
  use Relay.ChannelCase, async: false

  alias Phoenix.Socket.{Message, Reply}

  setup do
    room_id = unique_room_id()
    on_exit(fn -> stop_room(room_id) end)
    {:ok, room_id: room_id}
  end

  defp reply(tag, status) do
    assert_receive {:peer, ^tag, %Reply{status: ^status} = reply}
    reply
  end

  defp pushed(tag, event) do
    assert_receive {:peer, ^tag, %Message{event: ^event} = message}
    message.payload
  end

  defp create_host(room_id, secret \\ "s3cret") do
    host = connect_peer(:host, room_id)
    peer_push(host, "create", %{"host_secret" => secret, "transport_kind" => "websocket", "hz" => 60})
    host
  end

  defp admit_guest(room_id, host, tag) do
    guest = connect_peer(tag, room_id)
    peer_push(guest, "knock", %{"display_name" => to_string(tag)})
    %{payload: %{knock_id: knock_id}} = reply(tag, :ok)
    peer_push(host, "approve", %{"knock_id" => knock_id})
    pushed(tag, "approved")
    guest
  end

  test "create assigns slot 0 at 60 Hz", %{room_id: room_id} do
    create_host(room_id)
    assert %{payload: %{slot: 0, hz: 60, creds: %{kind: "websocket"}}} = reply(:host, :ok)
  end

  test "create with a bad rate or transport is an error", %{room_id: room_id} do
    host = connect_peer(:host, room_id)
    peer_push(host, "create", %{"host_secret" => "s", "transport_kind" => "websocket", "hz" => 45})
    assert %{payload: %{reason: "invalid_hz"}} = reply(:host, :error)
    peer_push(host, "create", %{"host_secret" => "s", "transport_kind" => "pigeon", "hz" => 60})
    assert %{payload: %{reason: "unknown_transport"}} = reply(:host, :error)
    peer_push(host, "create", %{"transport_kind" => "websocket", "hz" => 60})
    assert %{payload: %{reason: "invalid_payload"}} = reply(:host, :error)
  end

  test "knock notifies the host and approve hands the guest a slot", %{room_id: room_id} do
    host = create_host(room_id)
    reply(:host, :ok)

    guest = connect_peer(:guest, room_id)
    peer_push(guest, "knock", %{"display_name" => "Xiu"})
    assert %{payload: %{knock_id: knock_id}} = reply(:guest, :ok)
    assert %{knock_id: ^knock_id, display_name: "Xiu"} = pushed(:host, "knock_received")

    peer_push(host, "approve", %{"knock_id" => knock_id})
    assert %{payload: %{slot: 1}} = reply(:host, :ok)
    assert %{slot: 1, hz: 60, creds: %{kind: "websocket", slot: 1}} = pushed(:guest, "approved")
  end

  test "a guest cannot approve, reject, kick, or set the rate", %{room_id: room_id} do
    host = create_host(room_id)
    reply(:host, :ok)
    guest = admit_guest(room_id, host, :guest)
    flush()

    for {event, payload} <- [
          {"approve", %{"knock_id" => "x"}},
          {"reject", %{"knock_id" => "x"}},
          {"kick", %{"slot" => 0}},
          {"set_hz", %{"hz" => 30}}
        ] do
      peer_push(guest, event, payload)
      assert %{payload: %{reason: "not_host"}} = reply(:guest, :error)
    end
  end

  test "reject tells the guest", %{room_id: room_id} do
    host = create_host(room_id)
    reply(:host, :ok)
    guest = connect_peer(:guest, room_id)
    peer_push(guest, "knock", %{"display_name" => "Xiu"})
    %{payload: %{knock_id: knock_id}} = reply(:guest, :ok)

    peer_push(host, "reject", %{"knock_id" => knock_id})
    assert %{payload: %{}} = reply(:host, :ok)
    pushed(:guest, "rejected")
  end

  test "kick tells the guest and stops its channel", %{room_id: room_id} do
    host = create_host(room_id)
    reply(:host, :ok)
    admit_guest(room_id, host, :guest)
    flush()

    peer_push(host, "kick", %{"slot" => 1})
    reply(:host, :ok)
    pushed(:guest, "kicked")
    assert_receive {:peer, :guest, {:socket_close, _channel_pid, :normal}}
  end

  test "binary pose frames reach every other peer and not the sender", %{room_id: room_id} do
    host = create_host(room_id)
    reply(:host, :ok)
    for tag <- [:g1, :g2, :g3], do: admit_guest(room_id, host, tag)
    flush()

    payload = :binary.copy(<<9>>, 368)
    peer_push(host, "pose", {:binary, payload})

    expected = {:binary, <<0, payload::binary>>}
    for tag <- [:g1, :g2, :g3], do: assert(pushed(tag, "pose") == expected)
    refute_receive {:peer, :host, %Message{event: "pose"}}
  end

  test "pose frames from a peer without a slot are ignored", %{room_id: room_id} do
    create_host(room_id)
    reply(:host, :ok)
    stranger = connect_peer(:stranger, room_id)
    flush()

    peer_push(stranger, "pose", {:binary, <<1, 2, 3>>})
    refute_receive {:peer, :host, %Message{event: "pose"}}
  end

  test "stats returns room counts and transport stats", %{room_id: room_id} do
    host = create_host(room_id)
    reply(:host, :ok)
    flush()

    peer_push(host, "stats", %{})
    assert %{payload: %{peers: 1, pending: 0, hz: 60, transport: %{kind: "websocket"}}} = reply(:host, :ok)
  end

  test "set_hz broadcasts the rate", %{room_id: room_id} do
    host = create_host(room_id)
    reply(:host, :ok)
    admit_guest(room_id, host, :guest)
    flush()

    peer_push(host, "set_hz", %{"hz" => 30})
    assert %{payload: %{hz: 30}} = reply(:host, :ok)
    assert %{hz: 30} = pushed(:guest, "hz")
  end

  test "the host reclaims the room after the room process stops", %{room_id: room_id} do
    create_host(room_id, "keep")
    reply(:host, :ok)
    stop_room(room_id)

    host = connect_peer(:host2, room_id)
    peer_push(host, "reclaim", %{"host_secret" => "keep", "transport_kind" => "websocket", "hz" => 60})
    assert %{payload: %{slot: 0}} = reply(:host2, :ok)
    admit_guest(room_id, host, :guest)
  end

  test "reclaim with a wrong secret fails on a live room", %{room_id: room_id} do
    create_host(room_id, "keep")
    reply(:host, :ok)

    intruder = connect_peer(:intruder, room_id)
    peer_push(intruder, "reclaim", %{"host_secret" => "nope", "transport_kind" => "websocket", "hz" => 60})
    assert %{payload: %{reason: "invalid_host_secret"}} = reply(:intruder, :error)
  end

  test "knock for a missing room is an error", %{room_id: room_id} do
    guest = connect_peer(:guest, room_id)
    peer_push(guest, "knock", %{"display_name" => "Xiu"})
    assert %{payload: %{reason: "room_not_found"}} = reply(:guest, :error)
  end

  defp flush do
    receive do
      {:peer, _, _} -> flush()
    after
      50 -> :ok
    end
  end
end
