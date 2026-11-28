defmodule Relay.RoomServerTest do
  use Relay.ChannelCase, async: false

  alias Relay.RoomServer

  setup do
    room_id = unique_room_id()
    host = start_peer(:host)
    on_exit(fn -> stop_room(room_id) end)
    {:ok, room_id: room_id, host: host}
  end

  defp create(room_id, host, secret \\ "secret", hz \\ 60) do
    RoomServer.create_or_reclaim(room_id, secret, "websocket", hz, host)
  end

  defp admit(room_id, host, tag) do
    guest = start_peer(tag)
    {:ok, knock_id} = RoomServer.knock(room_id, to_string(tag), guest)
    {:ok, %{slot: slot}} = RoomServer.approve(room_id, knock_id, host)
    {guest, slot}
  end

  defp slots(room_id) do
    {:ok, stats} = RoomServer.stats(room_id)
    stats.transport.slots
  end

  test "host creates a room as slot 0 at 60 Hz", %{room_id: room_id, host: host} do
    assert {:ok, %{slot: 0, hz: 60}} = create(room_id, host)
    assert slots(room_id) == [0]
  end

  test "a knock opens no transport session until the host approves", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    guest = start_peer(:guest)

    assert {:ok, knock_id} = RoomServer.knock(room_id, "Xiu", guest)
    assert is_binary(knock_id)
    assert_receive {:peer, :host, {:knock_received, %{knock_id: ^knock_id, display_name: "Xiu"}}}
    assert slots(room_id) == [0]

    assert {:ok, %{slot: 1}} = RoomServer.approve(room_id, knock_id, host)
    assert_receive {:peer, :guest, {:approved, 1, %{kind: "websocket", slot: 1}, 60}}
    assert slots(room_id) == [0, 1]
  end

  test "approval fills slots 1 to 3 and refuses a fourth guest", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)

    assigned =
      for tag <- [:g1, :g2, :g3] do
        {_, slot} = admit(room_id, host, tag)
        slot
      end

    assert assigned == [1, 2, 3]

    late = start_peer(:late)
    {:ok, knock_id} = RoomServer.knock(room_id, "late", late)
    assert {:error, :room_full} = RoomServer.approve(room_id, knock_id, host)
    assert slots(room_id) == [0, 1, 2, 3]
  end

  test "reject removes the knock and tells the guest", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    guest = start_peer(:guest)
    {:ok, knock_id} = RoomServer.knock(room_id, "Xiu", guest)

    assert :ok = RoomServer.reject(room_id, knock_id, host)
    assert_receive {:peer, :guest, :rejected}
    assert {:error, :unknown_knock} = RoomServer.approve(room_id, knock_id, host)
    assert slots(room_id) == [0]
  end

  test "kick closes the transport slot at once and refuses later poses", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    {guest, 1} = admit(room_id, host, :guest)
    {_other, 2} = admit(room_id, host, :other)

    assert :ok = RoomServer.kick(room_id, 1, host)
    assert slots(room_id) == [0, 2]
    assert_receive {:peer, :guest, :kicked}
    assert_receive {:peer, :other, {:peer_left, 1, :kicked}}
    assert {:error, :not_in_room} = RoomServer.forward_ws_pose(room_id, guest, <<1, 2, 3>>)
    refute_receive {:peer, :other, {:ws_pose, _}}

    refilled = start_peer(:refilled)
    {:ok, knock_id} = RoomServer.knock(room_id, "again", refilled)
    assert {:ok, %{slot: 1}} = RoomServer.approve(room_id, knock_id, host)
  end

  test "a guest that disconnects frees its slot", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    {guest, 1} = admit(room_id, host, :guest)

    Process.exit(guest, :kill)
    assert_receive {:peer, :host, {:peer_left, 1, :left}}
    assert slots(room_id) == [0]
  end

  test "pending knocks of a disconnected guest are dropped", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    guest = start_peer(:guest)
    {:ok, knock_id} = RoomServer.knock(room_id, "Xiu", guest)

    ref = Process.monitor(guest)
    Process.exit(guest, :kill)
    assert_receive {:DOWN, ^ref, :process, ^guest, _}
    :sys.get_state(RoomServer.lookup(room_id))
    assert {:error, :unknown_knock} = RoomServer.approve(room_id, knock_id, host)
  end

  test "the room stops when the host leaves an empty room", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    pid = RoomServer.lookup(room_id)
    ref = Process.monitor(pid)

    Process.exit(host, :kill)
    assert_receive {:DOWN, ^ref, :process, ^pid, _}
    assert RoomServer.lookup(room_id) == nil
  end

  test "the room stops after the idle timeout when the host stays away", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    {_guest, 1} = admit(room_id, host, :guest)
    pid = RoomServer.lookup(room_id)
    ref = Process.monitor(pid)

    Process.exit(host, :kill)
    assert_receive {:DOWN, ^ref, :process, ^pid, _}, 2_000
  end

  test "the host reclaims a room after the process stops and guests knock again", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host, "secret", 30)
    {_guest, 1} = admit(room_id, host, :guest)
    stop_room(room_id)

    new_host = start_peer(:new_host)
    assert {:error, :room_not_found} = RoomServer.knock(room_id, "Xiu", start_peer(:early))
    assert {:ok, %{slot: 0, hz: 60}} = RoomServer.create_or_reclaim(room_id, "secret", "websocket", 60, new_host)

    {_guest, 1} = admit(room_id, new_host, :returning)
  end

  test "a live room refuses a wrong host secret and reattaches the right one", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    {_guest, 1} = admit(room_id, host, :guest)
    intruder = start_peer(:intruder)

    assert {:error, :invalid_host_secret} = create(room_id, intruder, "wrong")
    assert slots(room_id) == [0, 1]

    new_host = start_peer(:new_host)
    assert {:ok, %{slot: 0}} = create(room_id, new_host)
    assert {:error, :not_host} = RoomServer.kick(room_id, 1, host)
    assert :ok = RoomServer.kick(room_id, 1, new_host)
  end

  test "only the host can approve, reject, kick, or set the rate", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    {guest, 1} = admit(room_id, host, :guest)
    pending = start_peer(:pending)
    {:ok, knock_id} = RoomServer.knock(room_id, "p", pending)

    assert {:error, :not_host} = RoomServer.approve(room_id, knock_id, guest)
    assert {:error, :not_host} = RoomServer.reject(room_id, knock_id, guest)
    assert {:error, :not_host} = RoomServer.kick(room_id, 1, guest)
    assert {:error, :not_host} = RoomServer.set_hz(room_id, 30, guest)
    assert {:error, :not_host} = RoomServer.approve(room_id, knock_id, pending)
  end

  test "set_hz switches the rate and tells every peer", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    {_guest, 1} = admit(room_id, host, :guest)

    assert {:ok, 30} = RoomServer.set_hz(room_id, 30, host)
    assert_receive {:peer, :guest, {:hz_changed, 30}}
    assert {:error, :invalid_hz} = RoomServer.set_hz(room_id, 45, host)
  end

  test "pose frames go to every other peer, tagged with the sender slot", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    admit(room_id, host, :g1)
    admit(room_id, host, :g2)
    admit(room_id, host, :g3)
    flush_peer_messages()

    payload = :binary.copy(<<7>>, 368)
    assert :ok = RoomServer.forward_ws_pose(room_id, host, payload)

    expected = <<0, payload::binary>>
    for tag <- [:g1, :g2, :g3], do: assert_receive({:peer, ^tag, {:ws_pose, ^expected}})
    refute_receive {:peer, :host, {:ws_pose, _}}
  end

  test "oversize pose frames are refused", %{room_id: room_id, host: host} do
    {:ok, _} = create(room_id, host)
    admit(room_id, host, :g1)
    flush_peer_messages()

    assert {:error, :oversize} = RoomServer.forward_ws_pose(room_id, host, :binary.copy(<<0>>, 1201))
    refute_receive {:peer, :g1, {:ws_pose, _}}
    assert :ok = RoomServer.forward_ws_pose(room_id, host, :binary.copy(<<0>>, 1200))
    assert_receive {:peer, :g1, {:ws_pose, _}}
  end

  test "invalid transport kind and rate are refused", %{room_id: room_id, host: host} do
    assert {:error, :unknown_transport} = RoomServer.create_or_reclaim(room_id, "s", "carrier-pigeon", 60, host)
    assert {:error, :invalid_hz} = RoomServer.create_or_reclaim(room_id, "s", "websocket", 45, host)
    assert RoomServer.lookup(room_id) == nil
  end

  defp flush_peer_messages do
    receive do
      {:peer, _, _} -> flush_peer_messages()
      {:peer_ready, _} -> flush_peer_messages()
    after
      50 -> :ok
    end
  end
end
