defmodule Relay.LiveKitTokenTest do
  use ExUnit.Case, async: true

  test "token payload has no turn url" do
    assert {:ok, token} = Relay.LiveKitToken.mint("key", "secret", "room-1", "guest-1")
    assert {:ok, payload} = Relay.LiveKitToken.payload(token)
    encoded = Jason.encode!(payload)
    refute String.contains?(String.downcase(encoded), "turn")
    assert payload["video"]["room"] == "room-1"
    assert payload["sub"] == "guest-1"
  end

  test "missing inputs do not mint" do
    assert {:error, :livekit_unconfigured} = Relay.LiveKitToken.mint(nil, nil, nil, nil)
  end
end
