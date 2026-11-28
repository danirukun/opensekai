defmodule RelayWeb.ErrorJSON do
  def render(_template, _assigns), do: %{error: "bad_request"}
end
