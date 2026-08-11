# Windows, frames, and the tradeoff

[Chapter 2](02-fourier-and-the-dft.md) ended on a warning: the transform
is exact, but only for the block you hand it, and cutting speech into
blocks does damage. This chapter is about that damage, because nearly
every number in a speech coder is chosen to manage it.
{: .lede }

## Why blocks at all

Take a ten second recording of somebody talking and run one enormous DFT
over the whole thing. The result is exact and almost useless. It tells
you every frequency present anywhere in those ten seconds, with no
indication of when. The "ee" and the "sh" and the pause are all in there,
summed together, indistinguishable.

Speech is interesting precisely because it changes. A description that
averages over ten seconds has thrown away the thing being described.

So you cut the recording into short pieces and transform each one. Each
result then describes a specific moment. Do it fifty times a second and
you have a description that moves as the speaker moves. That is what a
frame is, and it is why coders have them.

The question is where to cut, and what cutting costs.

## The obvious cut, and what goes wrong

The obvious way to take 20 ms out of a recording is to take it: keep the
samples inside, discard the ones outside. A rectangular cut.

To see what that does, try the simplest possible test. Feed in a pure
tone, one single unchanging frequency, and cut out a block. There is
exactly one frequency present, so the spectrum should show one line and
nothing else.

Sometimes it does. If the tone completes a whole number of cycles inside
the block, you get one clean line.

Slide the tone slightly off that value and the spectrum falls apart.
Instead of one line you get a broad smear with energy spread across bins
either side, and low-level junk running out to the far end of the
spectrum. The signal has not changed. It is still one pure tone. But the
spectrum now reports energy at dozens of frequencies that are not in the
signal at all.

## Where the phantom frequencies come from

The DFT does not know it was handed an excerpt. It treats the block as
one period of something that repeats forever.

So ask what that infinitely repeating signal actually looks like. Take
the block and lay copies of it end to end. If the tone completed a whole
number of cycles, the end of one copy meets the start of the next exactly
in step, and the repeated signal is a smooth, unbroken tone. One
frequency, one line, correct.

If the tone did not complete a whole number of cycles, the end of one
copy is partway through a cycle and the start of the next begins at the
top again. There is a step discontinuity at every joint.

A step is not a smooth thing. Reproducing a sharp edge takes energy at
many frequencies, which is why the spectrum lit up everywhere. The
phantom frequencies are real, in the sense that they genuinely belong to
the signal the DFT was implicitly given. They are the sound of the joints
between the copies. The name for this is spectral leakage.

This matters more for speech than the pure-tone example suggests. A voice
has many harmonics at once, each leaking, and leakage from a strong
low-frequency harmonic can be larger than a genuine weak harmonic higher
up. The measurement of the weak one is then mostly a measurement of the
strong one's skirts.

## The fix, and its price

The problem is the discontinuity at the joints. So remove it: instead of
cutting the block off square, fade it in at the start and out at the end,
so that both edges reach zero. Now every copy joins its neighbour at zero
with no step, and there are no sharp edges to generate phantom
frequencies.

That fade is a window function. Multiply the block by a smooth bump
before transforming it, and the leakage collapses. Common shapes carry
the names of the people who chose the numbers: Hann, Hamming, Blackman.
They differ in how the taper is shaped, not in what they are for.

Windowing works, and it is not free. Fading the edges of the block means
the samples near the edges contribute less, so in effect you looked at
less signal than you cut. Chapter 2 established that resolution comes
from duration, so seeing less signal means seeing it less sharply. A
windowed block produces a peak that is wider than the rectangular one.

That is the trade. A rectangular cut gives the narrowest possible peak
and appalling skirts. A strong taper gives clean skirts and a broader
peak. Every window shape sits somewhere along that line, and choosing one
is choosing how to divide a fixed budget of error between two kinds of
wrongness.

Neither is free of the other, and no cleverness removes the trade. It is
a property of looking at a finite piece of a signal.

## The other tradeoff, which is the same one

There is a second choice: how long the block should be. It turns out to
be the first choice wearing a different hat.

Make the block short and you pin down *when* something happened
precisely. The sharp onset of a "t" lands in one frame and not its
neighbours. But chapter 2's rule says a short block resolves frequency
poorly, so the harmonics of the voice blur into an indistinct ridge.

Make the block long and the harmonics separate beautifully into
individual peaks you can measure one at a time. But that block now spans
enough time for the speaker to have moved on, so a plosive is smeared
across the whole frame and the vowel that follows is mixed in with it.

Sharp in time, blurred in frequency. Sharp in frequency, blurred in time.
You may have either, and buying more of one spends the other. This is the
central constraint of time-frequency analysis and it is not a limitation
of the DFT. It is a property of signals.

## Why 20 ms

Two physical facts bracket the answer, and between them there is not much
room left to argue about.

From below: the coder must resolve individual harmonics, because their
spacing is the pitch and their heights are the spectral shape, and those
are most of what gets transmitted. Adult speaking pitch runs from roughly
80 Hz upward. Chapter 2's rule puts the resolution of a 20 ms block at
about 50 Hz, which separates the harmonics of a typical voice, and only
just. Halve the block and a low-pitched voice becomes a ridge with no
countable peaks.

From above: the vocal tract is a physical object with mass, and tongues
and jaws take time to move. Articulation changes meaningfully over a few
tens of milliseconds. A frame much longer than that averages across two
different mouth shapes and describes neither.

So the window has to be long enough to resolve the pitch of a low voice
and short enough to sit inside one articulatory gesture. Twenty
milliseconds is where those two demands meet, which is why unrelated
speech coders keep independently landing on 20 ms frames rather than
copying each other.

Note what this means for a real coder: it does not have a comfortable
margin. It is operating close to the point where low-pitched voices stop
being resolvable, which is one reason a codec's failure modes are often
worse on deep voices than on high ones.

## What this sets up

Three things carry forward.

Frames exist because speech changes, and 50 frames per second is a
physical compromise rather than an arbitrary rate.

Every spectrum a coder measures is a windowed spectrum, so its peaks have
width, and some of the energy near a harmonic belongs to its neighbours.
Measurement is never as clean as the model.

And the reconstruction has the same problem in reverse. If frames are
produced every 20 ms, the decoder has to join them back into continuous
audio without the joints being audible, which is the same
discontinuity problem read backwards. [Chapter 11](11-synthesis.md) is
where that bill comes due.

---

**Next: [Phase](04-phase.md).** The third number a sinusoid needs, why
the ear cares about it far less than about the other two, and how a
codec exploits that to throw away half of what it measures.
Back to [The Fourier transform and the DFT](02-fourier-and-the-dft.md),
or to [the start](index.md).
{: .chapter-nav }

Last reviewed: 2026-08-11.
{: .source-note }
