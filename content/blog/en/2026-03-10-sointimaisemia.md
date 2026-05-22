---
title: "Why I Built an App That Listens to Your Mind"
date: "2026-03-10"
excerpt: "Serene Soundscapes started as a weekend experiment and turned into something I actually use every day. Here's what it is, why I built it, and why I think the intersection of meditation and code is one of the most interesting places to be right now."
---

I didn't set out to build a meditation app. I set out to understand sound.

It started with binaural beats — this weird phenomenon where playing two slightly different frequencies in each ear creates a third "phantom" frequency your brain just... manufactures. Delta for deep sleep. Theta for creative flow. Alpha for calm focus. I got obsessed with the physics of it, then the neuroscience of it, and somewhere along the way I started wondering: what if I could generate these things dynamically? In the browser, no less, using the Web Audio API — this barely-documented corner of the web that most developers never touch.

That curiosity became **Serene Soundscapes**.

## What It Actually Is

Serene Soundscapes is a web app that generates personalized soundscapes for meditation and focus. Not pre-recorded audio files — *generated*. Real-time synthesis using the Web Audio API, layered with noise generators (brown noise, pink noise, white noise), and mixed with the classical Solfeggio frequency scale (396 Hz through 852 Hz, each with their own claimed healing properties — I'm not here to prove the metaphysics, but the frequencies sound genuinely different).

The core features:

- **Binaural beat engine** — choose your brain state (delta, theta, alpha, beta, gamma) and the app generates the exact frequencies needed, panning them left and right with surgical precision.
- **Solfeggio frequency mixing** — layer in any frequency from the ancient scale and blend them to taste.
- **Noise generators** — brown, pink, white noise at any volume, mixed on top of everything else.
- **Trataka mode** — this is the one I'm most proud of. Candle gazing meditation, but with your webcam and TensorFlow.js Face Mesh tracking your eyes in real-time. Keep your gaze steady, the candle flame responds to your focus. It's a simple trick but genuinely powerful — you *see* your meditation quality, not just feel it.
- **Journal** — after sessions, write reflections. Not gamified, not social, just you and your thoughts.
- **PWA** — works offline, installs on your phone, no app store needed.

Auth is handled by Clerk. Payments by Stripe. Because of course.

## The Stack (For the Devs Who Are Wondering)

Frontend: **Vite + React + TypeScript + Tailwind CSS + shadcn/ui**. I reach for this stack constantly — it hits the sweet spot between structure and speed. shadcn/ui in particular is underrated; it's not a component library, it's *components as source code you own*. I tweak things without fighting framework conventions.

Backend: a lightweight Node.js server on port 9124, handling session management and serving some of the audio processing that wouldn't be sane to do client-side.

Audio: **Web Audio API** — the real hero. This API is an absolute beast. `OscillatorNode` for pure tones, `BiquadFilterNode` for shaping noise, `GainNode` for mixing, `ConvolverNode` for reverb (because a dry binaural beat sounds clinical and wrong). The browser is a synthesizer. Most people don't know.

Face tracking: **TensorFlow.js with Face Mesh**. I initially tried a few approaches and kept running into latency issues — you need real-time performance for the candle to feel responsive. Face Mesh gave me the 468-landmark accuracy I needed with acceptable speed on modern hardware.

Deployed on **Dokploy** with GitHub Actions handling CI/CD. I like that it's self-hostable. The infrastructure is simple enough that one person can own it completely.

## Why Combine Meditation and Tech?

Here's the part I find most interesting to think about.

Meditation apps are usually designed by people who are bad at both meditation *and* software. They have gamified streaks and notifications and social features and all this noise (ironic, for a meditation app) layered on top of generic ambient sounds. They feel like productivity tools with a zen coat of paint.

I built this because I wanted something I'd actually use. I'm a developer — I live in my terminal, my browser, my code editor. A separate "wellness" app that lives on a different device in a different context doesn't fit my workflow. But a web app I can open in a tab while I'm working, or pull up on my phone before bed, or cast to my speaker — that fits.

More than that: I think the browser as an audio platform is genuinely underexplored. The Web Audio API is powerful enough to do things that would have required a hardware synthesizer or a Pro Tools rig fifteen years ago. Most developers don't know it exists. Most "wellness tech" is built by non-technical people using pre-made assets. The overlap — people who understand both the art and the engineering — is tiny.

That's where I want to sit. Not building meditation software *for* developers, but building with the same craft and intentionality I'd apply to any serious project, applied to something that actually affects how I feel.

## The Candle Thing

Let me single out Trataka because it's the most unusual feature and I want to defend the idea.

Candle gazing is an ancient practice. Stare at a flame, let your eyes relax, notice when your mind wanders. It's simple. The problem is: you don't know if you're doing it "right." Your mind is wandering and you're not even noticing because you're, well, in a meditative state. The feedback loop is weak.

Eye tracking fixes this. TensorFlow.js Face Mesh gives you 468 facial landmarks at roughly 30 fps. I use the eye landmarks to detect gaze stability. When your eyes are steady, the flame burns brighter and calmer. When they drift, the flame flickers. You *see* your practice. It's visceral.

Is it gimmicky? Maybe. But I've been using it for weeks and it's the feature that got me to actually maintain a daily practice, which is more than I can say for any other method I've tried.

## What I Learned

Building Serene Soundscapes taught me things I didn't expect to learn:

**The Web Audio API is deep.** I keep finding new corners. Stereo panning, Doppler effects, physical modeling of acoustic spaces. There's a whole world of audio programming that desktop software used to own and the browser is quietly absorbing.

**Real-time face tracking in the browser is actually good now.** TensorFlow.js on a modern laptop handles Face Mesh without breaking a sweat. The latency is low enough for interactive applications. This wasn't true three years ago.

**Simple beats complex.** The most powerful soundscapes are often just a binaural beat and some brown noise. I spent weeks building elaborate mixing systems and the users who stuck around mostly just wanted a clean delta preset with a gentle noise floor. Feature restraint is hard when you love building.

## What's Next

I don't know yet. I'm not chasing a launch, not optimizing for downloads. I'm using it. It's solving a real problem for me — better sleep, easier focus, a slightly less frantic relationship with my own thoughts.

If that resonates with you, the app is at **o.valuebit.net**. It's free to try. The paid tier unlocks longer sessions, offline mode, and some premium presets I'm building out.

If you're a developer interested in the intersection of audio, ML, and the browser — reach out. I think there's a lot of unexplored territory here and I'd love to see what others build with these tools.

The flame is steady. Let's see where this goes.
