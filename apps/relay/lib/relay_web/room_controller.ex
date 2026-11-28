defmodule RelayWeb.RoomController do
  use Phoenix.Controller, formats: [:json]

  def create(conn, %{"name" => name}) when is_binary(name) do
    case Relay.RoomServer.create(name) do
      {:ok, body} -> json(conn, body)
      {:error, reason} -> error(conn, 500, reason)
    end
  end

  def create(conn, _params), do: error(conn, 400, :bad_request)

  def knock(conn, %{"id" => id, "name" => name}) do
    reply(conn, Relay.RoomServer.knock(id, name))
  end

  def knock(conn, _params), do: error(conn, 400, :bad_request)

  def approve(conn, %{"id" => id, "hostSecret" => secret, "participantId" => participant_id}) do
    reply(conn, Relay.RoomServer.approve(id, secret, participant_id))
  end

  def approve(conn, _params), do: error(conn, 400, :bad_request)

  def signal(conn, %{"id" => id, "participantSecret" => secret} = params) do
    reply(conn, Relay.RoomServer.signal(id, secret, Map.drop(params, ["id", "participantSecret"])))
  end

  def signal(conn, _params), do: error(conn, 403, :not_approved)

  def livekit(conn, %{"id" => id, "participantSecret" => secret}) do
    reply(conn, Relay.RoomServer.livekit(id, secret))
  end

  def livekit(conn, _params), do: error(conn, 403, :not_approved)

  def fanout(conn, %{"id" => id, "hostSecret" => secret, "fromId" => from_id, "bytes" => bytes})
      when is_binary(bytes) do
    reply(conn, Relay.RoomServer.fanout_preview(id, secret, from_id, Base.decode64!(bytes)))
  end

  def fanout(conn, _params), do: error(conn, 400, :bad_request)

  def runtime(conn, _params) do
    {runtime, _wall} = :erlang.statistics(:runtime)
    json(conn, %{"erlangRuntimeMs" => runtime})
  end

  defp reply(conn, {:ok, body}) when is_map(body), do: json(conn, body)

  defp reply(conn, {:ok, list}) when is_list(list) do
    json(conn, %{
      "deliveries" =>
        Enum.map(list, fn {id, bytes} ->
          %{"participantId" => id, "bytes" => Base.encode64(bytes)}
        end)
    })
  end

  defp reply(conn, {:error, :not_found}), do: error(conn, 404, :not_found)
  defp reply(conn, {:error, :not_approved}), do: error(conn, 403, :not_approved)
  defp reply(conn, {:error, :forbidden}), do: error(conn, 403, :forbidden)
  defp reply(conn, {:error, :room_full}), do: error(conn, 409, :room_full)
  defp reply(conn, {:error, :livekit_unconfigured}), do: error(conn, 503, :livekit_unconfigured)
  defp reply(conn, {:error, :livekit_cloud_refused}), do: error(conn, 403, :livekit_cloud_refused)
  defp reply(conn, {:error, reason}) do
    error(conn, 400, inspect(reason))
  end

  defp error(conn, status, reason) do
    conn
    |> put_status(status)
    |> json(%{"error" => inspect(reason)})
  end
end
