defmodule Relay.Transport do
  @moduledoc """
  Pose transport behind a room.

  `RoomServer` keeps one transport state per room. `room_ctx` carries it as
  `:transport_state` (`nil` before the first session), together with `:room_id`,
  `:peer_pid`, `:display_name` and `:hz`. The first `open_session/2` creates the
  room state and every later call returns the updated one.
  """

  @type slot :: 0..3
  @type room_ctx :: %{
          required(:room_id) => String.t(),
          required(:transport_state) => term() | nil,
          required(:peer_pid) => pid(),
          optional(atom()) => term()
        }

  @callback open_session(room_ctx(), slot()) :: {:ok, state :: term(), creds :: map()} | {:error, term()}
  @callback negotiate(state :: term(), slot(), signal :: map()) ::
              {:ok, state :: term(), signals :: [map()]} | {:error, term()}
  @callback forward(state :: term(), from_slot :: slot(), ciphertext :: binary()) ::
              {:ok, state :: term()} | {:error, term()}
  @callback stats(state :: term()) :: map()
  @callback close(state :: term(), target :: slot() | :all) :: :ok
end
