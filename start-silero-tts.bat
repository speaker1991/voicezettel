@echo off
cd /d C:\Users\nasty\Desktop\voicezettel\silero-tts-api-server
call .venv\Scripts\activate.bat
litestar run --host 0.0.0.0 --port 8010
pause
