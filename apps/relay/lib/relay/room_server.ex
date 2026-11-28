defmodule Relay.RoomServer do
  @moduledoc false
  use GenServer

  alias Relay.Fanout

  def start_link(opts) do
    id = Keyword.fetch!(opts, :id)
    GenServer.start_link(__MODULE__, opts, name: via(id))
  end

  def create(host_name) when is_binary(host_name) do
    id = random_id()
    host_secret = random_id()
    host_id = random_id()
    host_participant_secret = random_id()

    spec =
      {__MODULE__,
       [
         id: id,
         host_secret: host_secret,
         host_id: host_id,
         host_name: host_name,
         host_participant_secret: host_participant_secret
       ]}

    case DynamicSupervisor.start_child(Relay.RoomSupervisor, spec) do
      {:ok, _pid} ->
        {:ok,
         %{
           "roomId" => id,
           "hostSecret" => host_secret,
           "participantId" => host_id,
           "participantSecret" => host_participant_secret
         }}

      other ->
        other
    end
  end

  def knock(room_id, name) when is_binary(name) do
    call(room_id, {:knock, name})
  end

  def approve(room_id, host_secret, participant_id) do
    call(room_id, {:approve, host_secret, participant_id})
  end

  def signal(room_id, participant_secret, message) do
    call(room_id, {:signal, participant_secret, message})
  end

  def livekit(room_id, participant_secret) do
    call(room_id, {:livekit, participant_secret})
  end

  def fanout_preview(room_id, host_secret, from_id, bytes) do
    call(room_id, {:fanout_preview, host_secret, from_id, bytes})
  end

  def via(id), do: {:via, Registry, {Relay.Registry, id}}

  @impl true
  def init(opts) do
    host = %{
      name: Keyword.fetch!(opts, :host_name),
      role: :host,
      status: :approved,
      secret: Keyword.fetch!(opts, :host_participant_secret)
    }

    {:ok,
     %{
       id: Keyword.fetch!(opts, :id),
       host_secret: Keyword.fetch!(opts, :host_secret),
       participants: %{Keyword.fetch!(opts, :host_id) => host},
       pcs: %{},
       channel_refs: %{}
     }}
  end

  @impl true
  def handle_call({:knock, name}, _from, state) do
    if map_size(state.participants) >= Fanout.room_cap() do
      {:reply, {:error, :room_full}, state}
    else
      id = random_id()

      participant = %{
        name: name,
        role: :guest,
        status: :pending,
        secret: nil
      }

      state = put_in(state, [:participants, id], participant)
      {:reply, {:ok, %{"participantId" => id, "status" => "pending"}}, state}
    end
  end

  def handle_call({:approve, host_secret, participant_id}, _from, state) do
    cond do
      host_secret != state.host_secret ->
        {:reply, {:error, :forbidden}, state}

      not Map.has_key?(state.participants, participant_id) ->
        {:reply, {:error, :not_found}, state}

      true ->
        secret = random_id()

        state =
          update_in(state, [:participants, participant_id], fn participant ->
            %{participant | status: :approved, secret: secret}
          end)

        {:reply, {:ok, %{"participantSecret" => secret}}, state}
    end
  end

  def handle_call({:signal, secret, message}, _from, state) do
    case find_by_secret(state, secret) do
      nil ->
        {:reply, {:error, :not_approved}, state}

      {id, %{status: :approved}} ->
        case Relay.Transport.ExWebRTC.negotiate(state, id, message) do
          {:ok, reply, state} -> {:reply, {:ok, reply}, state}
          {:error, reason, state} -> {:reply, {:error, reason}, state}
        end
    end
  end

  def handle_call({:livekit, secret}, _from, state) do
    case find_by_secret(state, secret) do
      nil ->
        {:reply, {:error, :not_approved}, state}

      {id, %{status: :approved}} ->
        {:reply, Relay.Transport.LiveKit.token(state.id, id), state}
    end
  end

  def handle_call({:fanout_preview, host_secret, from_id, bytes}, _from, state) do
    if host_secret == state.host_secret do
      {:reply, {:ok, Fanout.fanout(state.participants, from_id, bytes)}, state}
    else
      {:reply, {:error, :forbidden}, state}
    end
  end

  @impl true
  def handle_info({:ex_webrtc, _pc, {:data, ref, bytes}}, state) when is_binary(bytes) do
    from_id = Map.get(state.channel_refs, ref)

    if is_binary(from_id) do
      Relay.Transport.ExWebRTC.forward(state, from_id, bytes)
    end

    {:noreply, state}
  end

  def handle_info({:ex_webrtc, pc, {:data_channel, channel}}, state) do
    state =
      case Enum.find(state.pcs, fn {_id, pid} -> pid == pc end) do
        {id, _pid} -> put_in(state, [:channel_refs, channel.ref], id)
        nil -> state
      end

    {:noreply, state}
  end

  def handle_info({:ex_webrtc, _pc, _message}, state), do: {:noreply, state}

  defp call(room_id, message) do
    case Registry.lookup(Relay.Registry, room_id) do
      [{_pid, _}] -> GenServer.call(via(room_id), message, 15_000)
      [] -> {:error, :not_found}
    end
  end

  defp find_by_secret(state, secret) when is_binary(secret) do
    Enum.find(state.participants, fn {_id, participant} -> participant.secret == secret end)
  end

  defp find_by_secret(_state, _secret), do: nil

  defp random_id do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
