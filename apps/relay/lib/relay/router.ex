defmodule Relay.Router do
  use Plug.Router

  plug :match
  plug :dispatch

  get "/healthz" do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, ~s({"status":"ok"}))
  end

  match _ do
    send_resp(conn, 404, "not found")
  end
end
