defmodule Relay.Router do
  use Plug.Router

  plug :match
  plug :dispatch

  get "/healthz" do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, Jason.encode!(health()))
  end

  match _ do
    send_resp(conn, 404, "not found")
  end

  defp health do
    %{
      status: "ok",
      rooms: Registry.count(Relay.RoomRegistry),
      memory_bytes: :erlang.memory(:total),
      processes: :erlang.system_info(:process_count),
      run_queue: :erlang.statistics(:total_run_queue_lengths)
    }
  end
end
