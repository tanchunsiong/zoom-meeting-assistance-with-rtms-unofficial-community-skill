# RTMS Meeting Assistant - Headless Capture Service

This is a headless Zoom RTMS capture service that records meeting media (audio, video, transcript, screenshare, chat) and provides AI-powered analysis via a local Clawdbot agent with WhatsApp notifications.

### How It Works

1. **Receive Media via Zoom RTMS**: Utilizes Zoom's Real-Time Media Streams (RTMS) to receive raw transcript, video, audio, screenshare, and chat streams directly from Zoom meetings during active sessions
2. **Store to Disk**: All media is saved in real-time to `recordings/{streamId}/` for agent/LLM consumption
3. **AI Processing via Clawdbot**: Local Clawdbot agent analyzes transcripts and generates dialog suggestions, sentiment analysis, and meeting summaries
4. **WhatsApp Notifications**: Real-time AI results are sent via WhatsApp using `notifyUser()` function
5. **Agent-Driven**: LLM reads stored files directly from disk and can trigger helper functions (media conversion, muxing) on demand

### File Structure & Purpose

```
project/
├── .env                        # API keys & config
├── summary_prompt.md           # LLM instructions for summarization
├── query_prompt.md             # LLM instructions for search queries
├── query_prompt_current_meeting.md  # LLM instructions for current meeting queries
├── query_prompt_dialog_suggestions.md  # LLM instructions for dialog suggestions
├── query_prompt_sentiment_analysis.md  # LLM instructions for sentiment analysis
├── black_frame.h264            # Black frame template for video gap filling
├── sps_pps_keyframe.h264       # H.264 video headers for stream compatibility
├── index.js                    # Main RTMS application server & recording logic
├── chatWithClawdbot.js         # Clawdbot agent integration for AI processing and WhatsApp notifications
├── muxFirstAudioVideo.js       # Audio/video muxing helper (not auto-triggered)
├── convertMeetingMedia.js      # FFmpeg conversion helper (not auto-triggered)
├── saveRawAudioAdvance.js      # Real-time audio stream saving
├── saveRawVideoAdvance.js      # Real-time video stream saving
├── writeTranscriptToVtt.js     # Real-time transcript writing in multiple formats
├── saveSharescreen.js          # Real-time screenshare capture, frame deduplication, and PDF generation
├── tool.js                     # Utility functions including filename sanitization
recordings/                     # Generated meeting data storage
    └── {streamId}/             # Per-meeting directory
        ├── transcript.vtt      # Real-time transcript (VTT format)
        ├── transcript.srt      # Real-time transcript (SRT format)
        ├── transcript.txt      # Real-time transcript (plain text)
        ├── chat.txt            # Chat messages with timestamps
        ├── events.log          # Meeting event data (participant join/leave)
        ├── ai_dialog.json      # AI-generated dialog suggestions
        ├── ai_sentiment.json   # AI sentiment analysis results
        ├── ai_summary.md       # AI-generated real-time summary
        ├── {userId}.raw        # Per-participant raw audio (gaps filled)
        ├── combined.h264       # Combined raw video with SPS/PPS headers
        └── processed/          # Sharescreen processing directory
            ├── jpg/            # Individual captured JPEG frames
            ├── screenshare.pdf # Compiled sharescreen PDF with deduplicated frames
            └── frames.txt      # Timestamp log of screenshare frames
```

## Setup Instructions

### Environment Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file and configure:

**Required:**
- `ZOOM_SECRET_TOKEN`: Your Zoom webhook secret token
- `ZOOM_CLIENT_ID`: Your Zoom app client ID
- `ZOOM_CLIENT_SECRET`: Your Zoom app client secret
- `CLAWDBOT_BIN`: Path to clawdbot binary (default: `clawdbot`)

**Optional:**
- `PORT`: Server port (default: 3000)
- `WEBHOOK_PATH`: Webhook endpoint path (default: `/webhook`)
- `AI_PROCESSING_INTERVAL_MS`: How frequently AI analyzes meeting data (default: 30000ms = 30 seconds)
- `AI_FUNCTION_STAGGER_MS`: Delay between AI function calls to prevent clustering (default: 5000ms)
- `CLAWDBOT_NOTIFY_CHANNEL`: Notification channel (default: `whatsapp`)
- `CLAWDBOT_NOTIFY_TARGET`: Notification target (default: phone number)
- `CLAWDBOT_TIMEOUT`: Clawdbot execution timeout in seconds (default: 120)

### Zoom Webhook Configuration

Configure your Zoom app webhook:

- Set the webhook URL to `{domain}/webhook` (e.g., `https://yourdomain.com/webhook`)
- The service will receive `meeting.rtms_started` and `meeting.rtms_stopped` events
- Ensure your application is accessible at this endpoint

**Note**: The LLM/agent typically proxies webhook events to this service via POST requests with the RTMS payload.

## Features

### Real-Time Recording

During active meetings, the application saves all media to disk in real time:

- **Transcripts**: Saved as VTT, SRT, and TXT files with timestamped entries
- **Chat Messages**: Saved to `chat.txt` with ISO timestamps and user names
- **Audio**: Raw PCM data per participant in `.raw` files with automatic gap filling
- **Video**: Raw H.264 video in `combined.h264` with SPS/PPS headers and gap filling using black frames
- **Screenshare**: Captured as JPEG images with deduplication, compiled into PDF
- **Events**: Participant activities (join/leave, active speaker) logged with timestamps

### Real-Time AI Processing

During active meetings, Clawdbot continuously processes transcripts to generate:

- **Dialog Suggestions**: Strategic conversation directions for meeting facilitation
- **Sentiment Analysis**: Real-time assessment of participant sentiment
- **Meeting Summaries**: Live summarization of ongoing discussions

AI results are:
- Saved to disk: `ai_dialog.json`, `ai_sentiment.json`, `ai_summary.md`
- Sent via WhatsApp using `notifyUser()` (if notifications enabled)

### Notification System

The service includes a runtime notification toggle:

- **POST /api/notify-toggle**: Enable/disable notifications
  ```bash
  curl -X POST http://localhost:3000/api/notify-toggle \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}'
  ```

- **GET /api/notify-toggle**: Check notification status
  ```bash
  curl http://localhost:3000/api/notify-toggle
  ```

Notifications are sent via WhatsApp through Clawdbot CLI:
```bash
clawdbot message send --channel whatsapp --target +1234567890 --message "Meeting ended"
```

### Post-Meeting Processing

After meetings conclude, the service:
- Closes all WebSocket connections
- Generates screenshare PDF from deduplicated frames
- Sends "Meeting ended" notification via WhatsApp

**Available Helpers** (not auto-triggered, LLM can call manually):
- `convertMeetingMedia.js`: Convert raw audio/video to WAV/MP4 using FFmpeg
- `muxFirstAudioVideo.js`: Mux audio and video into final MP4 file

### Data Storage and Reuse

All meeting data is stored in `recordings/{streamId}/` for LLM/agent consumption:

- **Transcripts**: Multiple formats (VTT, SRT, TXT) for NLP tasks
- **Chat**: Plain text with timestamps
- **Audio**: Raw PCM data per participant
- **Video**: Raw H.264 streams
- **Screenshare**: JPEG frames + PDF compilation
- **Event Logs**: Structured participant activity logs
- **AI Results**: JSON and Markdown files with analysis

The LLM reads these files directly from disk to understand meeting content and make decisions.

## Customization

### AI Processing Configuration

- `AI_PROCESSING_INTERVAL_MS`: Controls analysis frequency (default: 30 seconds)
- `AI_FUNCTION_STAGGER_MS`: Delays between AI calls (default: 5 seconds)

### Prompt File Customization

Customize AI behavior by editing prompt files:

- `summary_prompt.md`: Meeting summary generation logic
- `query_prompt.md`: Query response formatting
- `query_prompt_current_meeting.md`: Real-time meeting analysis
- `query_prompt_dialog_suggestions.md`: Conversation facilitation tips
- `query_prompt_sentiment_analysis.md`: Sentiment scoring logic

## API Endpoints

### Webhook
- `POST /webhook`: Receives Zoom RTMS events (`meeting.rtms_started`, `meeting.rtms_stopped`)

### Notification Control
- `POST /api/notify-toggle`: Enable/disable WhatsApp notifications
- `GET /api/notify-toggle`: Get current notification status

## Architecture

This is a **headless service** designed for agent/LLM consumption:

- **No frontend UI** - all data stored to disk for LLM to read
- **No WebSocket broadcasting** - uses WhatsApp notifications instead
- **Agent-driven** - LLM orchestrates everything, reads files directly
- **Clawdbot-only** - single AI provider via local Clawdbot agent
- **Notification toggle** - LLM can mute/unmute mid-meeting

The service receives RTMS connection details via POST (proxied by LLM from Zoom webhook), connects to Zoom's RTMS WebSocket, captures all media, and stores everything to disk for the LLM to process.
