# How AMBE Works

Fifty times every second, a digital voice radio takes 20 milliseconds of your
voice. It throws away the raw audio waveform. Instead, it sends 9 bytes over
the air.
This site explains what is inside those 9 bytes, how the encoder measures them,
and how a receiving radio rebuilds a recognizable human voice from them.
{: .lede }

Every technical claim on this site cites its primary source directly in the
text. The sources come in five kinds.

- The published Multi-Band Excitation academic papers
- Expired US patents
- The JARL D-STAR system specification
- Public DVSI product documentation
- Black-box hardware measurements captured from a retail DVSI AMBE-3000
  vocoder chip

## Start with the core physical idea

Almost every design tradeoff inside an AMBE vocoder flows from one physical
observation. A spoken vowel is a stack of [harmonics](18-glossary.md#harmonic)
at whole-number multiples of the speaker's [fundamental pitch](18-glossary.md#fundamental-frequency-and-pitch-period).
The number of harmonics that fit inside the radio's 3.7 kHz audio passband
depends directly on how deep the speaker's voice is.

In [**Figure 1**](#fig-1), drag the *Fundamental frequency* slider from a deep bass voice
(75 Hz) up to a high voice (400 Hz) and watch the harmonic comb compress and
expand under the same [spectral envelope](18-glossary.md#spectral-envelope).

