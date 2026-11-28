defmodule Relay.FanoutTest do
  use ExUnit.Case, async: true

  alias Relay.Fanout

  test "copies bytes to other approved participants only" do
    participants = %{
      "host" => %{status: :approved, secret: "h"},
      "guest" => %{status: :approved, secret: "g"},
      "pending" => %{status: :pending, secret: nil}
    }

    bytes = <<1, 2, 3, 9>>
    assert Fanout.fanout(participants, "host", bytes) == [{"guest", bytes}]
  end

  test "pending participant has no credential" do
    assert Fanout.credential(%{status: :pending, secret: nil}) == :error
  end

  test "approved participant credential is the secret" do
    assert Fanout.credential(%{status: :approved, secret: "s"}) == {:ok, "s"}
  end
end
