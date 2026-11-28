defmodule RelayWeb.RoomControllerTest do
  use ExUnit.Case, async: false

  import Plug.Conn
  import Phoenix.ConnTest

  @endpoint RelayWeb.Endpoint

  test "knock has no secret and signal is rejected until approval" do
    conn = build_conn()
    created = post_json(conn, "/api/rooms", %{"name" => "host"})
    assert created["participantSecret"]
    refute Map.has_key?(created, "poseKey")

    knocked = post_json(conn, "/api/rooms/#{created["roomId"]}/knock", %{"name" => "guest"})
    assert knocked["status"] == "pending"
    refute Map.has_key?(knocked, "participantSecret")

    denied =
      post_json(conn, "/api/rooms/#{created["roomId"]}/signal", %{
        "description" => %{"type" => "offer", "sdp" => "v=0"}
      })

    assert denied.status == 403

    approved =
      post_json(conn, "/api/rooms/#{created["roomId"]}/approve", %{
        "hostSecret" => created["hostSecret"],
        "participantId" => knocked["participantId"]
      })

    assert approved["participantSecret"]
    refute Map.has_key?(approved, "poseKey")

    livekit =
      post_json(conn, "/api/rooms/#{created["roomId"]}/livekit", %{
        "participantSecret" => knocked["participantId"]
      })

    assert livekit.status == 403
  end

  test "fanout returns the same bytes for the other approved participant" do
    conn = build_conn()
    created = post_json(conn, "/api/rooms", %{"name" => "host"})

    knocked = post_json(conn, "/api/rooms/#{created["roomId"]}/knock", %{"name" => "guest"})

    approved =
      post_json(conn, "/api/rooms/#{created["roomId"]}/approve", %{
        "hostSecret" => created["hostSecret"],
        "participantId" => knocked["participantId"]
      })

    assert approved["participantSecret"]

    body =
      post_json(conn, "/api/rooms/#{created["roomId"]}/fanout", %{
        "hostSecret" => created["hostSecret"],
        "fromId" => created["participantId"],
        "bytes" => Base.encode64(<<9, 9, 9>>)
      })

    [delivery] = body["deliveries"]
    assert delivery["participantId"] == knocked["participantId"]
    assert Base.decode64!(delivery["bytes"]) == <<9, 9, 9>>
  end

  test "livekit without configuration is unconfigured" do
    conn = build_conn()
    created = post_json(conn, "/api/rooms", %{"name" => "host"})

    result =
      post_json(conn, "/api/rooms/#{created["roomId"]}/livekit", %{
        "participantSecret" => created["participantSecret"]
      })

    assert result.status == 503
  end

  defp post_json(conn, path, body) do
    conn =
      conn
      |> put_req_header("content-type", "application/json")
      |> post(path, Jason.encode!(body))

    if conn.status in 200..299, do: Jason.decode!(conn.resp_body), else: conn
  end
end
