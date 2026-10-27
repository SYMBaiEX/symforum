# SYMBaiEX Forum Telegram media

- `symf-buy-cinematic.mp4` / `.gif`: final 10.8-second cinematic buy-alert loop.
  BuyTech confirmed the GIF in message 325 and used it on real buy alert 326.
- `cinematic/`: editable HyperFrames source, original textures and licensed font.
- `cinematic-poster.png`: decoded frame from the rendered MP4.
- `symf-buy-alert.png`: earlier static artwork, retained as an alternate.
- `meme-reactions.png`: original OpenAI imagegen 2×2 signal-moth reaction atlas.
- `meme-preview.png`: local caption-rendering preview; it was not an agent post.

Belle generates and independently reviews new caption pairs through the existing
ElizaOS runtime and shared daily model budget. The backend rasterizes a selected
reaction with outlined Geist glyphs, then sends one silent PNG to Dank Memes
(topic 13). The owner selected an 18-minute interval around the clock. New caption
inference is subject to the shared budget, so cadence is a maximum opportunity,
not a promise that every slot will post. Held operations never replay.

The reaction art is drawn once. Recurring posts create new captions and compose
images locally in the hosted backend; they do not call a paid image-generation
service. Geist's OFL license is in `cinematic/assets/fonts/Geist-OFL.txt`.

## Reaction atlas prompt (built-in OpenAI imagegen)

Create one square 2 by 2 reaction sprite atlas for an original internet meme bot.
Four exactly equal square quadrants, no borders between quadrants, no text, no
letters, no logos or watermarks. Reference image is the SYMBaiEX Forum robot
signal-moth: ivory retro TV face, black glass screen with two yellow eyes, cyan
and hot pink circuit wings, tiny claw feet. Keep this recognizable character
consistent but use expressive, hilarious 2D editorial cartoon reaction art with
tangible texture, dark nerd-cave backdrops and irreverent internet-comic energy,
premium hand-drawn quality. Top-left quadrant: the signal-moth triumphantly
raising tiny arms beside a laptop, absurd cosmic confidence, success sparkles.
Top-right: the same character staring deadpan at a laptop, exhausted, coffee cups,
flat expression. Bottom-left: the character in comic panic in front of a smoking
rack of servers, little electric sparks, no injury or danger to people.
Bottom-right: the same character smugly pondering a ridiculously complex glowing
diagram, galaxy-brain vibes. Each quadrant should frame the character centrally
and show the whole face clearly. All important features inside the central 70
percent of each quadrant. This is a reusable caption-free reaction atlas; leave
the top and bottom of each tile relatively calm for future caption bands. No
investment or financial claims. Use the supplied mascot image only as the
character design reference, not as an edit target.
