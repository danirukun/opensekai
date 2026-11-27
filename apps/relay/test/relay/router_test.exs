defmodule Relay.RouterTest do
  use ExUnit.Case, async: true

  import Plug.Test

  test "GET /healthz returns ok" do
    conn = Relay.Router.call(conn(:get, "/healthz"), Relay.Router.init([]))

    assert conn.status == 200
    assert Jason.decode!(conn.resp_body) == %{"status" => "ok"}
  end
end
