defmodule Relay.Transport.LiveKit do
  @moduledoc """
  Pose transport through a LiveKit server.

  The relay creates the LiveKit room with Twirp, mints a peer token per slot and gives the
  client the server URL. Clients send pose frames to LiveKit directly, so `forward/3` is not
  used. Tokens are subscribe-only; data publishing is allowed.

  `room_ctx` may carry `:livekit` (config override) and `:http_post`
  (`fn url, headers, json_body -> {:ok, status, body} | {:error, reason}`).
  """

  @behaviour Relay.Transport

  require Logger

  @max_participants 4
  @http_timeout_ms 5_000
  @default_ttl_seconds 3_600
  @twirp "/twirp/livekit.RoomService/"

  @doc "Returns an HS256 LiveKit access token for `slot`. Options: `:ttl` (seconds), `:now` (unix seconds)."
  def mint_token(room_id, slot, api_key, api_secret, opts \\ []) do
    video = %{
      roomJoin: true,
      room: room_id,
      canPublish: false,
      canSubscribe: true,
      canPublishData: true
    }

    sign(%{iss: api_key, sub: "slot-#{slot}", video: video}, api_secret, opts)
  end

  @impl true
  def open_session(%{room_id: room_id, transport_state: state} = ctx, slot) do
    state = state || new_state(ctx)

    with :ok <- ensure_room(state) do
      config = state.config
      token = mint_token(room_id, slot, config[:api_key], config[:api_secret])
      {:ok, ensure_created(state), %{kind: "livekit", slot: slot, url: config[:url], token: token, room: room_id}}
    end
  end

  @impl true
  def negotiate(state, _slot, _signal), do: {:ok, state, []}

  @impl true
  def forward(_state, _from_slot, _ciphertext), do: {:error, :client_publishes_directly}

  @impl true
  def stats(state), do: %{kind: "livekit", room: state.room_id}

  @impl true
  def close(state, :all) do
    twirp(state, "DeleteRoom", %{room: state.room_id})
    :ok
  end

  def close(state, slot) when slot in 0..3 do
    twirp(state, "RemoveParticipant", %{room: state.room_id, identity: "slot-#{slot}"})
    :ok
  end

  defp new_state(ctx) do
    config = Keyword.merge(Application.get_env(:relay, :livekit, []), Map.get(ctx, :livekit, []))

    %{
      room_id: ctx.room_id,
      config: config,
      http_post: Map.get(ctx, :http_post, &httpc_post/3),
      created?: false
    }
  end

  defp ensure_room(%{created?: true}), do: :ok

  defp ensure_room(state) do
    case twirp(state, "CreateRoom", %{name: state.room_id, max_participants: @max_participants}) do
      {:ok, _body} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_created(state), do: %{state | created?: true}

  defp twirp(state, method, body) do
    config = state.config

    service_token =
      sign(
        %{iss: config[:api_key], sub: "relay", video: %{roomCreate: true, roomAdmin: true, room: state.room_id}},
        config[:api_secret],
        []
      )

    headers = [{"authorization", "Bearer " <> service_token}, {"content-type", "application/json"}]
    url = config[:http_url] <> @twirp <> method

    case state.http_post.(url, headers, Jason.encode!(body)) do
      {:ok, status, response} when status in 200..299 ->
        {:ok, response}

      {:ok, status, response} ->
        Logger.warning("livekit #{method} failed: #{status} #{inspect(response)}")
        {:error, {:livekit, status}}

      {:error, reason} ->
        Logger.warning("livekit #{method} failed: #{inspect(reason)}")
        {:error, {:livekit, reason}}
    end
  end

  defp httpc_post(url, headers, body) do
    request = {
      String.to_charlist(url),
      Enum.map(headers, fn {k, v} -> {String.to_charlist(k), String.to_charlist(v)} end),
      ~c"application/json",
      body
    }

    case :httpc.request(:post, request, [timeout: @http_timeout_ms, connect_timeout: @http_timeout_ms],
           body_format: :binary
         ) do
      {:ok, {{_, status, _}, _headers, response}} -> {:ok, status, response}
      {:error, reason} -> {:error, reason}
    end
  end

  defp sign(claims, secret, opts) do
    now = Keyword.get(opts, :now, System.os_time(:second))
    ttl = Keyword.get(opts, :ttl, @default_ttl_seconds)

    header = encode(%{alg: "HS256", typ: "JWT"})
    payload = encode(Map.merge(claims, %{nbf: now, exp: now + ttl}))
    signing_input = header <> "." <> payload
    signature = :crypto.mac(:hmac, :sha256, secret, signing_input)
    signing_input <> "." <> Base.url_encode64(signature, padding: false)
  end

  defp encode(term), do: term |> Jason.encode!() |> Base.url_encode64(padding: false)
end
