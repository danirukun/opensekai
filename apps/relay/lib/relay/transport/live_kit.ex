defmodule Relay.Transport.LiveKit do
  @moduledoc false

  def token(room_id, participant_id) do
    key = System.get_env("LIVEKIT_API_KEY")
    secret = System.get_env("LIVEKIT_API_SECRET")
    url = System.get_env("LIVEKIT_URL")

    cond do
      not (is_binary(key) and is_binary(secret) and is_binary(url)) ->
        {:error, :livekit_unconfigured}

      cloud?(url) ->
        {:error, :livekit_cloud_refused}

      true ->
        case Relay.LiveKitToken.mint(key, secret, room_id, participant_id) do
          {:ok, jwt} -> {:ok, %{"url" => url, "token" => jwt, "reliable" => false}}
          other -> other
        end
    end
  end

  defp cloud?(url) do
    uri = URI.parse(url)
    host = uri.host || ""
    String.ends_with?(host, "livekit.cloud")
  end
end
