# Probe rate: how fast you can actually question the chip

Anyone planning a black-box study of AMBE hardware wants one number
first: how many frames per second can be pushed into the device and read
back. Everything else in an experiment budget follows from it. A sweep
that sounds cheap at 10,000 frames is four minutes at 40 frames per second
and forty minutes at four.

The number for this rig, measured rather than guessed:

| Direction | Marginal cost per frame | Sustained rate |
| --- | --- | --- |
| Encode (160 samples in, 9 bytes out) | 15.97 ms | **62.6 frames/s** |
| Decode (9 bytes in, 160 samples out) | 24.52 ms | **40.8 frames/s** |
| Both, one frame through the round trip | 40.49 ms | **24.7 frames/s** |

A 20 ms frame is real time at 50 frames per second. Encoding runs at
1.25 times real time, decoding at 0.82, and a full round trip at 0.49. A
clip therefore takes about twice its own duration to push through the chip
and back.

## The rig

| | |
| --- | --- |
| Device | NW Digital Radio ThumbDV, DVSI AMBE-3000, `PRODID` `AMBE3000F` |
| Firmware (`VERSTRING`) | `V121.E100.XXXX.C110.G514.R014.A0030608.C0020208` |
| Link | USB serial, 460800 baud, 8N1 |
| Mode | D-STAR full rate, 72 bits per 20 ms frame |
| Host | Apple M4 Pro, macOS 26.5.2 (build 25F84), arm64 |
| Driver | `thumbdv-rig`, one packet out and one packet back per frame, no pipelining |
| Measured | 2026-08-11 |

## Method

Time whole `enc` and `dec` runs, wall clock, from process start to exit,
on four clips of different lengths. A single clip cannot separate the
per-frame cost from the fixed cost of opening the port and configuring the
chip, so the fit does it: run several lengths and the slope is the
per-frame cost, the intercept is everything that happens once.

```
for clip in lr-d lr-c lr-b lj-b; do          # 60, 101, 159 and 208 frames
  for rep in 1 2 3; do
    time thumbdv-rig enc docs/assets/audio/$clip-original.wav /tmp/$clip.ambe --port "$PORT"
    time thumbdv-rig dec docs/assets/data/frames/$clip.ambe   /tmp/$clip.wav  --port "$PORT"
  done
done
```

Three repetitions per clip per direction, the median taken, then an
ordinary least-squares fit of median time against frame count.

Observed, median of three:

| Clip | Frames | Encode | Decode | Encode rate | Decode rate |
| --- | --- | --- | --- | --- | --- |
| `lr-d` | 60 | 1.253 s | 1.769 s | 47.9 f/s | 33.9 f/s |
| `lr-c` | 101 | 1.911 s | 2.788 s | 52.8 f/s | 36.2 f/s |
| `lr-b` | 159 | 2.837 s | 4.213 s | 56.1 f/s | 37.7 f/s |
| `lj-b` | 208 | 3.617 s | 5.397 s | 57.5 f/s | 38.5 f/s |

Spread across the three repetitions was under 20 ms in every cell, so the
link is steady enough that repetition count is not the limiting factor.

The fits:

```
encode:  296 ms + 15.971 ms/frame     R² = 1.0000
decode:  305 ms + 24.518 ms/frame     R² = 1.0000
```

An R² of 1.0000 to four places on four points is worth distrusting on
principle, so note what it means here: the per-frame cost really is
constant, because the driver waits for each frame's reply before sending
the next one. There is nothing in the loop that varies with content.

The whole-run rates in the table are lower than the marginal rates, and
the difference is entirely the 300 ms of setup. Short probes pay it
proportionally more. Amortise it by processing more frames per invocation,
not by processing more invocations.

## Where the time goes

The encode figure of 15.97 ms per frame matches the chip's own reported
encode latency almost exactly: `thumbdv-rig probe` on this device reports
min 14945 µs, mean 16016 µs, max 17144 µs. The encode path is therefore
limited by the chip, not by the host or the link.

Decode costs 8.5 ms more per frame, and the asymmetry has an obvious
candidate. In both directions the bulky item is the 320 bytes of 16-bit
PCM for a 160-sample frame, against nine bytes of channel data
<span class="cite">— DVSI AMBE-3000 product documentation</span>. At
460800 baud with 8N1 framing, 320 bytes is about 7.0 ms of wire time, so
roughly 7 ms of each direction is serial transfer that cannot be avoided
at this baud rate. What is left over is chip time plus host turnaround,
and it is larger on the decode side.

This is a measurement of one driver on one link, not of the silicon's
ceiling. A driver that kept several frames in flight instead of waiting
for each reply would do better, and the 7 ms of wire time is the floor it
would be working against. Nobody has tried that here. Treat these numbers
as what a straightforward request-and-reply tool achieves.

## Using this for an experiment budget

At the round-trip rate of 24.7 frames per second:

| Experiment | Frames | Wall clock |
| --- | --- | --- |
| One 3 s clip, both directions | 150 | 6 s |
| The site's whole 16-file corpus | 1056 | 48 s |
| One minute of speech | 3000 | 2 min |
| One hour of speech | 180,000 | 2.0 h |
| One million probe frames | 1,000,000 | 11.2 h |

Encode-only or decode-only work is faster: an hour of speech is 48 minutes
to encode, 74 minutes to decode.

The practical consequence is that experiments up to a few hundred thousand
frames are an overnight run on one stick, and anything needing tens of
millions of frames needs either several sticks or a driver that pipelines.
An exhaustive walk of the 72-bit frame space is not on the table at any
rate: 2⁷² frames at 25 per second outlives the sun.

## Reproducing it

Any tool that speaks the AMBE-3000 packet protocol with per-frame
request and reply will produce comparable figures. Record the firmware
`VERSTRING`, the host, and the driver's concurrency, because all three
move the answer. Timing the whole process, as above, is deliberate: it
measures what an experimenter actually waits for.

Last reviewed: 2026-08-11.
