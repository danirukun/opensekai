defmodule Relay.Transport.ExWebRTC do
  @moduledoc false

  alias ExWebRTC.{ICECandidate, PeerConnection, SessionDescription}

  def negotiate(state, participant_id, %{"description" => %{"type" => "offer", "sdp" => sdp}} = message) do
    pc = Map.get(state.pcs, participant_id)

    state =
      if is_pid(pc) do
        state
      else
        {:ok, new_pc} = PeerConnection.start_link(ice_opts())
        put_in(state, [:pcs, participant_id], new_pc)
      end

    pc = Map.fetch!(state.pcs, participant_id)
    offer = %SessionDescription{type: :offer, sdp: sdp}

    with :ok <- PeerConnection.set_remote_description(pc, offer),
         :ok <- add_remote_candidates(pc, Map.get(message, "candidates", [])),
         {:ok, answer} <- PeerConnection.create_answer(pc),
         :ok <- PeerConnection.set_local_description(pc, answer) do
      local = PeerConnection.get_local_description(pc) || answer
      {candidates, channel_ref} = gather(pc, [], nil, System.monotonic_time(:millisecond) + 800)

      state =
        if is_reference(channel_ref) do
          put_in(state, [:channel_refs, channel_ref], participant_id)
        else
          state
        end

      {:ok,
       %{
         "description" => %{"type" => "answer", "sdp" => local.sdp},
         "candidates" => Enum.map(candidates, &encode_candidate/1)
       }, state}
    else
      {:error, reason} -> {:error, reason, state}
      other -> {:error, other, state}
    end
  end

  def negotiate(state, _participant_id, _message), do: {:error, :bad_signal, state}

  def forward(state, from_id, bytes) do
    deliveries = Relay.Fanout.fanout(state.participants, from_id, bytes)

    Enum.each(deliveries, fn {id, payload} ->
      case Map.get(state.pcs, id) do
        nil ->
          :ok

        pc ->
          ref = ref_for(state, id)

          if is_reference(ref) do
            PeerConnection.send_data(pc, ref, payload, :binary)
          end
      end
    end)
  end

  def ice_opts do
    start_port = port_env("RELAY_ICE_PORT_START", 50_000)
    end_port = port_env("RELAY_ICE_PORT_END", 50_099)

    [
      controlling_process: self(),
      ice_port_range: start_port..end_port,
      ice_aggressive_nomination: true,
      features: []
    ]
  end

  defp port_env(name, default) do
    case System.get_env(name) do
      nil -> default
      value -> String.to_integer(value)
    end
  end

  defp add_remote_candidates(_pc, []), do: :ok

  defp add_remote_candidates(pc, candidates) do
    Enum.reduce_while(candidates, :ok, fn candidate, :ok ->
      case decode_candidate(candidate) do
        {:ok, ice} ->
          case PeerConnection.add_ice_candidate(pc, ice) do
            :ok -> {:cont, :ok}
            {:error, reason} -> {:halt, {:error, reason}}
          end

        :skip ->
          {:cont, :ok}
      end
    end)
  end

  defp decode_candidate(%{"candidate" => ""}), do: :skip

  defp decode_candidate(%{"candidate" => candidate} = map) do
    {:ok,
     %ICECandidate{
       candidate: strip_prefix(candidate),
       sdp_mid: map["sdpMid"] || "0",
       sdp_m_line_index: map["sdpMLineIndex"] || 0,
       username_fragment: map["usernameFragment"]
     }}
  end

  defp decode_candidate(_), do: :skip

  defp strip_prefix("a=" <> rest), do: rest
  defp strip_prefix(other), do: other

  defp encode_candidate(candidate) do
    ICECandidate.to_json(candidate)
  end

  defp gather(_pc, acc, channel_ref, deadline) when deadline < 0 do
    {Enum.reverse(acc), channel_ref}
  end

  defp gather(pc, acc, channel_ref, deadline) do
    timeout = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      {:ex_webrtc, _from, {:ice_candidate, candidate}} ->
        gather(pc, [candidate | acc], channel_ref, deadline)

      {:ex_webrtc, _from, {:data_channel, channel}} ->
        gather(pc, acc, channel.ref, deadline)

      {:ex_webrtc, _from, {:ice_gathering_state_change, :complete}} ->
        {Enum.reverse(acc), channel_ref}

      {:ex_webrtc, _from, _other} ->
        gather(pc, acc, channel_ref, deadline)
    after
      timeout -> {Enum.reverse(acc), channel_ref}
    end
  end

  defp ref_for(state, participant_id) do
    Enum.find_value(state.channel_refs, fn {ref, id} ->
      if id == participant_id, do: ref
    end)
  end
end
