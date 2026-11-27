defmodule Relay.ChannelCase do
  use ExUnit.CaseTemplate

  import Phoenix.ChannelTest

  @endpoint Relay.Endpoint

  using do
    quote do
      import Phoenix.ChannelTest
      import Relay.ChannelCase

      @endpoint Relay.Endpoint
    end
  end

  @doc "Starts a process that stands in for a connected socket and reports every message it gets."
  def start_peer(tag) do
    test_pid = self()
    spawn(fn -> peer_loop(test_pid, tag) end)
  end

  defp peer_loop(test_pid, tag) do
    receive do
      message ->
        send(test_pid, {:peer, tag, message})
        peer_loop(test_pid, tag)
    end
  end

  @doc """
  Starts a process that joins the room channel like a client socket.
  Every channel message and reply is reported to the test as `{:peer, tag, message}`.
  """
  def connect_peer(tag, room_id) do
    test_pid = self()

    pid =
      spawn(fn ->
        socket = socket(Relay.UserSocket, nil, %{}, test_process: test_pid)
        {:ok, _reply, socket} = subscribe_and_join(socket, Relay.RoomChannel, "room:" <> room_id)
        send(test_pid, {:joined, tag, self()})
        channel_peer_loop(test_pid, tag, socket)
      end)

    receive do
      {:joined, ^tag, ^pid} -> pid
    after
      1_000 -> raise "peer #{tag} did not join"
    end
  end

  def peer_push(peer, event, payload), do: send(peer, {:do_push, event, payload})

  defp channel_peer_loop(test_pid, tag, socket) do
    receive do
      {:do_push, event, payload} ->
        push(socket, event, payload)
        channel_peer_loop(test_pid, tag, socket)

      message ->
        send(test_pid, {:peer, tag, message})
        channel_peer_loop(test_pid, tag, socket)
    end
  end

  def unique_room_id, do: "room-" <> Integer.to_string(System.unique_integer([:positive]))

  def stop_room(room_id) do
    case Relay.RoomServer.lookup(room_id) do
      nil -> :ok
      pid -> GenServer.stop(pid)
    end
  end
end
