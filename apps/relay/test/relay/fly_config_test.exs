defmodule Relay.FlyConfigTest do
  use ExUnit.Case, async: true

  test "fly config names ams and the udp range" do
    toml = File.read!("fly.toml")
    assert toml =~ "primary_region = \"ams\""
    assert toml =~ "start_port = 50000"
    assert toml =~ "end_port = 50099"
    refute toml =~ "livekit.cloud"
  end
end
