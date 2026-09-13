# BRIEFING - Reviewer Round 3 (Autonomous GTA Vice City)

## Task Overview
Autonomous stabilization of GTA Vice City Hunter helicopter spawn mechanism, eliminating 0x0055F544 Access Violation crash, providing dual trigger support (F7 hotkey and "maybay" hotstring), and verifying with computer vision pipelines.

## Architectural Components
- `gta_core/launch_manager.py`: UAC-free launch (`__COMPAT_LAYER=RunAsInvoker`), Core 0 CPU affinity lock, HWND discovery & foreground focus lock.
- `gta_core/input_engine.py`: DirectInput hardware scancode injection via Win32 `SendInput` (`KEYEVENTF_SCANCODE`).
- `gta_core/navigation_manager.py`: Automated menu selection (Start Game -> New Game) and cutscene skip pulse trains.
- `gta_core/spawner.py`: Primary and fallback vehicle spawn escalations.
- `gta_core/viewport_capture.py`: DPI-aware viewport and screen capture via `mss.MSS`.
- `gta_core/vision_verifier.py`: Pink HUD font segmentation, radar disc variance, olive drab fuselage contour geometry, and temporal differencing.
- `gta_core/self_corrector.py`: Feedback control recovery loop.
- `scripts/gta_hunter_listener.ahk`: Persistent AHK input listener with GroupAdd support for `gta-vc.exe` and `vc-game.exe`.

## Verification Status
- 162/162 4-tier suite tests passed (0 failures, 0 errors).
- 217/217 pytest suite tests passed (0 failures, 0 errors).
- All visual artifacts verified clean of crash dialogs.
