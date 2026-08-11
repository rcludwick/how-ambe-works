# Why sinusoids

Every page that follows describes speech as a sum of sine waves. Before
accepting that, it is worth asking, "Why sine waves and not something else?"
The answer is not that they are familiar. It is that they are the only
shapes that survive what a vocal tract does to a sound.
{: .lede }

## The problem: your description has to survive a filter

Say you want to describe the sound coming out of somebody's mouth, and
you want the description to be short.

The obvious move is to describe the waveform. Speech waveforms look like
repeating pulses, so you might record the shape of one pulse, say how
often it repeats, and be done. Three or four numbers for the shape, one
for the rate. That is a genuinely compact description, and for the sound
at the vocal folds it is close to right.

Magnify a vowel and the proposal looks sound. The same motif comes round
again and again, close enough each time that one shape and one rate feel
like a fair description of it.

<div data-anim="utterance"></div>

Then the sound has to get out of the head, and the description falls
apart.

Between the vocal folds and the air is a tube: the throat, the mouth, the
position of the tongue and jaw and lips. That tube resonates. It boosts
some frequencies and suppresses others, and the boosting changes as the
tube changes shape, which is what saying different vowels physically is.
By the time the sound reaches a microphone it has been through a filter,
and the pulse you carefully described is no longer that pulse. It has
been smeared into something with ringing tails and a different shape
depending on which vowel is being said.

So the description has to be redone for every vowel. Worse, there is no
simple rule for redoing it: the filtered shape is not the original shape
scaled or shifted, it is a different shape.

That is the real constraint, and it is not about compression at all. Any
useful description of speech has to behave predictably when the signal
goes through a filter, because a filter is the last thing that happens to
every speech sound before you hear it.

## What survives a filter unchanged

Ask the question the other way round. Instead of picking a description
and hoping it survives filtering, ask which signals come out of a filter
looking like themselves.

Push a square wave through a filter and you get something that is not a
square wave: the corners round off, the flat tops sag or ring. Push a
single pulse through and you get a smeared pulse with a tail. Push
almost any shape you can name through a filter and the shape changes.

Push in a sine wave and a sine wave comes out. Same frequency. Only two
things about it have changed: it may be louder or quieter, and it may be
shifted in time.

Try it. Send each of the four shapes through the filter below and move the
cutoff around. Then press <em>Rescale and realign</em>, which undoes exactly
those two permitted changes and draws whatever is left over.

<div data-anim="filter"></div>

The residual for the sine stays under one percent wherever you put the
cutoff, and what remains is the filter still settling. For the square and
the sawtooth it never falls below a third of the input. The triangle is
the mildest of the three, because its harmonics are weak to begin with,
and even it does not get close. No single gain and no single delay can
account for what the filter did to any of them.

That property is not a coincidence and it is not approximate. It holds
for every filter that is linear and does not change its behaviour over
time, which covers the vocal tract over the tens of milliseconds a coder
cares about. Sine waves are the signals that a filter can only scale and
delay, never reshape. In the language of linear systems they are the
eigenfunctions of the system: the inputs that come back as multiples of
themselves.

Nothing else has this property. That is the whole reason the rest of this
site is written in sinusoids.

## The same argument, on the radio

Nothing in the last section mentioned sound. It said "linear" and it said
"does not change over time", and everything else followed. Any system with
those two properties has sinusoids as its eigenfunctions, whatever it is
made of.

A radio is such a system. So is a length of coax, an antenna, a filter in
an IF strip, and a path through the atmosphere. They scale a sine wave and
delay it, and they cannot reshape it, for the same reason the throat
cannot. This is why the same words appear on both sides of a radio
conversation. Amplitude, frequency and phase describe a vowel and they
describe a carrier. A frequency response describes a mouth and it
describes a feedline.

The overlap is not an analogy. It is the same theorem applied twice. The
audio being coded here is a pressure wave a few hundred hertz across, and
the signal carrying it is an electromagnetic wave a few hundred megahertz
across, and the mathematics does not distinguish them. That is convenient
for a radio amateur: the Fourier machinery in the next chapter is already
familiar equipment pointed somewhere new.

## The three numbers

A sinusoid is fully specified by three quantities, and every later
chapter uses these words in this way.

**Amplitude** is how large the swing is. Double it and the sound is
louder.

**Frequency** is how many cycles pass per second, in hertz. Higher means
higher pitched.

**Phase** is where in its cycle the wave sits at the moment you start
looking, measured as an angle. Two sinusoids of identical amplitude and
frequency can still differ by being offset in time, and phase is that
offset.

<div data-anim="three-numbers"></div>

Amplitude and frequency behave the way intuition suggests. Phase does
not, and it turns out to matter far less to the ear than the other two.
That is convenient to the point of being suspicious, and it is worth a
chapter of its own: it is the reason a 2400 bit/s codec can throw away
half of what it measures and still be understood.
[Chapter 4](04-phase.md) takes it up.

## What follows from it

Those three numbers are the whole vocabulary, and the filter argument is
what makes them sufficient. A filter can change the first and the third
of them. It cannot touch the second, and it cannot introduce a fourth.
Once you know that, several things that look like separate design
decisions turn out to be the same decision.

**A filter becomes a list of numbers.** If every sine goes in and comes
out as itself with a new size and a new delay, then a filter is fully
described by what it does to each frequency: how much it scales that
frequency, and how much it delays it. That is a curve rather than a
process, and a curve you can measure, transmit, and reason about.

**The description stops depending on the consonants or vowels** The measurement you
make is how much energy sits at each frequency. That is the same kind of
measurement whether the speaker is saying "ah" or "ee". The numbers
differ; the description does not have to be reinvented.

The tool for measuring the frequency is the Fourier transform, and in a real coder its
discrete form, the DFT. It takes a block of samples and reports how much
of each frequency is in it. That is the subject of
[chapter 2](02-fourier-and-the-dft.md).

Here is that measurement, run on real speech, before any of the machinery
behind it has been explained. Move through a sentence and change the
speaker.

<div data-anim="utterance-spectra"></div>

The curves have nothing in common. The axes are identical every time, and
that is the property the rest of the site is built on.

---

**Next: [The Fourier transform and the DFT](02-fourier-and-the-dft.md).**
How to find out which sinusoids are actually in a block of samples, and
what "frequency resolution" costs.
Back to [the start](index.md). If you would rather skip the mathematics,
[Multi-band excitation](07-multi-band-excitation.md) is where the codec
itself begins.
{: .chapter-nav }

Last reviewed: 2026-08-11.
{: .source-note }
