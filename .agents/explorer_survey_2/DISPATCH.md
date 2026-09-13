## 2026-08-27T20:20:31Z

You are Survey Explorer 2 for the autonomous GTA Vice City project.
Your Working Directory: D:\AI REXI\.agents\explorer_survey_2
Original Request Path: D:\AI REXI\.agents\ORIGINAL_REQUEST.md

You MUST read D:\AI REXI\.agents\ORIGINAL_REQUEST.md before starting work.

Mission & Tasks:
1. Investigate autonomous process launching and window management in Windows (Python `subprocess`, `ctypes`, `win32gui`, `win32process`, setting CPU affinity to core 0, window handle `HWND` discovery, `SetForegroundWindow`, `ShowWindow`, handling fullscreen vs windowed mode).
2. Investigate input automation for GTA Vice City's DirectX DirectInput engine. Note that standard Virtual-Key `VK_*` messages (e.g. `WM_KEYDOWN` or `pyautogui` without scancodes) frequently fail in DirectInput. Research exact DirectInput hardware scancodes (`KEYEVENTF_SCANCODE` with SendInput) for Enter (`0x1C`), Space (`0x39`), Esc (`0x01`), F7 (`0x41`), and alpha characters.
3. Map out the full navigation sequence:
   - Bypassing intro logos (timings, keypresses).
   - Main menu navigation ("Start Game" -> "New Game" or load game).
   - Skipping opening cutscenes (Marco's Bistro dialogue, car ride to Ocean View Hotel) until Tommy Vercetti is standing in active 3D gameplay outside Ocean View Hotel.
4. Investigate robust synchronization / state detection methods (e.g. deterministic timing sequences, window status checks, screen pixel sampling) to ensure cutscenes are fully skipped before proceeding to cheat input.
5. Document all technical specifications, scancode tables, timing diagrams, and state detection strategies in `D:\AI REXI\.agents\explorer_survey_2\handoff.md`.
6. Update your `progress.md` and send a completion message back to the orchestrator when done.
