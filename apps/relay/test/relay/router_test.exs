defmodule Relay.RouterTest do
  use ExUnit.Case, async: true

  import Plug.Test

  test "GET /healthz returns ok with BEAM stats" do
    conn = Relay.Router.call(conn(:get, "/healthz"), Relay.Router.init([]))

    assert conn.status == 200

    assert %{
             "status" => "ok",
             "rooms" => rooms,
             "memory_bytes" => memory_bytes,
             "processes" => processes,
             "run_queue" => run_queue
           } = Jason.decode!(conn.resp_body)

    assert is_integer(rooms) and rooms >= 0
    assert is_integer(memory_bytes) and memory_bytes > 0
    assert is_integer(processes) and processes > 0
    assert is_integer(run_queue) and run_queue >= 0
  end
end
