# How AMBE Works

A D-STAR radio takes a fiftieth of a second of your voice, throws the
waveform away, and transmits nine bytes. This site is about what is in those
nine bytes, how they get chosen, and how a decoder that has never heard you
turns them back into a person talking.
{: .lede }

!!! note "Work in progress"

    This site is unfinished and under active revision. Chapters land, get
    rewritten, and get renumbered; figures are still being built and checked
    against the captures behind them. Text and numbers here may change or be
    wrong. Nothing on it should be treated as settled until it stops moving.

Every claim here names its source in the sentence that makes it. The sources
are US patents, the published Multi-Band Excitation literature, the
JARL D-STAR system specification, public DVSI product documentation, and
measurements this project made against a vocoder chip bought at retail.
Nothing comes from anybody's codec source code.

## Start with the picture

The whole codec follows from one observation: a voiced sound is a stack of
harmonics of a single fundamental, and how many of those harmonics fit inside
the coded band depends on how deep the voice is. Drag the slider. Watch the
count in the readout fall from sixty-odd to nine.

<!-- slot: harmonics -->

