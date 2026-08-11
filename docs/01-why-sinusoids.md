# Why sinusoids

Every page that follows describes speech as a sum of sine waves. Before
accepting that, it is worth asking why sine waves and not something else.
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

Push in a sine wave, and a sine wave comes out. Same frequency. Only two
things about it have changed: it may be louder or quieter, and it may be
shifted in time.

That property is not a coincidence and it is not approximate. It holds
for every filter that is linear and does not change its behaviour over
time, which covers the vocal tract over the tens of milliseconds a coder
cares about. Sine waves are the signals that a filter can only scale and
delay, never reshape. In the language of linear systems they are the
eigenfunctions of the system: the inputs that come back as multiples of
themselves.

Nothing else has this property. That is the whole reason the rest of this
site is written in sinusoids.

## What follows from it

Once you know that filters cannot reshape a sine wave, several things
that look like separate design decisions turn out to be the same
decision.

**A filter becomes a list of numbers.** If every sine goes in and comes
out as itself with a new size and a new delay, then a filter is fully
described by what it does to each frequency: how much it scales that
frequency, and how much it delays it. That is a curve rather than a
process, and a curve you can measure, transmit, and reason about.

**Source and filter come apart.** The buzz at the vocal folds is one
thing, the shape of the tube is another. Described in sinusoids, they
multiply rather than tangle: the source supplies energy at each
frequency, the filter scales it. So pitch and vowel become two
independent sets of numbers instead of one inseparable waveform. That
separation is what makes a codec possible at all, and
[chapter 5](05-source-and-filter.md) is entirely about the physical side
of it.

**The description stops depending on the vowel.** The measurement you
make is how much energy sits at each frequency. That is the same kind of
measurement whether the speaker is saying "ah" or "ee". The numbers
differ; the description does not have to be reinvented.

The bet the whole codec makes is that a few dozen numbers of this kind,
measured fifty times a second, are enough to rebuild a recognisable
person. The rest of the site is about whether that bet pays.

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

Amplitude and frequency behave the way intuition suggests. Phase does
not, and it turns out to matter far less to the ear than the other two.
That is convenient to the point of being suspicious, and it is worth a
chapter of its own: it is the reason a 2400 bit/s codec can throw away
half of what it measures and still be understood.
[Chapter 4](04-phase.md) takes it up.

## Where the argument goes next

Sinusoids are the right coordinates. That leaves the practical question
of how to find, in an actual recording, which sinusoids are present and
how large each one is.

The tool for that is the Fourier transform, and in a real coder its
discrete form, the DFT. It takes a block of samples and reports how much
of each frequency is in it. That is the subject of
[chapter 2](02-fourier-and-the-dft.md).

One caution before going there, because it shapes everything afterwards.
The eigenfunction property above holds exactly for sinusoids that run
forever. Real speech does not run forever, and a coder looks at 20 ms of
it at a time. Cutting a signal into short blocks does real damage to the
tidy picture in this chapter, and managing that damage is most of the
practical difficulty in speech analysis. That is
[chapter 3](03-windows-and-frames.md).

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
