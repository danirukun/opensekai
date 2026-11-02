# YouTube fixtures

Synthetic pages and replies in the shape of the YouTube live chat endpoint (B25). Every name, channel ID, video ID, URL, and message is made up. They are not recordings.

- `channel-live.html`, `channel-ended.html`, `channel-offline.html`: a channel `/live` page with a live, a finished, and no stream.
- `live-chat.html`, `live-chat-replay.html`: the live chat popout page, with the view selector, one backlog item, and a replay.
- `get-live-chat.json`: one `get_live_chat` reply with one item of each mapped action type, a gift redemption, and two skipped actions.
