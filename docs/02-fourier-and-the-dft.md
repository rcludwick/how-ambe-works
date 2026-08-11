# The Fourier transform and the DFT

[Chapter 1](01-why-sinusoids.md) argued that sinusoids are the right
coordinates for describing speech. That leaves a practical question: given
160 samples of somebody talking, how do you find out which sinusoids are
actually in there, and how loud each one is?
{: .lede }

## Testing one frequency at a time

Start with a smaller question. Forget finding every frequency. Is there
any 200 Hz content in this block of samples, and if so, how much?

Here is a way to answer it that needs no theory. Generate a 200 Hz sine
wave of your own, the same length as the block. Multiply it against the
samples point by point, and add up the result.

Think about what that sum does. Where the recording happens to swing
positive at the same moments your test wave does, the products are
positive. Where they disagree, the products are negative. If the
recording contains no 200 Hz component, agreement and disagreement are
equally likely across the block, the positives and negatives cancel, and
the sum comes out near zero. If the recording does contain 200 Hz
content, those moments line up over and over, the products reinforce, and
the sum comes out large.

So a single multiply-and-add answers the question. The size of the sum is
how much 200 Hz is present.

## The flaw, and the fix that produces phase

That test has a hole in it, and finding the hole is more instructive than
being told the answer.

Suppose the recording really does contain a strong 200 Hz component, but
it happens to be offset in time from your test wave by a quarter cycle.
Now, wherever your test wave peaks, the recording is crossing zero. The
products cancel just as thoroughly as if nothing were there. The sum is
zero, and you conclude there is no 200 Hz content, and you are wrong.

The problem is that one test wave only detects components that happen to
align with it. Recall from chapter 1 that a sinusoid needs three numbers,
and that the third one is phase. The test above quietly assumed a phase.

The fix is to test twice: once against a sine and once against a cosine
at the same frequency. Those two are a quarter cycle apart, so whatever
slips past one lands squarely on the other. A component perfectly hidden
from the sine test produces the maximum possible response in the cosine
test.

Two numbers come out. Treat them as the two sides of a right triangle:
the length of the hypotenuse is how much of that frequency is present,
and the angle is its phase. Magnitude and phase, recovered together,
falling out of the mechanism rather than being imposed on it.

Drag the point below. The pair of numbers read off the axes, and the
length and angle drawn to it, are the same point written two ways.
Neither is more real than the other. Then press Spin and watch the right
panel: a point going round at a steady rate projects to a cosine, and
where it starts is the phase.

<div data-anim="complex"></div>

Writing that pair as a single complex number is bookkeeping rather than
new physics. It lets one symbol carry both numbers at once, so the sine
test and the cosine test collapse into a single multiplication. That is
why the sum in the next section is written with a power of e instead of
as two separate sums.

That pair of correlations, run at one frequency, is the whole idea. Doing
it at every frequency is the Fourier transform.

## Which frequencies, and why only those

Running the test at every conceivable frequency would take forever, and
it is unnecessary. A finite block of samples cannot distinguish an
unlimited number of frequencies, and the reason is worth seeing directly.

Consider a block one second long. A 5 Hz wave completes five whole cycles
in it. A 5.5 Hz wave completes five and a half. Both are distinguishable
because they differ over the length of the block. Now consider 5 Hz
against 5.000001 Hz. Over one second they never visibly separate. To tell
them apart you would need to watch for much longer.

Resolution comes from duration, and the rule is as simple as it looks:
a block lasting *T* seconds separates frequencies about 1/*T* apart. One
second of audio resolves to roughly 1 Hz. Twenty milliseconds of audio,
which is what a speech coder gets, resolves to roughly 50 Hz.

So there is no point testing frequencies closer together than 1/*T*. The
sensible set is the multiples of 1/*T*: for a 20 ms block, 0 Hz, 50 Hz,
100 Hz, 150 Hz and so on up. Those are the bins, and testing each of them
with the sine-and-cosine pair is the discrete Fourier transform.

That 50 Hz figure is worth holding on to. Adult speaking pitches run from
roughly 80 Hz to 250 Hz, so a 20 ms block resolves the harmonics of a
voice only just well enough to be useful, and for low-pitched voices
barely. Nearly every awkward compromise later in this site traces back to
that number.

## It is exact, not an approximation

A DFT of *N* samples produces *N* numbers. Nothing has been lost. Feed
those numbers into the inverse transform and the original samples come
back, every one of them, to the last bit.

This is worth stating plainly because "transform" sounds lossy and the
word "analysis" suggests summarising. A DFT summarises nothing. It is a
change of coordinates, in the same sense that giving a position as
latitude and longitude rather than as distances north and east describes
the same point in different words. The samples and their spectrum are two
descriptions of one signal.

Everything lossy in a codec happens afterwards, when it decides which of
those numbers to keep, how precisely, and which to discard. Keeping that
line clear makes it much easier to say where quality is actually being
lost, which is the subject of [chapter 9](09-quantization.md).

## Reading a spectrum of speech

Run a DFT on a voiced sound, a vowel, and the result has a shape you will
see on every later page.

There is a peak at the speaker's fundamental frequency, and further peaks
at two times it, three times it, and so on. Those are the harmonics, and
they arise because the vocal folds produce a repeating pulse rather than
a pure tone. A repeating waveform of any shape is a stack of harmonics.
Their spacing is the pitch.

Over those peaks sits a slower undulation: broad regions where the
harmonics are strong and regions where they are weak. That is the vocal
tract filter from chapter 1, boosting some frequencies and suppressing
others. Its peaks are the formants, and they are what distinguishes one
vowel from another.

Two structures, superimposed, one fine and one coarse. The fine structure
is the source and its spacing is the pitch. The coarse structure is the
filter and its shape is the vowel. Chapter 1 claimed the two would come
apart cleanly in sinusoidal coordinates; this is what that looks like on
a screen, and it is the picture a coder actually works from.

Unvoiced sounds, an "s" or an "f", have no harmonic peaks at all. The
source there is turbulence rather than a repeating pulse, so the spectrum
is a broad hiss with no fine structure to measure. Handling both kinds at
once, sometimes in the same instant, is the problem that
[multi-band excitation](07-multi-band-excitation.md) exists to solve.

## The catch

Everything above assumed you can simply take a block of samples and
transform it. You can, and the result is exact. But the DFT treats that
block as though it repeats forever, and a 20 ms slice of speech does not
join up smoothly with a copy of itself. The joint shows up in the
spectrum as energy at frequencies that are not in the signal at all.

That artefact is unavoidable, it is large enough to matter, and managing
it is most of the practical craft in speech analysis. It is also the
reason the analysis window in a real coder is not simply a rectangular
cut. [Chapter 3](03-windows-and-frames.md) is about the damage and what
to do about it.

---

**Next: [Windows, frames, and the tradeoff](03-windows-and-frames.md).**
Why cutting speech into blocks creates frequencies that are not there,
and why 20 ms is the compromise a speech coder makes.
Back to [Why sinusoids](01-why-sinusoids.md), or to
[the start](index.md).
{: .chapter-nav }

Last reviewed: 2026-08-11.
{: .source-note }
