defmodule Relay.LiveKitToken do
  @moduledoc false

  def mint(api_key, api_secret, room, identity)
      when is_binary(api_key) and is_binary(api_secret) and is_binary(room) and is_binary(identity) do
    now = System.system_time(:second)

    claims = %{
      "iss" => api_key,
      "sub" => identity,
      "nbf" => now - 5,
      "exp" => now + 3600,
      "video" => %{
        "roomJoin" => true,
        "room" => room,
        "canPublish" => true,
        "canSubscribe" => true,
        "canPublishData" => true
      }
    }

    header = %{"alg" => "HS256", "typ" => "JWT"}
    signing_input = encode(header) <> "." <> encode(claims)
    signature = :crypto.mac(:hmac, :sha256, api_secret, signing_input)
    {:ok, signing_input <> "." <> Base.url_encode64(signature, padding: false)}
  end

  def mint(_, _, _, _), do: {:error, :livekit_unconfigured}

  def payload(token) when is_binary(token) do
    case String.split(token, ".") do
      [_header, body, _sig] ->
        padded = body <> String.duplicate("=", rem(4 - rem(byte_size(body), 4), 4))

        with {:ok, json} <- Base.url_decode64(padded),
             {:ok, map} <- Jason.decode(json) do
          {:ok, map}
        else
          _ -> {:error, :bad_token}
        end

      _ ->
        {:error, :bad_token}
    end
  end

  defp encode(map) do
    map |> Jason.encode!() |> Base.url_encode64(padding: false)
  end
end
