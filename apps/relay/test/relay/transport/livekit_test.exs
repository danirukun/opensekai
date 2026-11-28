defmodule Relay.Transport.LiveKitTest do
  use ExUnit.Case, async: true

  alias Relay.Transport.LiveKit

  @config [url: "wss://lk.test", http_url: "https://lk.test", api_key: "devkey", api_secret: "secret"]

  defp decode_jwt(token, secret) do
    [header, claims, signature] = String.split(token, ".")
    expected = :crypto.mac(:hmac, :sha256, secret, header <> "." <> claims)
    assert Base.url_decode64!(signature, padding: false) == expected

    {Jason.decode!(Base.url_decode64!(header, padding: false)),
     Jason.decode!(Base.url_decode64!(claims, padding: false))}
  end

  defp ctx(test_pid) do
    http_post = fn url, headers, body ->
      send(test_pid, {:post, url, headers, Jason.decode!(body)})
      {:ok, 200, "{}"}
    end

    %{room_id: "room-a", transport_state: nil, peer_pid: test_pid, livekit: @config, http_post: http_post}
  end

  test "mint_token signs a subscribe-only HS256 grant" do
    token = LiveKit.mint_token("room-a", 2, "devkey", "secret", now: 1_000, ttl: 600)
    {header, claims} = decode_jwt(token, "secret")

    assert header == %{"alg" => "HS256", "typ" => "JWT"}
    assert %{"iss" => "devkey", "sub" => "slot-2", "nbf" => 1_000, "exp" => 1_600} = claims

    assert claims["video"] == %{
             "roomJoin" => true,
             "room" => "room-a",
             "canPublish" => false,
             "canSubscribe" => true,
             "canPublishData" => true
           }
  end

  test "open_session creates the room once and returns a peer token" do
    assert {:ok, state, creds} = LiveKit.open_session(ctx(self()), 1)

    assert_receive {:post, "https://lk.test/twirp/livekit.RoomService/CreateRoom", headers, body}
    assert body == %{"name" => "room-a", "max_participants" => 4}
    {_, service_claims} = decode_bearer(headers)
    assert %{"roomCreate" => true, "roomAdmin" => true, "room" => "room-a"} = service_claims["video"]

    assert %{kind: "livekit", slot: 1, url: "wss://lk.test", room: "room-a", token: token} = creds
    assert {_, %{"sub" => "slot-1"}} = decode_jwt(token, "secret")

    assert {:ok, _state, %{slot: 2}} = LiveKit.open_session(%{ctx(self()) | transport_state: state}, 2)
    refute_receive {:post, _, _, _}
  end

  test "close removes one participant or deletes the room" do
    {:ok, state, _} = LiveKit.open_session(ctx(self()), 1)
    assert_receive {:post, _, _, _}

    assert :ok = LiveKit.close(state, 1)

    assert_receive {:post, "https://lk.test/twirp/livekit.RoomService/RemoveParticipant", _,
                    %{"room" => "room-a", "identity" => "slot-1"}}

    assert :ok = LiveKit.close(state, :all)
    assert_receive {:post, "https://lk.test/twirp/livekit.RoomService/DeleteRoom", _, %{"room" => "room-a"}}
  end

  @tag :capture_log
  test "open_session fails when CreateRoom fails" do
    failing = %{ctx(self()) | http_post: fn _, _, _ -> {:ok, 500, "boom"} end}
    assert {:error, {:livekit, 500}} = LiveKit.open_session(failing, 1)
  end

  defp decode_bearer(headers) do
    {"authorization", "Bearer " <> token} = List.keyfind(headers, "authorization", 0)
    decode_jwt(token, "secret")
  end
end
