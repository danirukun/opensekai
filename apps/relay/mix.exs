defmodule Relay.MixProject do
  use Mix.Project

  def project do
    [
      app: :relay,
      version: "0.1.0",
      elixir: "~> 1.18",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      mod: {Relay.Application, []},
      extra_applications: [:logger, :runtime_tools, :inets, :ssl, :crypto]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      {:phoenix, "~> 1.8.0"},
      {:bandit, "~> 1.15.0"},
      {:jason, "~> 1.4"},
      {:ex_webrtc, "~> 0.18.0"},
      {:ex_sctp, "~> 0.1.3"}
    ]
  end
end
