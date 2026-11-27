defmodule Relay.RoomChannel do
  @moduledoc "Signalling and WebSocket pose fan-out for one room."

  use Phoenix.Channel, log_handle_in: false

  alias Relay.RoomServer

  @max_room_id_length 64

  @impl true
  def join("room:" <> room_id, _payload, socket)
      when byte_size(room_id) in 1..@max_room_id_length do
    {:ok, assign(socket, room_id: room_id, slot: nil)}
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "invalid_room_id"}}

  @impl true
  def handle_in(event, %{"host_secret" => secret} = payload, %{assigns: %{slot: nil}} = socket)
      when event in ["create", "reclaim"] and is_binary(secret) and secret != "" do
    result =
      RoomServer.create_or_reclaim(
        socket.assigns.room_id,
        secret,
        Map.get(payload, "transport_kind", "websocket"),
        Map.get(payload, "hz", 60),
        self()
      )

    case result do
      {:ok, %{slot: slot} = reply} -> {:reply, {:ok, reply}, assign(socket, :slot, slot)}
      {:error, reason} -> {:reply, error(reason), socket}
    end
  end

  def handle_in(event, _payload, %{assigns: %{slot: slot}} = socket)
      when event in ["create", "reclaim"] and slot != nil,
      do: {:reply, error(:already_joined), socket}

  def handle_in("knock", payload, socket) do
    case RoomServer.knock(socket.assigns.room_id, Map.get(payload, "display_name"), self()) do
      {:ok, knock_id} -> {:reply, {:ok, %{knock_id: knock_id}}, socket}
      {:error, reason} -> {:reply, error(reason), socket}
    end
  end

  def handle_in("approve", %{"knock_id" => knock_id}, socket) when is_binary(knock_id) do
    to_reply(RoomServer.approve(socket.assigns.room_id, knock_id, self()), socket)
  end

  def handle_in("reject", %{"knock_id" => knock_id}, socket) when is_binary(knock_id) do
    to_reply(RoomServer.reject(socket.assigns.room_id, knock_id, self()), socket)
  end

  def handle_in("kick", %{"slot" => slot}, socket) when is_integer(slot) do
    to_reply(RoomServer.kick(socket.assigns.room_id, slot, self()), socket)
  end

  def handle_in("set_hz", %{"hz" => hz}, socket) do
    to_reply(RoomServer.set_hz(socket.assigns.room_id, hz, self()), socket)
  end

  def handle_in("signal", payload, socket) when is_map(payload) do
    to_reply(RoomServer.signal(socket.assigns.room_id, self(), payload), socket)
  end

  def handle_in("stats", _payload, socket) do
    to_reply(RoomServer.stats(socket.assigns.room_id), socket)
  end

  def handle_in("pose", {:binary, ciphertext}, %{assigns: %{slot: slot}} = socket) when slot != nil do
    RoomServer.forward_ws_pose(socket.assigns.room_id, self(), ciphertext)
    {:noreply, socket}
  end

  def handle_in("pose", _payload, socket), do: {:noreply, socket}

  def handle_in(event, _payload, socket)
      when event in ~w(create reclaim approve reject kick set_hz),
      do: {:reply, error(:invalid_payload), socket}

  def handle_in(_event, _payload, socket), do: {:reply, error(:unknown_event), socket}

  @impl true
  def handle_info({:approved, slot, creds, hz}, socket) do
    push(socket, "approved", %{slot: slot, creds: creds, hz: hz})
    {:noreply, assign(socket, :slot, slot)}
  end

  def handle_info(:rejected, socket), do: push_event(socket, "rejected", %{})

  def handle_info(:kicked, socket) do
    push(socket, "kicked", %{})
    {:stop, :normal, socket}
  end

  def handle_info(:room_closed, socket) do
    push(socket, "room_closed", %{})
    {:noreply, assign(socket, :slot, nil)}
  end

  def handle_info({:knock_received, payload}, socket), do: push_event(socket, "knock_received", payload)

  def handle_info({:peer_joined, slot, display_name}, socket),
    do: push_event(socket, "peer_joined", %{slot: slot, display_name: display_name})

  def handle_info({:peer_left, slot, reason}, socket),
    do: push_event(socket, "peer_left", %{slot: slot, reason: reason})

  def handle_info({:hz_changed, hz}, socket), do: push_event(socket, "hz", %{hz: hz})
  def handle_info({:relay_signal, signal}, socket), do: push_event(socket, "signal", signal)
  def handle_info({:ws_pose, frame}, socket), do: push_event(socket, "pose", {:binary, frame})

  defp push_event(socket, event, payload) do
    push(socket, event, payload)
    {:noreply, socket}
  end

  defp to_reply(:ok, socket), do: {:reply, {:ok, %{}}, socket}
  defp to_reply({:ok, payload}, socket) when is_map(payload), do: {:reply, {:ok, payload}, socket}
  defp to_reply({:ok, hz}, socket) when is_integer(hz), do: {:reply, {:ok, %{hz: hz}}, socket}
  defp to_reply({:error, reason}, socket), do: {:reply, error(reason), socket}

  defp error(reason) when is_atom(reason), do: {:error, %{reason: Atom.to_string(reason)}}
  defp error(reason), do: {:error, %{reason: inspect(reason)}}
end
